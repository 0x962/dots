import type { GraphBundle, GraphNode, NodeKind } from "../core/types";
import { carriesInstructions, isContainer } from "../core/types";

export const KIND_META: Record<NodeKind, { label: string; lede: string }> = {
	agent: { label: "Agent", lede: "Does work: runs once, read-only, returns an output plus findings." },
	gate: { label: "Gate", lede: "Answers YES: <focus> or NO: <reason>. NO prunes its subtree." },
	parallel: { label: "Parallel", lede: "Starts every child at the same time. A child's failure never stops its siblings." },
	sequence: { label: "Sequence", lede: "Runs children in order, passing each output to the next. A failure halts the rest." },
	budget: { label: "Budget", lede: "A time box: on expiry the scheduler stops waiting and everything unfinished inside fails." },
	loop: { label: "Loop", lede: "Runs its children as a round, then asks its exit question: DONE moves on, AGAIN goes again." },
	human: { label: "Human", lede: "Parks until a person answers on the run board. The rest of the graph keeps going." },
};

export interface EditorState {
	name: string | null;
	bundle: GraphBundle | null;
	savedJson: string;
	selection: string | null;
	view: { x: number; y: number; k: number };
	onChange: () => void;
}

export const state: EditorState = {
	name: null,
	bundle: null,
	savedJson: "",
	selection: null,
	view: { x: 24, y: 16, k: 0.8 },
	onChange: () => {},
};

export function dirty(): boolean {
	return !!state.bundle && JSON.stringify(state.bundle) !== state.savedJson;
}

export function node(id: string): GraphNode | undefined {
	return state.bundle?.doc.nodes[id];
}

export function parentOf(id: string): string | null {
	const nodes = state.bundle?.doc.nodes ?? {};
	for (const [pid, n] of Object.entries(nodes)) {
		if (n.children.includes(id)) return pid;
	}
	return null;
}

export function inSubtree(rootId: string, id: string): boolean {
	if (rootId === id) return true;
	return (node(rootId)?.children ?? []).some((c) => inSubtree(c, id));
}

/** Ids reachable from the root; the rest render as dashed orphans. */
export function reachable(): Set<string> {
	const seen = new Set<string>();
	const doc = state.bundle?.doc;
	if (!doc) return seen;
	const walk = (id: string) => {
		if (seen.has(id) || !doc.nodes[id]) return;
		seen.add(id);
		for (const c of doc.nodes[id].children) walk(c);
	};
	walk(doc.root);
	return seen;
}

export function freshId(base: string): string {
	const nodes = state.bundle?.doc.nodes ?? {};
	let id = base;
	let n = 2;
	while (nodes[id]) id = `${base}-${n++}`;
	return id;
}

export function addNode(kind: NodeKind, x: number, y: number): string {
	const bundle = state.bundle;
	if (!bundle) return "";
	const id = freshId(`new-${kind}`);
	const n: GraphNode = { kind, title: `New ${KIND_META[kind].label.toLowerCase()}`, children: [], x, y };
	if (kind === "budget") n.minutes = 10;
	if (kind === "loop") n.maxRounds = 2;
	bundle.doc.nodes[id] = n;
	if (carriesInstructions(kind)) bundle.instructions[id] = "";
	state.onChange();
	return id;
}

export function deleteSubtree(id: string): void {
	const bundle = state.bundle;
	if (!bundle || id === bundle.doc.root) return;
	const doomed: string[] = [];
	const collect = (nid: string) => {
		doomed.push(nid);
		for (const c of node(nid)?.children ?? []) collect(c);
	};
	collect(id);
	const pid = parentOf(id);
	if (pid) {
		const p = bundle.doc.nodes[pid];
		p.children = p.children.filter((c) => c !== id);
	}
	for (const nid of doomed) {
		delete bundle.doc.nodes[nid];
		delete bundle.instructions[nid];
	}
	if (state.selection && doomed.includes(state.selection)) state.selection = null;
	state.onChange();
}

/** Wires `id` under `newParent`. Refused for leaves, cycles, and the root. */
export function reparent(id: string, newParentId: string): boolean {
	const bundle = state.bundle;
	if (!bundle) return false;
	const target = node(newParentId);
	if (!target || !isContainer(target.kind)) return false;
	if (id === bundle.doc.root || id === newParentId) return false;
	if (inSubtree(id, newParentId)) return false;
	const pid = parentOf(id);
	if (pid) {
		const p = bundle.doc.nodes[pid];
		p.children = p.children.filter((c) => c !== id);
	}
	target.children.push(id);
	state.onChange();
	return true;
}

export function reorder(id: string, delta: -1 | 1): void {
	const pid = parentOf(id);
	if (!pid || !state.bundle) return;
	const p = state.bundle.doc.nodes[pid];
	const i = p.children.indexOf(id);
	const j = i + delta;
	if (j < 0 || j >= p.children.length) return;
	p.children.splice(i, 1);
	p.children.splice(j, 0, id);
	state.onChange();
}

/** Renames a node id everywhere: the map, children refs, the root, the md key. */
export function renameId(oldId: string, next: string): string | null {
	const bundle = state.bundle;
	if (!bundle) return "no graph";
	if (!/^[a-z0-9][a-z0-9-]*$/.test(next)) return "lowercase-with-dashes only";
	if (bundle.doc.nodes[next]) return `"${next}" is taken`;
	const n = bundle.doc.nodes[oldId];
	if (!n) return "gone";
	delete bundle.doc.nodes[oldId];
	bundle.doc.nodes[next] = n;
	if (bundle.doc.root === oldId) bundle.doc.root = next;
	for (const other of Object.values(bundle.doc.nodes)) {
		other.children = other.children.map((c) => (c === oldId ? next : c));
	}
	if (oldId in bundle.instructions) {
		bundle.instructions[next] = bundle.instructions[oldId];
		delete bundle.instructions[oldId];
	}
	if (state.selection === oldId) state.selection = next;
	state.onChange();
	return null;
}

const COL = 204;
const ROW = 56;

/** Fills in x/y for nodes that have none; stored positions win. */
export function layoutMissing(): void {
	const doc = state.bundle?.doc;
	if (!doc) return;
	let cursor = 20;
	const place = (id: string, depth: number): number => {
		const n = doc.nodes[id];
		if (!n) return cursor;
		let y: number;
		if (n.children.length === 0) {
			y = cursor;
			cursor += ROW;
		} else {
			const ys = n.children.map((c) => place(c, depth + 1));
			y = (ys[0] + ys[ys.length - 1]) / 2;
		}
		if (n.x === undefined) n.x = 30 + depth * COL;
		if (n.y === undefined) n.y = y;
		return n.y;
	};
	place(doc.root, 0);
	// Orphans stack under the tree so they never hide behind it.
	const seen = reachable();
	for (const [id, n] of Object.entries(doc.nodes)) {
		if (seen.has(id)) continue;
		if (n.x === undefined) n.x = 30;
		if (n.y === undefined) {
			n.y = cursor;
			cursor += ROW;
		}
	}
}
