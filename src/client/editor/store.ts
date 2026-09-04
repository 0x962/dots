import { create } from "zustand";
import type { HarnessId } from "../../core/harness";
import type { GraphBundle, GraphNode, NodeKind } from "../../core/types";
import { allChildren, carriesInstructions, isContainer } from "../../core/types";
import { validateGraph } from "../../core/validate";
import { api } from "../shared/api";
import { KIND } from "../shared/kinds";
import { toast } from "../shared/toast";

const ID_SHAPE = /^[a-z0-9][a-z0-9-]*$/;

const STARTER_INSTRUCTIONS: Partial<Record<NodeKind, string>> = {
	agent: "Runs when: always.\n\nDescribe the work this agent does and what its OUTPUT should carry.",
	gate: "Answer YES when the change touches this area, NO when it does not.",
	human: "What the person is approving, in one line first.",
	loop: "Is anything left to do? End with DONE or AGAIN.",
};

interface EditorState {
	graphs: string[];
	name: string | null;
	bundle: GraphBundle | null;
	savedJson: string;
	selection: string | null;
	focus: { id: string; nonce: number } | null;
	/** Node id (or "briefing") open in the full-screen prompt editor. */
	expanded: string | null;
	/** Set when the full editor was opened by "Run this node", so the test
	 *  pane is already open when it appears. */
	expandedForTest: boolean;
	past: string[];
	future: string[];
	saving: boolean;

	init: () => Promise<void>;
	open: (name: string) => Promise<void>;
	refreshGraphs: () => Promise<void>;
	select: (id: string | null, focus?: boolean) => void;
	setExpanded: (id: string | null, forTest?: boolean) => void;
	undo: () => void;
	redo: () => void;
	save: () => Promise<boolean>;
	discard: () => void;
	setNode: (id: string, patch: Partial<GraphNode>, label?: string) => void;
	setInstructions: (id: string, text: string) => void;
	setBriefing: (text: string) => void;
	setGraphHarness: (harness: HarnessId | undefined) => void;
	addChild: (parentId: string, kind: NodeKind, index?: number, branch?: "yes" | "no") => void;
	deleteNode: (id: string) => void;
	moveNode: (id: string, parentId: string, index: number, branch?: "yes" | "no") => void;
	shiftNode: (id: string, delta: number) => void;
	renameId: (oldId: string, newId: string) => string | null;
	/** After a title edit settles, re-derive the node's id from it. */
	commitTitle: (id: string) => void;
	createGraph: (name: string, from?: string) => Promise<boolean>;
	removeGraph: (name: string) => Promise<void>;
}

let lastLabel = "";
let lastAt = 0;

/**
 * Ids never show in the UI: they are derived from titles (they still name
 * the `nodes/<id>.md` files, so hand-edited graphs stay readable).
 */
