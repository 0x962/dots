import type { GraphBundle } from "../core/types";
import { applyView, drawGraph, fitView, initCanvas } from "./canvas";
import { drawInspector } from "./inspector";
import { dirty, layoutMissing, state } from "./state";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

async function fetchGraphs(): Promise<string[]> {
	const res = await fetch("/api/graphs");
	return (await res.json()).graphs as string[];
}

function syncToolbar(): void {
	const isDirty = dirty();
	($("save") as HTMLButtonElement).disabled = !isDirty;
	($("discard") as HTMLButtonElement).disabled = !isDirty;
	$("graph-path").textContent = state.name ? `graphs/${state.name}/` : "";
}

let renderedSelection: string | null | undefined;

function onChange(): void {
	drawGraph();
	syncToolbar();
	if (renderedSelection !== state.selection) {
		renderedSelection = state.selection;
		drawInspector();
	}
}

async function openGraph(name: string): Promise<void> {
	const res = await fetch(`/api/graphs/${name}`);
	if (!res.ok) return;
	state.name = name;
	state.bundle = (await res.json()) as GraphBundle;
	state.savedJson = JSON.stringify(state.bundle);
	state.selection = null;
	renderedSelection = undefined;
	layoutMissing();
	drawGraph();
	fitView();
	onChange();
	history.replaceState(null, "", `?g=${name}`);
}

async function save(): Promise<void> {
	if (!state.name || !state.bundle) return;
	const res = await fetch(`/api/graphs/${state.name}`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(state.bundle),
	});
	const body = (await res.json()) as { ok: boolean; errors: string[] };
	const errEl = $("errors");
	if (!body.ok) {
		errEl.hidden = false;
		errEl.textContent = body.errors.join(" · ");
		errEl.title = body.errors.join("\n");
		return;
	}
	errEl.hidden = true;
	state.savedJson = JSON.stringify(state.bundle);
	syncToolbar();
}

function discard(): void {
	if (!state.bundle) return;
	state.bundle = JSON.parse(state.savedJson) as GraphBundle;
	state.selection = null;
	renderedSelection = undefined;
	$("errors").hidden = true;
	onChange();
	drawInspector();
}

async function newGraph(): Promise<void> {
	const name = prompt("Graph name (lowercase-with-dashes):");
	if (!name) return;
	const starter: GraphBundle = {
		doc: {
			version: 1,
			name,
			root: "flow",
			nodes: {
				flow: { kind: "sequence", title: name, children: ["work"], x: 30, y: 40 },
				work: { kind: "agent", title: "Do the work", children: [], x: 240, y: 40 },
			},
		},
		briefing: `You are the lead of this run and the scheduler of its graph.\n`,
		instructions: { work: "Describe what this node does.\n" },
	};
	const res = await fetch(`/api/graphs/${name}`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(starter),
	});
	const body = (await res.json()) as { ok: boolean; errors?: string[] };
	if (!body.ok) {
		alert((body.errors ?? ["could not create"]).join("\n"));
		return;
	}
	await refreshList(name);
	await openGraph(name);
}

async function refreshList(selected?: string): Promise<void> {
	const names = await fetchGraphs();
	const sel = $("graph-select") as HTMLSelectElement;
	sel.innerHTML = names.map((n) => `<option value="${n}">${n}</option>`).join("");
	if (selected) sel.value = selected;
}

async function main(): Promise<void> {
	state.onChange = onChange;
	initCanvas();
	applyView();
	await refreshList();
	const sel = $("graph-select") as HTMLSelectElement;
	sel.addEventListener("change", () => void openGraph(sel.value));
	$("save").addEventListener("click", () => void save());
	$("discard").addEventListener("click", discard);
	$("new-graph").addEventListener("click", () => void newGraph());
	document.addEventListener("keydown", (ev) => {
		if ((ev.metaKey || ev.ctrlKey) && ev.key === "s") {
			ev.preventDefault();
			void save();
		}
	});
	window.addEventListener("beforeunload", (ev) => {
		if (dirty()) ev.preventDefault();
	});
	const wanted = new URLSearchParams(location.search).get("g");
	const names = Array.from(sel.options).map((o) => o.value);
	const first = wanted && names.includes(wanted) ? wanted : names[0];
	if (first) {
		sel.value = first;
		await openGraph(first);
	}
	drawInspector();
}

void main();
