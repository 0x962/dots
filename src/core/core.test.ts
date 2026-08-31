import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listGraphs, loadGraph, saveGraph } from "./store";
import type { GraphBundle } from "./types";
import { validateGraph } from "./validate";

function bundle(): GraphBundle {
	return {
		doc: {
			version: 1,
			name: "t",
			root: "root",
			nodes: {
				root: { kind: "sequence", title: "Root", children: ["a", "g"] },
				a: { kind: "agent", title: "Work", children: [] },
				g: { kind: "gate", title: "Relevant?", children: ["b"] },
				b: { kind: "agent", title: "Check", children: [] },
			},
		},
		briefing: "# briefing",
		instructions: { a: "do work", g: "YES or NO", b: "check things" },
	};
}

describe("validateGraph", () => {
	it("accepts a sound graph", () => {
		expect(validateGraph(bundle())).toEqual([]);
	});
	it("rejects a leaf with children and a container without", () => {
		const b = bundle();
		b.doc.nodes.a.children = ["b"];
		b.doc.nodes.g.children = [];
		const msg = validateGraph(b).join(" ");
		expect(msg).toContain("runs no children");
		expect(msg).toContain("gate needs at least one node on YES or NO");
	});
	it("rejects a cycle and a double parent", () => {
		const b = bundle();
		b.doc.nodes.b.children = [];
		b.doc.nodes.g.children = ["b", "a"];
		const twoParents = validateGraph(b).join(" ");
		expect(twoParents).toContain("two parents");
		const c = bundle();
		c.doc.nodes.b.kind = "sequence";
		c.doc.nodes.b.children = ["g"];
		expect(validateGraph(c).join(" ")).toContain("Cycle");
	});
	it("demands the markdown file for kinds that carry one", () => {
		const b = bundle();
		delete b.instructions.g;
		expect(validateGraph(b).join(" ")).toContain("nodes/g.md is missing");
	});
	it("demands loop and budget settings", () => {
		const b = bundle();
		b.doc.nodes.g = { kind: "loop", title: "Until", children: ["b"] };
		b.instructions.g = "DONE when clean";
		expect(validateGraph(b).join(" ")).toContain("maxRounds");
	});
});

describe("store", () => {
	it("round-trips a folder and prunes stale markdown", async () => {
		const root = mkdtempSync(join(tmpdir(), "dots-"));
		process.env.DOTS_GRAPHS_DIR = root;
		const b = bundle();
		await saveGraph("demo", b);
		expect(await listGraphs()).toEqual(["demo"]);
		const loaded = await loadGraph("demo");
		expect(loaded.doc).toEqual(b.doc);
		expect(loaded.instructions.b).toBe("check things");
		// Rename b → c: the save prunes b.md and writes c.md.
		const b2 = bundle();
		delete b2.doc.nodes.b;
		delete b2.instructions.b;
		b2.doc.nodes.c = { kind: "agent", title: "Check", children: [] };
		b2.doc.nodes.g.children = ["c"];
		b2.instructions.c = "renamed";
		await saveGraph("demo", b2);
		const again = await loadGraph("demo");
		expect(again.instructions.c).toBe("renamed");
		expect(again.instructions.b).toBeUndefined();
		delete process.env.DOTS_GRAPHS_DIR;
	});
	it("refuses a bad name", async () => {
		await expect(loadGraph("../etc")).rejects.toThrow("Not a graph name");
	});
});
