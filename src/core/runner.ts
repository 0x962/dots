import { homedir } from "node:os";
import { join } from "node:path";
import { composePrompt, parseReply } from "./prompt";
import { appendNodeFile, makeRunId, readNodeFile, saveNodeFile, saveRun } from "./runstore";
import type {
	GraphBundle,
	GraphRun,
	RunNode,
	RunNodeStatus,
} from "./types";
import { allChildren } from "./types";

export interface RunnerOptions {
	target: string;
	vars: Record<string, string>;
	/** The agent command; the node's prompt arrives on stdin. */
	agentCmd: string[];
	/** Where agents run, normally the repository under review. */
	cwd: string;
	/** Kills a single node's agent after this many minutes. */
	nodeTimeoutMinutes: number;
	/** Shell command prefix nodes use to question earlier agents. */
	askCommand?: string;
	onEvent?: (line: string) => void;
}

/**
 * A cwd typed by a person may start with `~`; the shell is not there to
 * expand it, and posix_spawn reports a missing working directory as a
 * confusing ENOENT on the executable.
 */
export function expandHome(p: string): string;
export function expandHome(p: string | undefined): string | undefined;
export function expandHome(p: string | undefined): string | undefined {
	if (!p) return p;
	if (p === "~") return homedir();
	return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

export function defaultAgentCmd(): string[] {
	const fromEnv = process.env.DOTS_AGENT_CMD;
	if (fromEnv) return fromEnv.split(/\s+/);
	// stream-json out emits one JSON line per event as the agent works, which
	// is what lets the run view tail a node while it is still thinking.
	// stream-json in keeps stdin open, so time-budget notices can reach a
	// running agent as follow-up user messages.
	return [
		"claude",
		"-p",
		"--dangerously-skip-permissions",
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--verbose",
	];
}

/** Everything one run's execution carries between nodes. */
interface Ctx {
	bundle: GraphBundle;
	run: GraphRun;
	opts: RunnerOptions;
	byId: Map<string, RunNode>;
	live: Array<{ id: string; ancestry: string[]; proc: Bun.Subprocess }>;
	saving: Promise<void>;
}

const RANK: Record<RunNodeStatus, number> = {
	failed: 5,
	waiting: 4,
	running: 3,
	pending: 2,
	ok: 1,
	skipped: 0,
};

function worst(statuses: RunNodeStatus[]): RunNodeStatus {
	if (statuses.length === 0) return "ok";
	return statuses.reduce((a, b) => (RANK[a] >= RANK[b] ? a : b));
}

/** Container outcome from child outcomes; running/pending never leak out. */
function settle(statuses: RunNodeStatus[]): RunNodeStatus {
	const w = worst(statuses);
	return w === "running" || w === "pending" ? "failed" : w;
}

export function buildRun(
	bundle: GraphBundle,
	graphName: string,
	target: string,
): GraphRun {
	const startedAt = new Date().toISOString();
	const nodes: RunNode[] = [];
	const walk = (id: string, parentId: string | null, branch?: "no") => {
		const n = bundle.doc.nodes[id];
		if (!n) return;
		nodes.push({ id, parentId, ...(branch ? { branch } : {}), kind: n.kind, title: n.title, status: "pending" });
		for (const c of n.children) walk(c, id);
		for (const c of n.elseChildren ?? []) walk(c, id, "no");
	};
	walk(bundle.doc.root, null);
	return {
		runId: makeRunId(startedAt),
		graphName,
		target,
		startedAt,
		finishedAt: null,
		status: "running",
		nodes,
	};
}

function persist(ctx: Ctx): Promise<void> {
	// Saves chain, so a fast sequence of marks never interleaves two writes.
	ctx.saving = ctx.saving.then(() => saveRun(ctx.run));
	return ctx.saving;
}

async function mark(ctx: Ctx, id: string, patch: Partial<RunNode>): Promise<void> {
	const rn = ctx.byId.get(id);
	if (!rn) return;
	Object.assign(rn, patch);
	ctx.opts.onEvent?.(`${id} → ${rn.status}${rn.note ? ` · ${rn.note}` : ""}`);
	await persist(ctx);
}

function descendants(ctx: Ctx, id: string): string[] {
	const out: string[] = [];
	const walk = (nid: string) => {
		const n = ctx.bundle.doc.nodes[nid];
		if (!n) return;
		for (const c of allChildren(n)) {
			out.push(c);
			walk(c);
		}
	};
	walk(id);
	return out;
}

/** Marks every unfinished node under each of `roots` as skipped. */
async function skipBranch(ctx: Ctx, roots: string[], note: string): Promise<void> {
	for (const r of roots) {
		const rn = ctx.byId.get(r);
		if (rn && (rn.status === "pending" || rn.status === "running")) {
			await mark(ctx, r, { status: "skipped", note });
		}
		await skipSubtree(ctx, r, note);
	}
}

async function skipSubtree(ctx: Ctx, id: string, note: string): Promise<void> {
	for (const d of descendants(ctx, id)) {
		const rn = ctx.byId.get(d);
		if (rn && (rn.status === "pending" || rn.status === "running")) {
			await mark(ctx, d, { status: "skipped", note });
		}
	}
}

interface AgentMeta {
	sessionId?: string;
	costUsd?: number;
}

/**
 * Fallback for an agent that does not speak stream-json: a single claude
 * JSON envelope still unwraps (`.result`, `.session_id`), and plain text is
 * taken whole.
 */
function unwrapReply(stdout: string): { text: string; meta: AgentMeta } {
	try {
		const parsed = JSON.parse(stdout) as {
			result?: string;
			session_id?: string;
			total_cost_usd?: number;
		};
		if (typeof parsed.result === "string") {
			return {
				text: parsed.result,
				meta: { sessionId: parsed.session_id, costUsd: parsed.total_cost_usd },
			};
		}
	} catch {
		// Plain-text agent.
	}
	return { text: stdout, meta: {} };
}

function summarizeToolInput(input: unknown): string {
	const s = JSON.stringify(input) ?? "";
	return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

/** The nearest enclosing budget, threaded down from the budget node. */
export interface Timebox {
	/** Epoch ms at which the budget expires. */
	deadline: number;
	title: string;
}

function promptBudget(b?: Timebox): { title: string; minutesLeft: number } | undefined {
	return b
		? { title: b.title, minutesLeft: Math.max(1, Math.round((b.deadline - Date.now()) / 60_000)) }
		: undefined;
}

function userMessage(text: string): string {
	return `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } })}\n`;
}

async function spawnAgent(
	ctx: Ctx,
	id: string,
	ancestry: string[],
	prompt: string,
	deadline?: number,
	model?: string,
): Promise<{ ok: boolean; stdout: string; detail: string; meta: AgentMeta }> {
	// With stream-json input, stdin stays open after the prompt, so budget
	// notices can reach the running agent. An agent command without that
	// flag (a stub, plain claude json mode) gets the prompt and EOF at once.
	const streaming = ctx.opts.agentCmd.includes("--input-format");
	// A margin comment points back to the session that wrote it. Claude takes
	// its session id up front, and the same id goes into the environment, so
	// the margin CLI's $CLAUDE_SESSION_ID default fills the pointer without
	// the agent doing anything.
	const sessionId = crypto.randomUUID();
	const isClaude = ctx.opts.agentCmd[0]?.includes("claude");
	const cmd = [
		...ctx.opts.agentCmd,
		...(isClaude ? ["--session-id", sessionId] : []),
		...(model ? ["--model", model] : []),
	];
	const proc = Bun.spawn({
		cmd,
		cwd: ctx.opts.cwd,
		stdin: streaming ? "pipe" : new TextEncoder().encode(prompt),
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			CLAUDE_SESSION_ID: sessionId,
			DOTS_NODE_ID: id,
			DOTS_GRAPH: ctx.run.graphName,
			DOTS_RUN_ID: ctx.run.runId,
		},
	});
	const sink = streaming ? (proc.stdin as Bun.FileSink) : null;
	let inputOpen = false;
	if (sink) {
		inputOpen = true;
		sink.write(userMessage(prompt));
		void sink.flush();
	}
	const closeInput = () => {
		if (!sink || !inputOpen) return;
		inputOpen = false;
		try {
			void sink.end();
		} catch {
			// the process is already gone
		}
	};
	const warnTimers: Array<ReturnType<typeof setTimeout>> = [];
	if (sink && deadline) {
		for (const m of [5, 3, 1]) {
			const delay = deadline - m * 60_000 - Date.now();
			if (delay > 5_000) {
				warnTimers.push(
					setTimeout(() => {
						if (!inputOpen) return;
						try {
							sink.write(
								userMessage(
									`Time budget notice: about ${m} minute${m === 1 ? "" : "s"} left for your group. Wrap up and return your result now.`,
								),
							);
							void sink.flush();
							void appendNodeFile(ctx.run, `${id}.stream.txt`, `\n⏳ ${m} minute${m === 1 ? "" : "s"} left in the time budget\n`);
						} catch {
							// the process is already gone
						}
					}, delay),
				);
			}
		}
	}
	await saveNodeFile(ctx.run, `${id}.prompt.txt`, prompt);
	await saveNodeFile(ctx.run, `${id}.stream.txt`, "");
	const entry = { id, ancestry, proc };
	ctx.live.push(entry);
	const timer = setTimeout(
		() => proc.kill(),
		ctx.opts.nodeTimeoutMinutes * 60_000,
	);
	const stderrDone = new Response(proc.stderr).text();

	// stdout is consumed as it arrives. stream-json events become a readable
	// tail in `<node>.stream.txt`; the `result` event carries the reply. An
	// agent that prints plain text streams as-is and is unwrapped at the end.
	let raw = "";
	let lineBuf = "";
	const final: { text?: string; sessionId?: string; costUsd?: number } = {};
	const decoder = new TextDecoder();
	const onLine = (line: string): string => {
		const trimmed = line.trim();
		if (!trimmed) return "";
		try {
			const ev = JSON.parse(trimmed) as {
				type?: string;
				session_id?: string;
				result?: string;
				total_cost_usd?: number;
				message?: { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> };
			};
			if (ev && typeof ev.type === "string") {
				if (ev.session_id) final.sessionId = ev.session_id;
				if (ev.type === "assistant") {
					let out = "";
					for (const block of ev.message?.content ?? []) {
						if (block.type === "text" && block.text) out += `${block.text}\n`;
						else if (block.type === "tool_use") out += `⏺ ${block.name} ${summarizeToolInput(block.input)}\n`;
					}
					return out;
				}
				if (ev.type === "result") {
					if (typeof ev.result === "string") final.text = ev.result;
					if (typeof ev.total_cost_usd === "number") final.costUsd = ev.total_cost_usd;
					// The reply is in: no more notices, and EOF lets claude exit.
					for (const t of warnTimers) clearTimeout(t);
					closeInput();
				}
				// system, user, and tool-result events are noise for the tail
				return "";
			}
		} catch {
			// plain-text agent
		}
		return `${line}\n`;
	};
	for await (const chunk of proc.stdout) {
		const text = decoder.decode(chunk, { stream: true });
		raw += text;
		lineBuf += text;
		let batch = "";
		let nl: number;
		while ((nl = lineBuf.indexOf("\n")) >= 0) {
			batch += onLine(lineBuf.slice(0, nl));
			lineBuf = lineBuf.slice(nl + 1);
		}
		if (batch) await appendNodeFile(ctx.run, `${id}.stream.txt`, batch);
	}
	const tail = onLine(lineBuf);
	if (tail) await appendNodeFile(ctx.run, `${id}.stream.txt`, tail);
	for (const t of warnTimers) clearTimeout(t);
	closeInput();

	const [stderr, code] = await Promise.all([stderrDone, proc.exited]);
	clearTimeout(timer);
	ctx.live.splice(ctx.live.indexOf(entry), 1);
	const fallback = unwrapReply(raw);
	const text = final.text ?? fallback.text;
	const meta: AgentMeta = {
		sessionId: final.sessionId ?? fallback.meta.sessionId,
		costUsd: final.costUsd ?? fallback.meta.costUsd,
	};
	await saveNodeFile(ctx.run, `${id}.txt`, text + (stderr ? `\n--- stderr ---\n${stderr}` : ""));
	if (code !== 0) {
		return {
			ok: false,
			stdout: text,
			detail: `agent exited ${code}: ${stderr.trim().split("\n").pop() ?? ""}`.trim(),
			meta,
		};
	}
	return { ok: true, stdout: text, detail: "", meta };
}

type NodeResult = { status: RunNodeStatus; output: string };

async function runChildrenSequence(
	ctx: Ctx,
	ids: string[],
	input: string,
	ancestry: string[],
	budget?: Timebox,
): Promise<{ statuses: RunNodeStatus[]; output: string }> {
	const statuses: RunNodeStatus[] = [];
	let carried = input;
	let halted: string | null = null;
	for (const id of ids) {
		if (halted) {
			const rn = ctx.byId.get(id);
			if (rn && rn.status === "pending") {
				await mark(ctx, id, { status: "skipped", note: `"${halted}" failed earlier in the sequence` });
			}
			statuses.push("skipped");
			continue;
		}
		const res = await runNode(ctx, id, carried, ancestry, budget);
		statuses.push(res.status);
		if (res.status === "failed") halted = ctx.byId.get(id)?.title ?? id;
		if (res.status === "waiting") break; // the rest stays pending for the resume
		if (res.output) carried = res.output;
	}
	return { statuses, output: carried };
}

async function runNode(
	ctx: Ctx,
	id: string,
	input: string,
	ancestry: string[],
	budget?: Timebox,
): Promise<NodeResult> {
	const gn = ctx.bundle.doc.nodes[id];
	const rn = ctx.byId.get(id);
	if (!gn || !rn) return { status: "failed", output: "" };
	// A resume replays what already settled and re-tries what failed.
	if (rn.status === "ok" || rn.status === "skipped") {
		return { status: rn.status, output: rn.output ?? "" };
	}
	if (rn.status === "waiting" && gn.kind === "human") {
		// Still parked; only approve or reject moves it. A container that was
		// marked waiting re-enters instead, to walk its children again.
		return { status: "waiting", output: rn.output ?? "" };
	}
	const kids = gn.children.filter((c) => ctx.bundle.doc.nodes[c]);
	const below = [...ancestry, id];
	await mark(ctx, id, { status: "running", startedAt: new Date().toISOString(), note: undefined });

	const finish = async (status: RunNodeStatus, patch: Partial<RunNode>, output: string): Promise<NodeResult> => {
		await mark(ctx, id, { ...patch, status, finishedAt: new Date().toISOString() });
		return { status, output };
	};

	switch (gn.kind) {
		case "agent": {
			await saveNodeFile(ctx.run, `${id}.input.txt`, input);
			const prompt = composePrompt({ bundle: ctx.bundle, id, node: gn, input, target: ctx.run.target, vars: ctx.opts.vars, askCommand: ctx.opts.askCommand, budget: promptBudget(budget) });
			const res = await spawnAgent(ctx, id, below, prompt, budget?.deadline, gn.model);
			if (!res.ok) return finish("failed", { note: res.detail, ...res.meta }, "");
			const parsed = parseReply(res.stdout);
			if (parsed.skipped) return finish("skipped", { note: parsed.note, ...res.meta }, "");
			return finish("ok", { output: parsed.output, ...res.meta }, parsed.output);
		}
		case "human": {
			// Parks with the content to judge in `output`; approve or reject
			// settles it, then a resume carries on.
			await mark(ctx, id, { status: "waiting", note: (ctx.bundle.instructions[id] ?? "").split("\n")[0], output: input });
			return { status: "waiting", output: "" };
		}
		case "gate": {
			const noKids = (gn.elseChildren ?? []).filter((c) => ctx.bundle.doc.nodes[c]);
			await saveNodeFile(ctx.run, `${id}.input.txt`, input);
			const prompt = composePrompt({ bundle: ctx.bundle, id, node: gn, input, target: ctx.run.target, vars: ctx.opts.vars, askCommand: ctx.opts.askCommand, budget: promptBudget(budget) });
			const res = await spawnAgent(ctx, id, below, prompt, budget?.deadline, gn.model);
			res.meta.sessionId && (rn.sessionId = res.meta.sessionId);
			res.meta.costUsd !== undefined && (rn.costUsd = res.meta.costUsd);
			if (!res.ok) {
				await skipBranch(ctx, [...kids, ...noKids], "the gate failed");
				return finish("failed", { note: res.detail }, "");
			}
			const parsed = parseReply(res.stdout);
			if (parsed.verdict !== "yes" && parsed.verdict !== "no") {
				await skipBranch(ctx, [...kids, ...noKids], "the gate gave no verdict");
				return finish("failed", { note: "no YES or NO in the reply" }, "");
			}
			const word = parsed.verdict.toUpperCase();
			await mark(ctx, id, { note: parsed.note ? `${word}: ${parsed.note}` : word, output: parsed.output });
			const taken = parsed.verdict === "yes" ? kids : noKids;
			const skipped = parsed.verdict === "yes" ? noKids : kids;
			await skipBranch(ctx, skipped, `the gate answered ${word}`);
			// An empty branch is a plain skip: the flow moves on with its input.
			if (taken.length === 0) return finish("ok", {}, input);
			const results = await Promise.all(taken.map((c) => runNode(ctx, c, input, below, budget)));
			return finish(settle(results.map((r) => r.status)), {}, results.map((r) => r.output).filter(Boolean).join("\n\n"));
		}
		case "parallel": {
			const results = await Promise.all(kids.map((c) => runNode(ctx, c, input, below, budget)));
			return finish(settle(results.map((r) => r.status)), {}, results.map((r) => r.output).filter(Boolean).join("\n\n"));
		}
		case "sequence": {
			const { statuses, output } = await runChildrenSequence(ctx, kids, input, below, budget);
			const open = kids.some((c) => ctx.byId.get(c)?.status === "pending");
			const status = open && statuses.includes("waiting") ? "waiting" : settle(statuses);
			return finish(status === "running" ? "failed" : status, {}, output);
		}
		case "budget": {
			const ms = (gn.minutes ?? 10) * 60_000;
			let tripped = false;
			const timer = setTimeout(() => {
				tripped = true;
				for (const entry of [...ctx.live]) {
					if (entry.ancestry.includes(id)) entry.proc.kill();
				}
			}, ms);
			// Everything inside learns the box and gets countdown notices.
			const childBudget: Timebox = { deadline: Date.now() + ms, title: gn.title };
			const results = await Promise.all(kids.map((c) => runNode(ctx, c, input, below, childBudget)));
			clearTimeout(timer);
			if (tripped) {
				for (const d of descendants(ctx, id)) {
					const drn = ctx.byId.get(d);
					if (drn && (drn.status === "failed" || drn.status === "running" || drn.status === "pending")) {
						await mark(ctx, d, { status: drn.status === "failed" ? "failed" : "skipped", note: `budget exceeded (${gn.minutes}m)` });
					}
				}
				return finish("failed", { note: `budget exceeded (${gn.minutes}m)` }, "");
			}
			return finish(settle(results.map((r) => r.status)), {}, results.map((r) => r.output).filter(Boolean).join("\n\n"));
		}
		case "loop": {
			const max = gn.maxRounds ?? 1;
			let output = input;
			for (let round = 1; round <= max; round++) {
				await mark(ctx, id, { round, status: "running" });
				if (round > 1) {
					for (const d of descendants(ctx, id)) {
						await mark(ctx, d, { status: "pending", note: `round ${round}`, startedAt: undefined, finishedAt: undefined });
					}
				}
				const { statuses, output: roundOut } = await runChildrenSequence(ctx, kids, output, below, budget);
				if (statuses.includes("waiting")) return finish("waiting", {}, roundOut);
				if (settle(statuses) === "failed") return finish("failed", { note: `round ${round} failed` }, roundOut);
				output = roundOut;
				const prompt = composePrompt({ bundle: ctx.bundle, id, node: gn, input: output, target: ctx.run.target, vars: ctx.opts.vars, askCommand: ctx.opts.askCommand, budget: promptBudget(budget) });
				const res = await spawnAgent(ctx, id, below, prompt, budget?.deadline, gn.model);
				if (!res.ok) return finish("failed", { note: res.detail }, output);
				const parsed = parseReply(res.stdout);
				if (parsed.verdict === "done") {
					return finish("ok", { note: `DONE after round ${round}: ${parsed.note}` }, output);
				}
				if (parsed.verdict !== "again") {
					return finish("failed", { note: "no DONE or AGAIN in the exit check" }, output);
				}
				if (round === max) {
					return finish("ok", { note: `rounds exhausted, still: ${parsed.note}` }, output);
				}
			}
			return finish("ok", {}, output);
		}
	}
}

/**
 * A one-node scratch run for trying a single node by hand. Its id starts
 * with `test-`, so `listRuns` never shows it in run history, but the run
 * file and its `runs/<runId>.d/` transcripts land on disk like any other
 * run: `dots debug --run <id>` can still resume the agent behind a test.
 */
export function buildTestRun(
	bundle: GraphBundle,
	graphName: string,
	nodeId: string,
	target: string,
): GraphRun {
	const gn = bundle.doc.nodes[nodeId];
	if (!gn) throw new Error(`no node "${nodeId}" in this graph`);
	const startedAt = new Date().toISOString();
	return {
		runId: `test-${startedAt.replace(/[:.]/g, "-")}`,
		graphName,
		target,
		startedAt,
		finishedAt: null,
		status: "running",
		nodes: [{ id: nodeId, parentId: null, kind: gn.kind, title: gn.title, status: "pending" }],
	};
}

/**
 * Re-runs one agent, gate, or loop-exit node in place, with its recorded
 * input and the graph's CURRENT instructions: the loop for debugging a node
 * is edit `nodes/<id>.md`, `dots retry`, read the reply. Children are not
 * re-run and downstream results stand; a full re-review is a new run.
 */
export async function retryNode(
	bundle: GraphBundle,
	run: GraphRun,
	nodeId: string,
	opts: RunnerOptions,
): Promise<RunNode> {
	const gn = bundle.doc.nodes[nodeId];
	const rn = run.nodes.find((n) => n.id === nodeId);
	if (!gn || !rn) throw new Error(`no node "${nodeId}" in this run`);
	if (gn.kind !== "agent" && gn.kind !== "gate" && gn.kind !== "loop") {
		throw new Error(`retry runs agent, gate, and loop nodes; ${nodeId} is a ${gn.kind}`);
	}
	const ctx: Ctx = {
		bundle,
		run,
		opts,
		byId: new Map(run.nodes.map((n) => [n.id, n])),
		live: [],
		saving: Promise.resolve(),
	};
	const input = await readNodeFile(run, `${nodeId}.input.txt`);
	await mark(ctx, nodeId, { status: "running", startedAt: new Date().toISOString(), note: undefined });
	const prompt = composePrompt({ bundle, id: nodeId, node: gn, input, target: run.target, vars: opts.vars, askCommand: opts.askCommand });
	const res = await spawnAgent(ctx, nodeId, [nodeId], prompt, undefined, gn.model);
	const done = new Date().toISOString();
	if (!res.ok) {
		await mark(ctx, nodeId, { status: "failed", note: res.detail, finishedAt: done, ...res.meta });
	} else {
		const parsed = parseReply(res.stdout);
		if (gn.kind === "gate") {
			const verdictNote = parsed.verdict ? `${parsed.verdict.toUpperCase()}: ${parsed.note}` : "no verdict";
			await mark(ctx, nodeId, {
				status: parsed.verdict === "no" ? "skipped" : parsed.verdict === "yes" ? "ok" : "failed",
				note: verdictNote,
				output: parsed.output,
				finishedAt: done,
				...res.meta,
			});
		} else if (gn.kind === "loop") {
			const answered = parsed.verdict === "done" || parsed.verdict === "again";
			await mark(ctx, nodeId, {
				status: answered ? "ok" : "failed",
				note: answered ? `${parsed.verdict!.toUpperCase()}: ${parsed.note}` : "no DONE or AGAIN in the reply",
				output: parsed.output,
				finishedAt: done,
				...res.meta,
			});
		} else if (parsed.skipped) {
			await mark(ctx, nodeId, { status: "skipped", note: parsed.note, finishedAt: done, ...res.meta });
		} else {
			await mark(ctx, nodeId, {
				status: "ok",
				output: parsed.output,
				finishedAt: done,
				...res.meta,
			});
		}
	}
	await ctx.saving;
	return rn;
}

/** Runs (or resumes) a run to its next stop: done, failed, or waiting. */
export async function executeRun(
	bundle: GraphBundle,
	run: GraphRun,
	opts: RunnerOptions,
): Promise<GraphRun> {
	const ctx: Ctx = {
		bundle,
		run,
		opts,
		byId: new Map(run.nodes.map((n) => [n.id, n])),
		live: [],
		saving: Promise.resolve(),
	};
	run.status = "running";
	await persist(ctx);
	const result = await runNode(ctx, bundle.doc.root, "", []);
	const anyWaiting = run.nodes.some((n) => n.status === "waiting");
	run.status = anyWaiting ? "waiting" : result.status === "failed" ? "failed" : "done";
	run.finishedAt = anyWaiting ? null : new Date().toISOString();
	await persist(ctx);
	await ctx.saving;
	return run;
}
