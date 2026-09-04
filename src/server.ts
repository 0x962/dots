import { existsSync, openSync } from "node:fs";
import { join } from "node:path";
import index from "./client/index.html";
import runsPage from "./client/runs.html";
import {
	type CatalogModel,
	HARNESS_IDS,
	defaultHarnessId,
	harness,
	isHarnessId,
} from "./core/harness";
import {
	buildRun,
	buildTestRun,
	agentCmdOverride,
	expandHome,
	retryNode,
	type RunnerOptions,
} from "./core/runner";
import {
	latestRun,
	listRuns,
	loadRun,
	readNodeFile,
	runsDir,
	saveNodeFile,
	saveRun,
} from "./core/runstore";
import { graphsRoot, listGraphs, loadGraph } from "./core/store";
import type { GraphBundle, GraphRun } from "./core/types";
import { validateGraph } from "./core/validate";

const PORT = Number(process.env.DOTS_PORT ?? 4517);

/**
 * Asking pi for its models spawns a process and takes about a second, and
 * the model picker asks on every node the person clicks. The answer only
 * changes when pi is upgraded or a key is added, so it is kept until the
 * server restarts. `?refresh=1` throws the kept answer away.
 */
const modelCache = new Map<string, CatalogModel[]>();

async function catalogFor(id: string, refresh: boolean): Promise<CatalogModel[]> {
	if (refresh) modelCache.delete(id);
	const kept = modelCache.get(id);
	if (kept) return kept;
	const models = await harness(isHarnessId(id) ? id : "claude").catalog();
	modelCache.set(id, models);
	return models;
}
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
	try {
		const proc = Bun.spawn({
			// process.execPath is this server's own bun binary: the runner must
			// start even when PATH is not the user's shell PATH. The child runs
			// HERE, not in run.cwd: graph files resolve relative to this
			// process, and only the agents execute in run.cwd (the CLI passes
			// it through as the agent cwd).
			cmd: [process.execPath, CLI, "resume", graphName, run.runId],
			cwd: process.cwd(),
			stdout: log,
			stderr: log,
			env: { ...process.env, DOTS_GRAPHS_DIR: graphsRoot() },
		});
		void proc.exited.then(() => active.delete(key));
	} catch (error) {
		active.delete(key);
		run.status = "failed";
		run.note = `could not start the runner: ${error instanceof Error ? error.message : String(error)}`;
		run.finishedAt = new Date().toISOString();
		void saveRun(run);
	}
}

async function runFor(name: string, runId: string | undefined): Promise<GraphRun | null> {
	return runId ? loadRun(name, runId) : latestRun(name);
}

function runnerOpts(run: GraphRun, withAsk: boolean): RunnerOptions {
	return {
		target: run.target,
		vars: run.vars ?? {},
		harness: defaultHarnessId(),
		agentCmd: agentCmdOverride(),
		cwd: expandHome(run.cwd) ?? process.cwd(),
		nodeTimeoutMinutes: Number(process.env.DOTS_NODE_TIMEOUT_MIN ?? 30),
		// Agents run this from run.cwd, so the graphs folder rides along.
		askCommand: withAsk
			? `DOTS_GRAPHS_DIR="${graphsRoot()}" ${process.execPath} ${CLI} ask ${run.graphName} --run ${run.runId} --`
			: undefined,
	};
}

/** Resolves a person-typed working directory, or explains why it cannot. */
function resolveCwd(raw: string | undefined): { cwd: string } | { error: string } {
	const cwd = expandHome(raw?.trim() || "") || process.cwd();
	if (!existsSync(cwd)) return { error: `the working directory does not exist: ${cwd}` };
	return { cwd };
}

const TESTABLE = new Set(["agent", "gate", "loop"]);

/**
 * One node re-executed in this process (a test run's only node, or a node of
 * a finished run). The run file settles even when the agent's process or the
 * disk fails, so a poller never waits on a run stuck at "running".
 */
function retryDetached(
	bundle: GraphBundle,
	run: GraphRun,
	nodeId: string,
	withAsk: boolean,
): void {
	const key = `${run.graphName}/${run.runId}`;
	active.add(key);
	void retryNode(bundle, run, nodeId, runnerOpts(run, withAsk))
		.catch((error: unknown) => {
			const rn = run.nodes.find((n) => n.id === nodeId);
			if (rn) {
				rn.status = "failed";
				rn.note = error instanceof Error ? error.message : String(error);
			}
		})
		.finally(() => {
			active.delete(key);
			if (run.runId.startsWith("test-")) {
				const rn = run.nodes.find((n) => n.id === nodeId);
				run.status = rn?.status === "failed" ? "failed" : "done";
				run.finishedAt = new Date().toISOString();
			}
			void saveRun(run);
		});
}

