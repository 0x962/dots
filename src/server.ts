import { openSync } from "node:fs";
import { join } from "node:path";
import index from "./client/index.html";
import runsPage from "./client/runs.html";
import { buildRun } from "./core/runner";
import {
	latestRun,
	listRuns,
	loadRun,
	readNodeFile,
	runsDir,
	saveRun,
} from "./core/runstore";
import { listGraphs, loadGraph } from "./core/store";
import type { GraphBundle, GraphRun } from "./core/types";
import { validateGraph } from "./core/validate";

const PORT = Number(process.env.DOTS_PORT ?? 4517);
const CLI = join(import.meta.dir, "cli.ts");

/** Run keys with a runner child alive in this server, to stop double-resumes. */
const active = new Set<string>();

function summarize(run: GraphRun) {
	return {
		runId: run.runId,
		status: run.status,
		target: run.target,
		startedAt: run.startedAt,
		finishedAt: run.finishedAt,
		found: run.nodes.reduce((t, n) => t + (n.count ?? 0), 0),
		fixed: run.nodes.reduce((t, n) => t + (n.fixed ?? 0), 0),
		costUsd: run.nodes.reduce((t, n) => t + (n.costUsd ?? 0), 0),
		live: active.has(`${run.graphName}/${run.runId}`),
	};
}

/** The runner as a child of the server; its output lands next to the run. */
function resumeDetached(graphName: string, run: GraphRun): void {
	const key = `${graphName}/${run.runId}`;
	if (active.has(key)) return;
	active.add(key);
	const log = openSync(join(runsDir(graphName), `${run.runId}.runner.log`), "a");
	const proc = Bun.spawn({
		cmd: ["bun", CLI, "resume", graphName, run.runId],
		cwd: run.cwd ?? process.cwd(),
		stdout: log,
		stderr: log,
		env: process.env,
	});
	void proc.exited.then(() => active.delete(key));
}

async function runFor(name: string, runId: string | undefined): Promise<GraphRun | null> {
	return runId ? loadRun(name, runId) : latestRun(name);
}

const server = Bun.serve({
	port: PORT,
	routes: {
		"/": index,
		"/runs": runsPage,
		"/api/graphs": {
			GET: async () => Response.json({ graphs: await listGraphs() }),
		},
		"/api/graphs/:name": {
			GET: async (req) => {
				try {
					return Response.json(await loadGraph(req.params.name));
				} catch (error) {
					return Response.json(
						{ error: error instanceof Error ? error.message : String(error) },
						{ status: 404 },
					);
				}
			},
			PUT: async (req) => {
				const bundle = (await req.json()) as GraphBundle;
				const errors = validateGraph(bundle);
				if (errors.length > 0) {
					return Response.json({ ok: false, errors }, { status: 422 });
				}
				const { saveGraph } = await import("./core/store");
				await saveGraph(req.params.name, bundle);
				return Response.json({ ok: true, errors: [] });
			},
		},
		"/api/graphs/:name/runs": {
			GET: async (req) => {
				const ids = await listRuns(req.params.name);
				const runs = await Promise.all(ids.map((id) => loadRun(req.params.name, id)));
				return Response.json({ runs: runs.map(summarize).reverse() });
			},
			POST: async (req) => {
				const body = (await req.json()) as { target: string; cwd?: string; vars?: Record<string, string> };
				if (!body.target?.trim()) {
					return Response.json({ error: "target is required" }, { status: 422 });
				}
				const bundle = await loadGraph(req.params.name);
				const errors = validateGraph(bundle);
				if (errors.length > 0) return Response.json({ error: errors.join(" · ") }, { status: 422 });
				const run = buildRun(bundle, req.params.name, body.target);
				run.cwd = body.cwd?.trim() || process.cwd();
				run.vars = body.vars ?? {};
				await saveRun(run);
				resumeDetached(req.params.name, run);
				return Response.json({ runId: run.runId });
			},
		},
		"/api/graphs/:name/runs/:runId": {
			GET: async (req) => {
				const run = await loadRun(req.params.name, req.params.runId);
				return Response.json({ ...run, live: active.has(`${req.params.name}/${run.runId}`) });
			},
		},
		"/api/graphs/:name/runs/:runId/node/:nodeId": {
			GET: async (req) => {
				const run = await loadRun(req.params.name, req.params.runId);
				const node = run.nodes.find((n) => n.id === req.params.nodeId) ?? null;
				return Response.json({
					node,
					prompt: await readNodeFile(run, `${req.params.nodeId}.prompt.txt`),
					input: await readNodeFile(run, `${req.params.nodeId}.input.txt`),
					reply: await readNodeFile(run, `${req.params.nodeId}.txt`),
				});
			},
		},
		"/api/graphs/:name/runs/:runId/answer": {
			POST: async (req) => {
				const { nodeId, approve, note } = (await req.json()) as { nodeId: string; approve: boolean; note?: string };
				const run = await loadRun(req.params.name, req.params.runId);
				const rn = run.nodes.find((n) => n.id === nodeId);
				if (!rn || rn.status !== "waiting") {
					return Response.json({ error: `${nodeId} is not waiting` }, { status: 409 });
				}
				rn.status = approve ? "ok" : "failed";
				rn.note = `${approve ? "approved" : "rejected"}${note ? `: ${note}` : ""}`;
				rn.output = `${approve ? "APPROVED" : "REJECTED"}${note ? `: ${note}` : ""}`;
				rn.finishedAt = new Date().toISOString();
				await saveRun(run);
				return Response.json({ ok: true });
			},
		},
		"/api/graphs/:name/runs/:runId/resume": {
			POST: async (req) => {
				const run = await runFor(req.params.name, req.params.runId);
				if (!run) return Response.json({ error: "no run" }, { status: 404 });
				resumeDetached(req.params.name, run);
				return Response.json({ ok: true });
			},
		},
	},
});

console.log(`dots · editor http://localhost:${server.port} · runs http://localhost:${server.port}/runs`);
