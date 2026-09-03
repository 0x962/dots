import { appendFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { graphsRoot } from "./store";
import type { GraphRun } from "./types";

export function runsDir(graphName: string): string {
	return join(graphsRoot(), graphName, "runs");
}

export function makeRunId(startedAt: string): string {
	return `run-${startedAt.replace(/[:.]/g, "-")}`;
}

export async function listRuns(graphName: string): Promise<string[]> {
	try {
		return (await readdir(runsDir(graphName)))
			.filter((f) => f.startsWith("run-") && f.endsWith(".json"))
			.map((f) => f.slice(0, -5))
			.sort();
	} catch {
		return [];
	}
}

export async function loadRun(graphName: string, runId: string): Promise<GraphRun> {
	const run = JSON.parse(
		await readFile(join(runsDir(graphName), `${runId}.json`), "utf8"),
	) as GraphRun;
	// Runs written before findings left the framework carry an "items"
	// status; it reads as a plain success now.
	for (const n of run.nodes) {
		if ((n.status as string) === "items") n.status = "ok";
	}
	return run;
}

export async function latestRun(graphName: string): Promise<GraphRun | null> {
	const ids = await listRuns(graphName);
	const last = ids[ids.length - 1];
	return last ? loadRun(graphName, last) : null;
}

/** Written whole and renamed into place; a watcher never reads half a file. */
export async function saveRun(run: GraphRun): Promise<void> {
	const dir = runsDir(run.graphName);
	await mkdir(dir, { recursive: true });
	const path = join(dir, `${run.runId}.json`);
	const tmp = `${path}.tmp-${process.pid}`;
	await writeFile(tmp, `${JSON.stringify(run, null, "\t")}\n`, "utf8");
	await rename(tmp, path);
}

/**
 * Per-node debug files live in `runs/<runId>.d/`: `<node>.txt` is the whole
 * reply, `<node>.prompt.txt` exactly what the agent was told, and
 * `<node>.input.txt` the raw input `dots retry` recomposes from.
 */
export async function saveNodeFile(
	run: GraphRun,
	name: string,
	text: string,
): Promise<void> {
	const dir = join(runsDir(run.graphName), `${run.runId}.d`);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, name), text, "utf8");
}

export async function readNodeFile(
	run: GraphRun,
	name: string,
): Promise<string> {
	try {
		return await readFile(join(runsDir(run.graphName), `${run.runId}.d`, name), "utf8");
	} catch {
		return "";
	}
}

/** Grows `<node>.stream.txt` while the agent talks; the run view tails it. */
export async function appendNodeFile(
	run: GraphRun,
	name: string,
	text: string,
): Promise<void> {
	const dir = join(runsDir(run.graphName), `${run.runId}.d`);
	await mkdir(dir, { recursive: true });
	await appendFile(join(dir, name), text, "utf8");
}

/** The `runs/<runId>.d/` folder itself, for files that are not plain text. */
export function nodeFilesDir(run: GraphRun): string {
	return join(runsDir(run.graphName), `${run.runId}.d`);
}
