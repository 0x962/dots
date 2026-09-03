#!/usr/bin/env bun
import { join } from "node:path";
import { defaultHarnessId, harness, isHarnessId } from "./core/harness";
import { agentCmdOverride, buildRun, executeRun, expandHome, retryNode } from "./core/runner";
import { latestRun, listRuns, loadRun, nodeFilesDir, readNodeFile, saveRun } from "./core/runstore";
import { graphsRoot, loadGraph } from "./core/store";
import { validateGraph } from "./core/validate";

function usage(): never {
	console.log(`dots — run agent graphs

  dots start <graph> --target <text> [--var K=V]... [--cwd <dir>]
      detached run through the server; prints {"runId": ...} at once
  dots status <graph> [runId] [--json]   run state, per-node; latest when no id
  dots run <graph> --target <text> [--var K=V]... [--cwd <dir>] [--harness claude|pi]
  dots resume <graph> [runId] [--cwd <dir>]
  dots approve <graph> <nodeId> [--note <text>] [--run <runId>]
  dots reject <graph> <nodeId> [--note <text>] [--run <runId>]
  dots runs <graph> [--json]
  dots plan <graph>
  dots show <graph> <nodeId> [--run <runId>] [--prompt] [--reply]
  dots retry <graph> <nodeId> [--run <runId>] [--cwd <dir>]
  dots debug <graph> <nodeId> [--run <runId>]   resume the node's agent session
  dots ask <graph> <nodeId> "<question>" [--run <runId>]   one question, answered
      from the node agent's own session; nodes get this too, so later agents
      can question earlier ones instead of guessing

Every node runs in a harness: claude (Claude Code) or pi
(@mariozechner/pi-coding-agent, which reaches Vercel AI Gateway, OpenRouter,
and the model providers directly). A node's own choice wins, then the
graph's, then --harness, then DOTS_HARNESS, then claude. DOTS_AGENT_CMD
replaces the harness command for every node. Each node's prompt arrives on
stdin.`);
	process.exit(1);
}

function flags(argv: string[]): { pos: string[]; opt: Record<string, string>; vars: Record<string, string> } {
	const pos: string[] = [];
	const opt: Record<string, string> = {};
	const vars: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--") {
			pos.push(...argv.slice(i + 1));
			break;
		}
		if (a === "--var") {
			const [k, ...v] = (argv[++i] ?? "").split("=");
			vars[k] = v.join("=");
		} else if (a.startsWith("--")) {
			opt[a.slice(2)] = argv[++i] ?? "";
		} else pos.push(a);
	}
	return { pos, opt, vars };
}

function askCommandFor(runId: string): string {
	// Agents run this from the repo under review; the graphs folder must not
	// resolve relative to their cwd.
	return `DOTS_GRAPHS_DIR="${graphsRoot()}" ${process.execPath} ${import.meta.path} ask ${graphName} --run ${runId} --`;
}

function opts(opt: Record<string, string>, vars: Record<string, string>, target: string, runId?: string) {
	return {
		target,
		vars,
		harness: isHarnessId(opt.harness) ? opt.harness : defaultHarnessId(),
		agentCmd: agentCmdOverride(),
		cwd: expandHome(opt.cwd) ?? process.cwd(),
		nodeTimeoutMinutes: Number(process.env.DOTS_NODE_TIMEOUT_MIN ?? 30),
		askCommand: runId ? askCommandFor(runId) : undefined,
		onEvent: (line: string) => console.log(`  ${line}`),
	};
}

const [cmd, ...rest] = process.argv.slice(2);
const { pos, opt, vars } = flags(rest);
const graphName = pos[0];

if (!cmd || !graphName) usage();
const bundle = await loadGraph(graphName);
const problems = validateGraph(bundle);
if (problems.length > 0 && cmd !== "plan") {
	console.error(`The graph does not validate:\n  ${problems.join("\n  ")}`);
	process.exit(1);
}

