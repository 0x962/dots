#!/usr/bin/env bun
import { buildRun, defaultAgentCmd, executeRun } from "./core/runner";
import { latestRun, listRuns, loadRun, saveRun } from "./core/runstore";
import { loadGraph } from "./core/store";
import { validateGraph } from "./core/validate";

function usage(): never {
	console.log(`dots — run agent graphs

  dots run <graph> --target <text> [--var K=V]... [--cwd <dir>]
  dots resume <graph> [runId] [--cwd <dir>]
  dots approve <graph> <nodeId> [--note <text>] [--run <runId>]
  dots reject <graph> <nodeId> [--note <text>] [--run <runId>]
  dots runs <graph>
  dots plan <graph>

The agent command comes from DOTS_AGENT_CMD (default: claude -p
--dangerously-skip-permissions); each node's prompt arrives on stdin.`);
	process.exit(1);
}

function flags(argv: string[]): { pos: string[]; opt: Record<string, string>; vars: Record<string, string> } {
	const pos: string[] = [];
	const opt: Record<string, string> = {};
	const vars: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--var") {
			const [k, ...v] = (argv[++i] ?? "").split("=");
			vars[k] = v.join("=");
		} else if (a.startsWith("--")) {
			opt[a.slice(2)] = argv[++i] ?? "";
		} else pos.push(a);
	}
	return { pos, opt, vars };
}

function opts(opt: Record<string, string>, vars: Record<string, string>, target: string) {
	return {
		target,
		vars,
		agentCmd: defaultAgentCmd(),
		cwd: opt.cwd ?? process.cwd(),
		nodeTimeoutMinutes: Number(process.env.DOTS_NODE_TIMEOUT_MIN ?? 30),
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
	await saveRun(run);
	console.log(`${run.runId} · ${run.nodes.length} nodes · target: ${opt.target}`);
	const done = await executeRun(bundle, run, opts(opt, vars, opt.target));
	console.log(`${done.status}${done.note ? ` · ${done.note}` : ""}`);
	process.exit(done.status === "failed" ? 1 : 0);
} else if (cmd === "resume") {
	const run = pos[1] ? await loadRun(graphName, pos[1]) : await latestRun(graphName);
	if (!run) {
		console.error("no runs");
		process.exit(1);
	}
	const done = await executeRun(bundle, run, opts(opt, vars, run.target));
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
} else if (cmd === "runs") {
	for (const id of await listRuns(graphName)) {
		const run = await loadRun(graphName, id);
		const found = run.nodes.reduce((t, n) => t + (n.count ?? 0), 0);
		console.log(`${id}  ${run.status.padEnd(7)}  found:${found}  target: ${run.target}`);
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