function slugify(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

function uniqueId(bundle: GraphBundle, base: string, keep?: string): string {
	// "briefing" is the inspector's pseudo-selection for briefing.md.
	const taken = (id: string) => id === "briefing" || (id !== keep && !!bundle.doc.nodes[id]);
	if (!taken(base)) return base;
	for (let i = 2; ; i++) {
		if (!taken(`${base}-${i}`)) return `${base}-${i}`;
	}
}

export const useEditor = create<EditorState>((set, get) => {
	/**
	 * Debounced autosave: every change lands on disk on its own, a second
	 * after typing stops. A bundle that does not validate is held in memory
	 * (the issues pill says why) and saves as soon as it validates again.
	 */
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	const autosave = async (): Promise<void> => {
		const { name, bundle, savedJson, saving } = get();
		if (!name || !bundle || saving) return;
		const json = JSON.stringify(bundle);
		if (json === savedJson) return;
		if (validateGraph(bundle).length > 0) return;
		set({ saving: true });
		try {
			await api.saveGraph(name, bundle);
			set({ savedJson: json });
		} catch (error) {
			toast(error instanceof Error ? error.message : String(error), "error");
		} finally {
			set({ saving: false });
			// Edits made while the save was in flight get their own save.
			if (JSON.stringify(get().bundle) !== get().savedJson) schedule();
		}
	};
	const schedule = (): void => {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void autosave(), 1000);
	};

	/** Snapshot for undo, then apply `fn` to a clone of the bundle. */
	const mutate = (label: string, fn: (b: GraphBundle) => void, coalesce = false): void => {
		const { bundle, past } = get();
		if (!bundle) return;
		const now = Date.now();
		const merge = coalesce && label === lastLabel && now - lastAt < 900;
		lastLabel = label;
		lastAt = now;
		const next = structuredClone(bundle);
		fn(next);
		set({
			bundle: next,
			future: [],
			past: merge ? past : [...past, JSON.stringify(bundle)].slice(-100),
		});
		schedule();
	};

	return {
		graphs: [],
		name: null,
		bundle: null,
		savedJson: "",
		selection: null,
		focus: null,
		expanded: null,
		expandedForTest: false,
		past: [],
		future: [],
		saving: false,

		init: async () => {
			const graphs = await api.graphs();
			set({ graphs });
			const wanted = new URLSearchParams(location.search).get("g");
			const name = wanted && graphs.includes(wanted) ? wanted : graphs[0];
			if (name) await get().open(name);
		},

		refreshGraphs: async () => set({ graphs: await api.graphs() }),

		open: async (name) => {
			const bundle = await api.graph(name);
			lastLabel = "";
			set({
				name,
				bundle,
				savedJson: JSON.stringify(bundle),
				selection: null,
				focus: null,
				expanded: null,
				expandedForTest: false,
				past: [],
				future: [],
			});
			history.replaceState(null, "", `/?g=${name}`);
		},

		select: (id, focus = false) =>
			set((s) => ({
				selection: id,
				focus: focus && id ? { id, nonce: (s.focus?.nonce ?? 0) + 1 } : s.focus,
			})),

		setExpanded: (id, forTest = false) =>
			set({
				expanded: id,
				expandedForTest: forTest,
				...(id && id !== "briefing" ? { selection: id } : {}),
			}),

		undo: () => {
			const { past, future, bundle } = get();
			const prev = past[past.length - 1];
			if (!prev || !bundle) return;
			lastLabel = "";
			set({
				bundle: JSON.parse(prev) as GraphBundle,
				past: past.slice(0, -1),
				future: [JSON.stringify(bundle), ...future].slice(0, 100),
			});
			schedule();
		},

		redo: () => {
			const { past, future, bundle } = get();
			const next = future[0];
			if (!next || !bundle) return;
			lastLabel = "";
			set({
				bundle: JSON.parse(next) as GraphBundle,
				future: future.slice(1),
				past: [...past, JSON.stringify(bundle)],
			});
			schedule();
		},

		save: async () => {
			const { name, bundle } = get();
			if (!name || !bundle) return false;
			set({ saving: true });
			try {
				await api.saveGraph(name, bundle);
				set({ savedJson: JSON.stringify(bundle) });
				toast("Saved");
				return true;
			} catch (error) {
				toast(error instanceof Error ? error.message : String(error), "error");
				return false;
			} finally {
				set({ saving: false });
			}
		},

		discard: () => {
			const { savedJson } = get();
			if (!savedJson) return;
			lastLabel = "";
			set({ bundle: JSON.parse(savedJson) as GraphBundle, past: [], future: [] });
		},

		setNode: (id, patch, label) =>
			mutate(label ?? `set:${id}`, (b) => {
				const n = b.doc.nodes[id];
				if (n) Object.assign(n, patch);
			}, true),

		setInstructions: (id, text) =>
			mutate(`instructions:${id}`, (b) => {
				b.instructions[id] = text;
			}, true),

		setBriefing: (text) =>
			mutate("briefing", (b) => {
				b.briefing = text;
			}, true),

		setGraphHarness: (harness) =>
			mutate("graph-harness", (b) => {
				if (harness) b.doc.harness = harness;
				else b.doc.harness = undefined;
			}, true),

		addChild: (parentId, kind, index, branch) =>
			mutate(`add:${kind}`, (b) => {
				const parent = b.doc.nodes[parentId];
				if (!parent || !isContainer(parent.kind)) return;
				const title = `New ${KIND[kind].label.toLowerCase()}`;
				const id = uniqueId(b, slugify(title));
				const node: GraphNode = { kind, title, children: [] };
				if (kind === "budget") node.minutes = 10;
				if (kind === "loop") node.maxRounds = 2;
				b.doc.nodes[id] = node;
				if (carriesInstructions(kind)) b.instructions[id] = STARTER_INSTRUCTIONS[kind] ?? "";
				const list =
					parent.kind === "gate" && branch === "no"
						? (parent.elseChildren ??= [])
						: parent.children;
				list.splice(index ?? list.length, 0, id);
				set({ selection: id, focus: { id, nonce: (get().focus?.nonce ?? 0) + 1 } });
			}),

		deleteNode: (id) => {
			const { bundle } = get();
			if (!bundle || id === bundle.doc.root || !bundle.doc.nodes[id]) return;
			mutate(`delete:${id}`, (b) => {
				const doomed = new Set<string>();
				const walk = (nid: string) => {
					if (doomed.has(nid)) return;
					doomed.add(nid);
					const n = b.doc.nodes[nid];
					if (n) for (const c of allChildren(n)) walk(c);
				};
				walk(id);
				for (const d of doomed) {
					delete b.doc.nodes[d];
					delete b.instructions[d];
				}
				for (const n of Object.values(b.doc.nodes)) {
					n.children = n.children.filter((c) => !doomed.has(c));
					if (n.elseChildren) n.elseChildren = n.elseChildren.filter((c) => !doomed.has(c));
				}
			});
			if (get().selection === id) set({ selection: null });
			const ex = get().expanded;
			if (ex && ex !== "briefing" && !get().bundle?.doc.nodes[ex]) set({ expanded: null });
		},

		moveNode: (id, parentId, index, branch) => {
			const { bundle } = get();
			if (!bundle || id === parentId || id === bundle.doc.root) return;
			const contains = (rootId: string, targetId: string): boolean => {
				if (rootId === targetId) return true;
				const n = bundle.doc.nodes[rootId];
				return !!n && allChildren(n).some((c) => contains(c, targetId));
			};
			// A node cannot land inside its own subtree.
			if (contains(id, parentId)) return;
			mutate(`move:${id}`, (b) => {
				const target = b.doc.nodes[parentId];
				if (!target || !isContainer(target.kind)) return;
				for (const n of Object.values(b.doc.nodes)) {
					n.children = n.children.filter((c) => c !== id);
					if (n.elseChildren) n.elseChildren = n.elseChildren.filter((c) => c !== id);
				}
				const list =
					target.kind === "gate" && branch === "no" ? (target.elseChildren ??= []) : target.children;
				list.splice(Math.min(index, list.length), 0, id);
			});
		},

		shiftNode: (id, delta) =>
			mutate(`shift:${id}`, (b) => {
				for (const n of Object.values(b.doc.nodes)) {
					for (const list of [n.children, n.elseChildren ?? []]) {
						const i = list.indexOf(id);
						if (i === -1) continue;
						const j = i + delta;
						if (j < 0 || j >= list.length) return;
						list.splice(i, 1);
						list.splice(j, 0, id);
						return;
					}
				}
			}),

		renameId: (oldId, newId) => {
			const { bundle } = get();
			if (!bundle || oldId === newId) return null;
			if (!ID_SHAPE.test(newId)) return "Use lowercase-with-dashes.";
			if (bundle.doc.nodes[newId]) return `"${newId}" is taken.`;
			mutate(`rename:${oldId}`, (b) => {
				b.doc.nodes[newId] = b.doc.nodes[oldId];
				delete b.doc.nodes[oldId];
				if (b.instructions[oldId] !== undefined) {
					b.instructions[newId] = b.instructions[oldId];
					delete b.instructions[oldId];
				}
				if (b.doc.root === oldId) b.doc.root = newId;
				for (const n of Object.values(b.doc.nodes)) {
					n.children = n.children.map((c) => (c === oldId ? newId : c));
					if (n.elseChildren) n.elseChildren = n.elseChildren.map((c) => (c === oldId ? newId : c));
				}
			});
			set({ selection: newId, ...(get().expanded === oldId ? { expanded: newId } : {}) });
			return null;
		},

		commitTitle: (id) => {
			const { bundle } = get();
			const n = bundle?.doc.nodes[id];
			if (!bundle || !n || id === bundle.doc.root) return;
			const base = slugify(n.title) || n.kind;
			const next = uniqueId(bundle, base, id);
			if (next !== id) get().renameId(id, next);
		},

		createGraph: async (name, from) => {
			try {
				await api.createGraph(name, from);
			} catch (error) {
				toast(error instanceof Error ? error.message : String(error), "error");
				return false;
			}
			await get().refreshGraphs();
			await get().open(name);
			return true;
		},

		removeGraph: async (name) => {
			await api.deleteGraph(name);
			const graphs = await api.graphs();
			set({ graphs });
			if (get().name === name) {
				if (graphs[0]) await get().open(graphs[0]);
				else set({ name: null, bundle: null, savedJson: "", selection: null });
			}
		},
	};
});

export function useDirty(): boolean {
	return useEditor((s) => !!s.bundle && JSON.stringify(s.bundle) !== s.savedJson);
}

declare global {
	interface Window {
		/** The editor store, for the browser console. */
		dots?: typeof useEditor;
	}
}
window.dots = useEditor;
