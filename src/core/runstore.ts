import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
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
	return JSON.parse(
		await readFile(join(runsDir(graphName), `${runId}.json`), "utf8"),
	) as GraphRun;
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

/** One transcript file per node per run, for debugging a node's whole reply. */
export async function saveTranscript(
	run: GraphRun,
	nodeId: string,
	text: string,
): Promise<void> {
	const dir = join(runsDir(run.graphName), `${run.runId}.d`);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, `${nodeId}.txt`), text, "utf8");
}
