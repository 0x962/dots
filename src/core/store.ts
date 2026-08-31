import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GraphBundle, GraphDoc } from "./types";
import { carriesInstructions } from "./types";

const NAME_SHAPE = /^[a-z0-9][a-z0-9-]*$/;

/** The folder that holds one folder per graph. */
export function graphsRoot(): string {
	return process.env.DOTS_GRAPHS_DIR ?? join(process.cwd(), "graphs");
}

export function assertGraphName(name: string): void {
	if (!NAME_SHAPE.test(name)) {
		throw new Error(`Not a graph name: "${name}". Use lowercase-with-dashes.`);
	}
}

export async function listGraphs(): Promise<string[]> {
	let names: string[];
	try {
		names = await readdir(graphsRoot());
	} catch {
		return [];
	}
	const out: string[] = [];
	for (const name of names) {
		if (!NAME_SHAPE.test(name)) continue;
		try {
			await readFile(join(graphsRoot(), name, "graph.json"), "utf8");
			out.push(name);
		} catch {
			// A folder without graph.json is not a graph.
		}
	}
	return out.sort();
}

export async function loadGraph(name: string): Promise<GraphBundle> {
	assertGraphName(name);
	const dir = join(graphsRoot(), name);
	const doc = JSON.parse(
		await readFile(join(dir, "graph.json"), "utf8"),
	) as GraphDoc;
	let briefing = "";
	try {
		briefing = await readFile(join(dir, "briefing.md"), "utf8");
	} catch {
		// A graph may not have written its briefing yet.
	}
	const instructions: Record<string, string> = {};
	for (const [id, node] of Object.entries(doc.nodes)) {
		if (!carriesInstructions(node.kind)) continue;
		try {
			instructions[id] = await readFile(join(dir, "nodes", `${id}.md`), "utf8");
		} catch {
			// Reported by validateGraph; the editor shows the gap.
		}
	}
	return { doc, briefing, instructions };
}

/**
 * Writes the whole folder from the bundle: graph.json, briefing.md, and one
 * nodes/<id>.md per instruction-carrying node. A markdown file for a node
 * that no longer exists (deleted, renamed) is removed, so the folder always
 * mirrors the bundle exactly. runs/ is untouched.
 */
export async function saveGraph(name: string, bundle: GraphBundle): Promise<void> {
	assertGraphName(name);
	const dir = join(graphsRoot(), name);
	await mkdir(join(dir, "nodes"), { recursive: true });
	const writeAtomic = async (path: string, content: string) => {
		const tmp = `${path}.tmp-${process.pid}`;
		await writeFile(tmp, content, "utf8");
		await rename(tmp, path);
	};
	await writeAtomic(
		join(dir, "graph.json"),
		`${JSON.stringify(bundle.doc, null, "\t")}\n`,
	);
	await writeAtomic(join(dir, "briefing.md"), bundle.briefing);
	const wanted = new Set<string>();
	for (const [id, node] of Object.entries(bundle.doc.nodes)) {
		if (!carriesInstructions(node.kind)) continue;
		wanted.add(`${id}.md`);
		await writeAtomic(join(dir, "nodes", `${id}.md`), bundle.instructions[id] ?? "");
	}
	for (const file of await readdir(join(dir, "nodes"))) {
		if (file.endsWith(".md") && !wanted.has(file)) {
			await rm(join(dir, "nodes", file));
		}
	}
}