const server = Bun.serve({
	port: PORT,
	routes: {
		"/": index,
		"/runs": runsPage,
		"/api/harnesses": {
			GET: async (req) => {
				const refresh = new URL(req.url).searchParams.has("refresh");
				const harnesses = await Promise.all(
					HARNESS_IDS.map(async (id) => {
						const h = harness(id);
						return {
							id,
							label: h.label,
							efforts: h.efforts,
							noModelsHint: h.noModelsHint,
							models: await catalogFor(id, refresh),
						};
					}),
				);
				return Response.json({ harnesses });
			},
		},
		"/api/graphs": {
			GET: async () => Response.json({ graphs: await listGraphs() }),
			POST: async (req) => {
				const body = (await req.json()) as { name?: string; from?: string };
				try {
					const { createGraph } = await import("./core/store");
					await createGraph(body.name ?? "", body.from || undefined);
				} catch (error) {
					return Response.json(
						{ error: error instanceof Error ? error.message : String(error) },
						{ status: 422 },
					);
				}
				return Response.json({ ok: true });
			},
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
			DELETE: async (req) => {
				const { deleteGraph } = await import("./core/store");
				await deleteGraph(req.params.name);
				return Response.json({ ok: true });
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
				const where = resolveCwd(body.cwd);
				if ("error" in where) return Response.json({ error: where.error }, { status: 422 });
				const run = buildRun(bundle, req.params.name, body.target);
				run.cwd = where.cwd;
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
					stream: await readNodeFile(run, `${req.params.nodeId}.stream.txt`),
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
		"/api/graphs/:name/test-node": {
			POST: async (req) => {
				const body = (await req.json()) as {
					nodeId?: string;
					target?: string;
					input?: string;
					cwd?: string;
					vars?: Record<string, string>;
					/** Unsaved editor text; overrides the files on disk for this test. */
					instructions?: string;
					briefing?: string;
				};
				if (!body.nodeId || !body.target?.trim()) {
					return Response.json({ error: "nodeId and target are required" }, { status: 422 });
				}
				const bundle = await loadGraph(req.params.name);
				const gn = bundle.doc.nodes[body.nodeId];
				if (!gn) return Response.json({ error: `no node "${body.nodeId}"` }, { status: 404 });
				if (!TESTABLE.has(gn.kind)) {
					return Response.json({ error: `a ${gn.kind} runs no agent of its own` }, { status: 422 });
				}
				if (body.instructions !== undefined) bundle.instructions[body.nodeId] = body.instructions;
				if (body.briefing !== undefined) bundle.briefing = body.briefing;
				const where = resolveCwd(body.cwd);
				if ("error" in where) return Response.json({ error: where.error }, { status: 422 });
				const run = buildTestRun(bundle, req.params.name, body.nodeId, body.target.trim());
				run.cwd = where.cwd;
				run.vars = body.vars ?? {};
				await saveRun(run);
				await saveNodeFile(run, `${body.nodeId}.input.txt`, body.input ?? "");
				retryDetached(bundle, run, body.nodeId, false);
				return Response.json({ runId: run.runId });
			},
		},
		"/api/graphs/:name/runs/:runId/retry-node": {
			POST: async (req) => {
				const { nodeId } = (await req.json()) as { nodeId?: string };
				if (!nodeId) return Response.json({ error: "nodeId is required" }, { status: 422 });
				const key = `${req.params.name}/${req.params.runId}`;
				if (active.has(key)) {
					return Response.json({ error: "this run is already executing" }, { status: 409 });
				}
				const bundle = await loadGraph(req.params.name);
				const gn = bundle.doc.nodes[nodeId];
				if (!gn || !TESTABLE.has(gn.kind)) {
					return Response.json(
						{ error: gn ? `a ${gn.kind} runs no agent of its own` : `"${nodeId}" is no longer in the graph` },
						{ status: 422 },
					);
				}
				const run = await loadRun(req.params.name, req.params.runId);
				retryDetached(bundle, run, nodeId, true);
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
