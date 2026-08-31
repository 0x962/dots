import { beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRun, executeRun, type RunnerOptions } from "../src/core/runner";
import { saveGraph } from "../src/core/store";
import type { GraphBundle, GraphNode, GraphRun } from "../src/core/types";

const STUB = join(import.meta.dir, "stub-agent.ts");
let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "dots-run-"));
	process.env.DOTS_GRAPHS_DIR = join(dir, "graphs");
	process.env.DOTS_STUB_FILE = join(dir, "stub.json");
	process.env.DOTS_STUB_STATE = join(dir, "stub-state");
	writeFileSync(process.env.DOTS_STUB_FILE, "{}");
});

function opts(): RunnerOptions {
	return {
		target: "demo",
		vars: {},
		agentCmd: ["bun", STUB],
		cwd: dir,
		nodeTimeoutMinutes: 1,
	};
}

function stub(cfg: Record<string, unknown>): void {
	writeFileSync(process.env.DOTS_STUB_FILE as string, JSON.stringify(cfg));
}

async function graph(nodes: Record<string, Partial<GraphNode> & { kind: GraphNode["kind"]; children?: string[] }>, root: string): Promise<GraphBundle> {
	const full: Record<string, GraphNode> = {};
	const instructions: Record<string, string> = {};
	for (const [id, n] of Object.entries(nodes)) {
		full[id] = { title: id, children: [], ...n } as GraphNode;
		instructions[id] = `instructions for ${id}`;
	}
	const bundle: GraphBundle = {
		doc: { version: 1, name: "t", root, nodes: full },
		briefing: "briefing",
		instructions,
	};
	await saveGraph("t", bundle);
	return bundle;
}

async function run(bundle: GraphBundle): Promise<GraphRun> {
	return executeRun(bundle, buildRun(bundle, "t", "demo"), opts());
}

const status = (r: GraphRun, id: string) => r.nodes.find((n) => n.id === id)?.status;
const note = (r: GraphRun, id: string) => r.nodes.find((n) => n.id === id)?.note ?? "";