if (cmd === "run") {
	if (!opt.target) usage();
	const run = buildRun(bundle, graphName, opt.target);
	run.cwd = opt.cwd ?? process.cwd();
	run.vars = vars;
	await saveRun(run);
	console.log(`${run.runId} · ${run.nodes.length} nodes · target: ${opt.target}`);
	const done = await executeRun(bundle, run, opts(opt, vars, opt.target, run.runId));
	console.log(`${done.status}${done.note ? ` · ${done.note}` : ""}`);
	process.exit(done.status === "failed" ? 1 : 0);
} else if (cmd === "resume") {
	const run = pos[1] ? await loadRun(graphName, pos[1]) : await latestRun(graphName);
	if (!run) {
		console.error("no runs");
		process.exit(1);
	}
	const done = await executeRun(bundle, run, {
		...opts(opt, { ...(run.vars ?? {}), ...vars }, run.target, run.runId),
		cwd: expandHome(opt.cwd ?? run.cwd) ?? process.cwd(),
	});
	console.log(`${done.status}`);
	process.exit(done.status === "failed" ? 1 : 0);
} else if (cmd === "approve" || cmd === "reject") {
	const nodeId = pos[1];
	if (!nodeId) usage();
	const run = opt.run ? await loadRun(graphName, opt.run) : await latestRun(graphName);
	if (!run) {
		console.error("no runs");
		process.exit(1);
	}
	const rn = run.nodes.find((n) => n.id === nodeId);
	if (!rn || rn.status !== "waiting") {
		console.error(`${nodeId} is not waiting (${rn?.status ?? "missing"})`);
		process.exit(1);
	}
	rn.status = cmd === "approve" ? "ok" : "failed";
	rn.note = `${cmd === "approve" ? "approved" : "rejected"}${opt.note ? `: ${opt.note}` : ""}`;
	rn.output = `${cmd === "approve" ? "APPROVED" : "REJECTED"}${opt.note ? `: ${opt.note}` : ""}`;
	rn.finishedAt = new Date().toISOString();
	await saveRun(run);
	console.log(`${nodeId} ${rn.note} · resume with: dots resume ${graphName}`);
} else if (cmd === "ask") {
	// `--` separates the node id and question when this command is composed
	// into a node prompt; positionals after it land in pos as usual.
	const nodeId = pos[1];
	const question = pos.slice(2).join(" ");
	if (!nodeId || !question.trim()) usage();
	const run = opt.run ? await loadRun(graphName, opt.run) : await latestRun(graphName);
	if (!run) {
		console.error("no runs");
		process.exit(1);
	}
	const rn = run.nodes.find((n) => n.id === nodeId);
	if (!rn?.sessionId) {
		console.error(`${nodeId} has no agent session to ask (status: ${rn?.status ?? "missing"}).`);
		process.exit(1);
	}
	const sessionDir = join(nodeFilesDir(run), `${nodeId}.session`);
	const cmdline = process.env.DOTS_ASK_CMD
		? process.env.DOTS_ASK_CMD.replace("{SESSION}", rn.sessionId).split(/\s+/)
		: harness(rn.harness ?? "claude").ask({ sessionId: rn.sessionId, sessionDir });
	const proc = Bun.spawn({
		cmd: cmdline,
		cwd: expandHome(run.cwd) ?? process.cwd(),
		stdin: new TextEncoder().encode(question),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [answer, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) {
		console.error(`ask failed: ${err.trim().split("\n").pop() ?? ""}`);
		process.exit(1);
	}
	const { saveNodeFile, readNodeFile: readAsk } = await import("./core/runstore");
	const log = await readAsk(run, `${nodeId}.asks.txt`);
	await saveNodeFile(run, `${nodeId}.asks.txt`, `${log}Q: ${question}\nA: ${answer.trim()}\n\n`);
	console.log(answer.trim());
} else if (cmd === "show" || cmd === "retry" || cmd === "debug") {
	const nodeId = pos[1];
	if (!nodeId) usage();
	const run = opt.run ? await loadRun(graphName, opt.run) : await latestRun(graphName);
	if (!run) {
		console.error("no runs");
		process.exit(1);
	}
	const rn = run.nodes.find((n) => n.id === nodeId);
	if (!rn) {
		console.error(`no node "${nodeId}" in ${run.runId}`);
		process.exit(1);
	}
	if (cmd === "show") {
		if (opt.prompt !== undefined || "prompt" in opt) {
			console.log(await readNodeFile(run, `${nodeId}.prompt.txt`));
		} else if ("reply" in opt) {
			console.log(await readNodeFile(run, `${nodeId}.txt`));
		} else {
			const dur =
				rn.startedAt && rn.finishedAt
					? `${((Date.parse(rn.finishedAt) - Date.parse(rn.startedAt)) / 1000).toFixed(1)}s`
					: "-";
			console.log(`${nodeId} [${rn.kind}] · ${rn.status}${rn.note ? ` · ${rn.note}` : ""}`);
			console.log(`run ${run.runId} · ${dur}${rn.costUsd !== undefined ? ` · $${rn.costUsd.toFixed(4)}` : ""}${rn.sessionId ? ` · session ${rn.sessionId}` : ""}`);
			const reply = await readNodeFile(run, `${nodeId}.txt`);
			if (reply) console.log(`\n--- reply (dots show ${graphName} ${nodeId} --reply for all) ---\n${reply.slice(0, 2000)}`);
			console.log(`\nfiles: runs/${run.runId}.d/${nodeId}.{prompt.txt,input.txt,txt}`);
		}
	} else if (cmd === "retry") {
		const done = await retryNode(bundle, run, nodeId, opts(opt, vars, run.target, run.runId));
		console.log(`${nodeId} → ${done.status}${done.note ? ` · ${done.note}` : ""}`);
	} else {
		if (!rn.sessionId) {
			console.error(`${nodeId} recorded no agent session (a stub agent, or the node never spawned).`);
			process.exit(1);
		}
		const h = harness(rn.harness ?? "claude");
		console.log(`resuming the ${h.label} session ${rn.sessionId} · exit that chat to come back`);
		const proc = Bun.spawn({
			cmd: h.resume({ sessionId: rn.sessionId, sessionDir: join(nodeFilesDir(run), `${nodeId}.session`) }),
			stdio: ["inherit", "inherit", "inherit"],
			cwd: expandHome(opt.cwd ?? run.cwd) ?? process.cwd(),
		});
		process.exit(await proc.exited);
	}
} else if (cmd === "start") {
	const target = opt.target ?? "";
	if (!target.trim()) usage();
	const port = Number(process.env.DOTS_PORT ?? 4517);
	const res = await fetch(`http://localhost:${port}/api/graphs/${graphName}/runs`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ target, cwd: opt.cwd, vars }),
	}).catch(() => null);
	if (!res) {
		console.error(`the dots server does not answer on :${port}; start it (bun dev) or use \`dots run\``);
		process.exit(1);
	}
	const body = (await res.json()) as { runId?: string; error?: string };
	if (!res.ok || !body.runId) {
		console.error(body.error ?? `start failed (${res.status})`);
		process.exit(1);
	}
	console.log(
		JSON.stringify({
			runId: body.runId,
			graph: graphName,
			status: "running",
			board: `http://dots.localhost/runs`,
			statusCommand: `dots status ${graphName} ${body.runId}`,
		}),
	);
} else if (cmd === "status") {
	const run = pos[1] ? await loadRun(graphName, pos[1]) : await latestRun(graphName);
	if (!run) {
		console.error("no runs");
		process.exit(1);
	}
	const counts: Record<string, number> = {};
	for (const n of run.nodes) counts[n.status] = (counts[n.status] ?? 0) + 1;
	const costUsd = run.nodes.reduce((t, n) => t + (n.costUsd ?? 0), 0);
	const elapsedSeconds = Math.round(
		((run.finishedAt ? Date.parse(run.finishedAt) : Date.now()) - Date.parse(run.startedAt)) / 1000,
	);
	const summary = {
		runId: run.runId,
		graph: graphName,
		status: run.status,
		target: run.target,
		note: run.note ?? null,
		startedAt: run.startedAt,
		finishedAt: run.finishedAt,
		elapsedSeconds,
		costUsd: Number(costUsd.toFixed(4)),
		counts,
		nodes: run.nodes.map((n) => ({ id: n.id, kind: n.kind, status: n.status, note: n.note ?? null })),
	};
	if (!process.stdout.isTTY || "json" in opt) {
		console.log(JSON.stringify(summary, null, 2));
	} else {
		console.log(
			`${run.runId}  ${run.status}  ${elapsedSeconds}s  $${costUsd.toFixed(2)}  target: ${run.target}${run.note ? `\n${run.note}` : ""}`,
		);
		for (const n of run.nodes) {
			console.log(`  ${n.status.padEnd(8)} ${n.id} [${n.kind}]${n.note ? ` · ${n.note}` : ""}`);
		}
	}
} else if (cmd === "runs") {
	const ids = await listRuns(graphName);
	if (!process.stdout.isTTY || "json" in opt) {
		const runs = [];
		for (const id of ids) {
			const run = await loadRun(graphName, id);
			runs.push({ runId: id, status: run.status, target: run.target, startedAt: run.startedAt, finishedAt: run.finishedAt });
		}
		console.log(JSON.stringify(runs.reverse(), null, 2));
	} else {
		for (const id of ids) {
			const run = await loadRun(graphName, id);
			console.log(`${id}  ${run.status.padEnd(7)}  target: ${run.target}`);
		}
	}
} else if (cmd === "plan") {
	const doc = bundle.doc;
	const draw = (id: string, depth: number) => {
		const n = doc.nodes[id];
		if (!n) return;
		const extra = n.kind === "budget" ? ` ${n.minutes}m` : n.kind === "loop" ? ` ×${n.maxRounds}` : "";
		console.log(`${"  ".repeat(depth)}${id} [${n.kind}${extra}] ${n.title}`);
		for (const c of n.children) draw(c, depth + 1);
	};
	draw(doc.root, 0);
	if (problems.length > 0) console.log(`\nproblems:\n  ${problems.join("\n  ")}`);
} else usage();
