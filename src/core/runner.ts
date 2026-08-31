import { composePrompt, parseReply } from "./prompt";
import { makeRunId, saveRun, saveTranscript } from "./runstore";
import type {
	GraphBundle,
	GraphRun,
	RunNode,
	RunNodeStatus,
} from "./types";

export interface RunnerOptions {
	target: string;
	vars: Record<string, string>;
	/** The agent command; the node's prompt arrives on stdin. */
	agentCmd: string[];
	/** Where agents run, normally the repository under review. */
	cwd: string;
	/** Kills a single node's agent after this many minutes. */
	nodeTimeoutMinutes: number;
	onEvent?: (line: string) => void;
}

export function defaultAgentCmd(): string[] {
	const fromEnv = process.env.DOTS_AGENT_CMD;
	if (fromEnv) return fromEnv.split(/\s+/);
	return ["claude", "-p", "--dangerously-skip-permissions"];
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
	failed: 6,
	waiting: 5,
	items: 4,
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
	const walk = (id: string, parentId: string | null) => {
		const n = bundle.doc.nodes[id];
		if (!n) return;
		nodes.push({ id, parentId, kind: n.kind, title: n.title, status: "pending" });
		for (const c of n.children) walk(c, id);
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
		for (const c of ctx.bundle.doc.nodes[nid]?.children ?? []) {
			out.push(c);
			walk(c);
		}
	};
	walk(id);
	return out;
}

async function skipSubtree(ctx: Ctx, id: string, note: string): Promise<void> {
	for (const d of descendants(ctx, id)) {
		const rn = ctx.byId.get(d);
		if (rn && (rn.status === "pending" || rn.status === "running")) {
			await mark(ctx, d, { status: "skipped", note });
		}
	}
}

async function spawnAgent(
	ctx: Ctx,
	id: string,
	ancestry: string[],
	prompt: string,
): Promise<{ ok: boolean; stdout: string; detail: string }> {
	const proc = Bun.spawn({
		cmd: ctx.opts.agentCmd,
		cwd: ctx.opts.cwd,
		stdin: new TextEncoder().encode(prompt),
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			DOTS_NODE_ID: id,
			DOTS_GRAPH: ctx.run.graphName,
			DOTS_RUN_ID: ctx.run.runId,
		},
	});
	const entry = { id, ancestry, proc };
	ctx.live.push(entry);
	const timer = setTimeout(
		() => proc.kill(),
		ctx.opts.nodeTimeoutMinutes * 60_000,
	);
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	clearTimeout(timer);
	ctx.live.splice(ctx.live.indexOf(entry), 1);
	await saveTranscript(ctx.run, id, stdout + (stderr ? `\n--- stderr ---\n${stderr}` : ""));
	if (code !== 0) {
		return {
			ok: false,
			stdout,
			detail: `agent exited ${code}: ${stderr.trim().split("\n").pop() ?? ""}`.trim(),
		};
	}
	return { ok: true, stdout, detail: "" };
}

type NodeResult = { status: RunNodeStatus; output: string };

async function runChildrenSequence(
	ctx: Ctx,
	ids: string[],
	input: string,
	ancestry: string[],
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
		const res = await runNode(ctx, id, carried, ancestry);
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
): Promise<NodeResult> {
	const gn = ctx.bundle.doc.nodes[id];
	const rn = ctx.byId.get(id);
	if (!gn || !rn) return { status: "failed", output: "" };
	// A resume replays what already settled and re-tries what failed.
	if (rn.status === "ok" || rn.status === "items" || rn.status === "skipped") {
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
			const prompt = composePrompt({ bundle: ctx.bundle, id, node: gn, input, target: ctx.run.target, vars: ctx.opts.vars });
			const res = await spawnAgent(ctx, id, below, prompt);
			if (!res.ok) return finish("failed", { note: res.detail }, "");
			const parsed = parseReply(res.stdout);
			if (parsed.skipped) return finish("skipped", { note: parsed.note }, "");
			const status = parsed.findings > 0 ? "items" : "ok";
			return finish(status, { count: parsed.findings || undefined, output: parsed.output }, parsed.output);
		}
		case "human": {
			// Parks with the content to judge in `output`; approve or reject
			// settles it, then a resume carries on.
			await mark(ctx, id, { status: "waiting", note: (ctx.bundle.instructions[id] ?? "").split("\n")[0], output: input });
			return { status: "waiting", output: "" };
		}
		case "gate": {
			const prompt = composePrompt({ bundle: ctx.bundle, id, node: gn, input, target: ctx.run.target, vars: ctx.opts.vars });
			const res = await spawnAgent(ctx, id, below, prompt);
			if (!res.ok) {
				await skipSubtree(ctx, id, "the gate failed");
				return finish("failed", { note: res.detail }, "");
			}
			const parsed = parseReply(res.stdout);
			if (parsed.verdict === "no") {
				await mark(ctx, id, { note: `NO: ${parsed.note}`, output: parsed.output });
				await skipSubtree(ctx, id, `gate said no: ${parsed.note}`);
				return finish("skipped", {}, "");
			}
			if (parsed.verdict !== "yes") {
				await skipSubtree(ctx, id, "the gate gave no verdict");
				return finish("failed", { note: "no YES or NO in the reply" }, "");
			}
			await mark(ctx, id, { note: `YES: ${parsed.note}`, output: parsed.output });
			const childInput = `${input.trim()}\n\nGate focus: ${parsed.output}`.trim();
			const results = await Promise.all(kids.map((c) => runNode(ctx, c, childInput, below)));
			return finish(settle(results.map((r) => r.status)), {}, results.map((r) => r.output).filter(Boolean).join("\n\n"));
		}
		case "parallel": {
			const results = await Promise.all(kids.map((c) => runNode(ctx, c, input, below)));
			return finish(settle(results.map((r) => r.status)), {}, results.map((r) => r.output).filter(Boolean).join("\n\n"));
		}
		case "sequence": {
			const { statuses, output } = await runChildrenSequence(ctx, kids, input, below);
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
			const results = await Promise.all(kids.map((c) => runNode(ctx, c, input, below)));
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
				const { statuses, output: roundOut } = await runChildrenSequence(ctx, kids, output, below);
				if (statuses.includes("waiting")) return finish("waiting", {}, roundOut);
				if (settle(statuses) === "failed") return finish("failed", { note: `round ${round} failed` }, roundOut);
				output = roundOut;
				const prompt = composePrompt({ bundle: ctx.bundle, id, node: gn, input: output, target: ctx.run.target, vars: ctx.opts.vars });
				const res = await spawnAgent(ctx, id, below, prompt);
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