describe("runner", () => {
	it("chains a sequence, passing each output forward", async () => {
		const b = await graph(
			{
				root: { kind: "sequence", children: ["a", "b"] },
				a: { kind: "agent" },
				b: { kind: "agent" },
			},
			"root",
		);
		stub({ a: { reply: "OUTPUT alpha-token" }, b: { expect: "alpha-token" } });
		const r = await run(b);
		expect(r.status).toBe("done");
		expect(r.nodes.find((n) => n.id === "b")?.output).toContain("SAW");
	});

	it("halts a sequence at a failure and skips the rest", async () => {
		const b = await graph(
			{
				root: { kind: "sequence", children: ["a", "b", "c"] },
				a: { kind: "agent" },
				b: { kind: "agent" },
				c: { kind: "agent" },
			},
			"root",
		);
		stub({ b: { exit: 3 } });
		const r = await run(b);
		expect(r.status).toBe("failed");
		expect(status(r, "b")).toBe("failed");
		expect(status(r, "c")).toBe("skipped");
		expect(note(r, "c")).toContain("failed earlier");
	});

	it("runs parallel children through one failure", async () => {
		const b = await graph(
			{
				root: { kind: "parallel", children: ["a", "b", "c"] },
				a: { kind: "agent" },
				b: { kind: "agent" },
				c: { kind: "agent" },
			},
			"root",
		);
		stub({ b: { exit: 1 } });
		const r = await run(b);
		expect(status(r, "a")).toBe("ok");
		expect(status(r, "c")).toBe("ok");
		expect(status(r, "b")).toBe("failed");
		expect(r.status).toBe("failed");
	});

	it("prunes a gate's subtree on NO and feeds focus on YES", async () => {
		const b = await graph(
			{
				root: { kind: "parallel", children: ["g1", "g2"] },
				g1: { kind: "gate", children: ["x"] },
				x: { kind: "agent" },
				g2: { kind: "gate", children: ["y"] },
				y: { kind: "agent" },
			},
			"root",
		);
		stub({
			g1: { reply: "thinking...\nNO: nothing here" },
			g2: { reply: "YES: look at the-focus-token" },
			y: { expect: "the-focus-token" },
		});
		const r = await run(b);
		expect(status(r, "g1")).toBe("skipped");
		expect(status(r, "x")).toBe("skipped");
		expect(note(r, "x")).toContain("gate said no");
		expect(r.nodes.find((n) => n.id === "y")?.output).toContain("SAW");
	});

	it("counts findings as items and honors SKIP", async () => {
		const b = await graph(
			{
				root: { kind: "parallel", children: ["a", "b"] },
				a: { kind: "agent" },
				b: { kind: "agent" },
			},
			"root",
		);
		stub({
			a: { reply: "FINDING\nnode: a\n\nFINDING\nnode: a" },
			b: { reply: "SKIP: no such files in the diff" },
		});
		const r = await run(b);
		expect(status(r, "a")).toBe("items");
		expect(r.nodes.find((n) => n.id === "a")?.count).toBe(2);
		expect(status(r, "b")).toBe("skipped");
		expect(r.status).toBe("done");
	});

	it("trips a budget and fails what was still inside", async () => {
		const b = await graph(
			{
				root: { kind: "budget", minutes: 0.002, children: ["slow"] },
				slow: { kind: "agent" },
			},
			"root",
		);
		stub({ slow: { delayMs: 2500 } });
		const r = await run(b);
		expect(r.status).toBe("failed");
		expect(note(r, "root")).toContain("budget exceeded");
	});

	it("loops AGAIN then DONE across rounds", async () => {
		const b = await graph(
			{
				root: { kind: "loop", maxRounds: 3, children: ["work"] },
				work: { kind: "agent" },
			},
			"root",
		);
		stub({ root: { seq: ["AGAIN: still dirty", "DONE: clean now"] } });
		const r = await run(b);
		expect(r.status).toBe("done");
		const root = r.nodes.find((n) => n.id === "root");
		expect(root?.round).toBe(2);
		expect(root?.note).toContain("DONE after round 2");
	});

	it("parks on a human node, then resumes after approval", async () => {
		const b = await graph(
			{
				root: { kind: "sequence", children: ["plan", "ask", "after"] },
				plan: { kind: "agent" },
				ask: { kind: "human" },
				after: { kind: "agent" },
			},
			"root",
		);
		stub({ plan: { reply: "OUTPUT the-plan-token" }, after: { expect: "APPROVED" } });
		const first = await executeRun(b, buildRun(b, "t", "demo"), opts());
		expect(first.status).toBe("waiting");
		expect(status(first, "ask")).toBe("waiting");
		// The parked node holds what is being judged.
		expect(first.nodes.find((n) => n.id === "ask")?.output).toContain("the-plan-token");
		expect(status(first, "after")).toBe("pending");
		const ask = first.nodes.find((n) => n.id === "ask");
		if (ask) {
			ask.status = "ok";
			ask.output = "APPROVED: ship it";
		}
		const resumed = await executeRun(b, first, opts());
		expect(resumed.status).toBe("done");
		expect(resumed.nodes.find((n) => n.id === "after")?.output).toContain("SAW");
	});

	it("re-runs only what had not settled on resume", async () => {
		const b = await graph(
			{
				root: { kind: "sequence", children: ["a", "b"] },
				a: { kind: "agent" },
				b: { kind: "agent" },
			},
			"root",
		);
		stub({ b: { exit: 1 } });
		const first = await run(b);
		expect(first.status).toBe("failed");
		// a settled; on resume only b runs again, now healthy.
		stub({ a: { exit: 1 }, b: {} });
		const resumed = await executeRun(b, first, opts());
		expect(resumed.status).toBe("done");
		expect(status(resumed, "a")).toBe("ok");
		expect(status(resumed, "b")).toBe("ok");
	});
});
