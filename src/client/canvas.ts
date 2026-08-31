import type { NodeKind } from "../core/types";
import { addNode, KIND_META, node, reachable, reparent, state } from "./state";

const CW = 172;
const CH = 44;

const els = {
	canvas: () => document.getElementById("canvas") as HTMLElement,
	world: () => document.getElementById("world") as HTMLElement,
	cards: () => document.getElementById("cards") as HTMLElement,
	edges: () => document.getElementById("edges") as unknown as SVGElement,
	pct: () => document.getElementById("z-pct") as HTMLElement,
};

let tmpEdge: { x1: number; y1: number; x2: number; y2: number } | null = null;

export function applyView(): void {
	const { x, y, k } = state.view;
	els.world().style.transform = `translate(${x}px,${y}px) scale(${k})`;
	els.pct().textContent = `${Math.round(k * 100)}%`;
}

export function fitView(): void {
	const doc = state.bundle?.doc;
	if (!doc) return;
	let maxX = 0;
	let maxY = 0;
	for (const n of Object.values(doc.nodes)) {
		maxX = Math.max(maxX, (n.x ?? 0) + CW);
		maxY = Math.max(maxY, (n.y ?? 0) + CH);
	}
	const c = els.canvas().getBoundingClientRect();
	if (c.width < 50) return;
	const k = Math.min((c.width - 30) / maxX, (c.height - 24) / maxY, 1);
	state.view.k = Math.max(k, 0.35);
	state.view.x = (c.width - maxX * state.view.k) / 2;
	state.view.y = Math.max(10, (c.height - maxY * state.view.k) / 2);
	applyView();
}

function esc(t: string): string {
	return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

export function drawGraph(): void {
	const doc = state.bundle?.doc;
	if (!doc) {
		els.cards().innerHTML = "";
		els.edges().innerHTML = "";
		return;
	}
	const live = reachable();
	let paths = "";
	for (const [id, n] of Object.entries(doc.nodes)) {
		n.children.forEach((cid, i) => {
			const k = doc.nodes[cid];
			if (!k) return;
			const x1 = (n.x ?? 0) + CW;
			const y1 = (n.y ?? 0) + CH / 2;
			const x2 = k.x ?? 0;
			const y2 = (k.y ?? 0) + CH / 2;
			const dx = Math.max(40, (x2 - x1) / 2);
			paths += `<path class="gbedge" d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}"/>`;
			if (n.kind === "sequence" || n.kind === "loop") {
				const mx = (x1 + x2) / 2;
				const my = (y1 + y2) / 2;
				paths += `<circle class="gbbadge" cx="${mx}" cy="${my}" r="7"/><text class="gbbadgetext" x="${mx}" y="${my + 3}" text-anchor="middle">${i + 1}</text>`;
			}
		});
	}
	if (tmpEdge) {
		paths += `<path class="gbedge tmp" d="M ${tmpEdge.x1} ${tmpEdge.y1} L ${tmpEdge.x2} ${tmpEdge.y2}"/>`;
	}
	els.edges().innerHTML = paths;

	let cards = "";
	for (const [id, n] of Object.entries(doc.nodes)) {
		const extra =
			n.kind === "budget" ? ` ${n.minutes}m` : n.kind === "loop" ? ` ×${n.maxRounds}` : "";
		const isRoot = id === doc.root;
		cards += `<div class="gbcard ${state.selection === id ? "sel" : ""} ${!live.has(id) && !isRoot ? "orphan" : ""}" data-id="${id}" data-kind="${n.kind}" style="left:${n.x}px;top:${n.y}px">
			<div class="hd"><span class="kdot"></span><span class="ttl">${esc(n.title)}</span>${isRoot ? '<span class="k">root</span>' : ""}<span class="k">${KIND_META[n.kind].label}${extra}</span></div>
			<div class="idl">${id}</div>
			${!isRoot ? '<span class="gbport in"></span>' : ""}<span class="gbport out"></span></div>`;
	}
	els.cards().innerHTML = cards;
}

function canvasPoint(ev: PointerEvent): { x: number; y: number } {
	const r = els.canvas().getBoundingClientRect();
	return {
		x: (ev.clientX - r.left - state.view.x) / state.view.k,
		y: (ev.clientY - r.top - state.view.y) / state.view.k,
	};
}

type Mode =
	| { type: "pan"; sx: number; sy: number; vx: number; vy: number }
	| { type: "node"; id: string; dx: number; dy: number; sx: number; sy: number; moved: boolean; el: HTMLElement }
	| { type: "edge"; fromId: string }
	| { type: "add"; id: string };

export function initCanvas(): void {
	const canvas = els.canvas();
	let mode: Mode | null = null;

	canvas.addEventListener("pointerdown", (ev) => {
		if ((ev.target as HTMLElement).closest(".zoomctl")) return;
		const port = (ev.target as HTMLElement).closest(".gbport.out");
		const card = (ev.target as HTMLElement).closest(".gbcard") as HTMLElement | null;
		if (port && card) {
			const id = card.dataset.id as string;
			const n = node(id);
			if (!n) return;
			mode = { type: "edge", fromId: id };
			const p = canvasPoint(ev);
			tmpEdge = { x1: (n.x ?? 0) + CW, y1: (n.y ?? 0) + CH / 2, x2: p.x, y2: p.y };
			drawGraph();
		} else if (card) {
			const id = card.dataset.id as string;
			const n = node(id);
			if (!n) return;
			const p = canvasPoint(ev);
			mode = { type: "node", id, dx: p.x - (n.x ?? 0), dy: p.y - (n.y ?? 0), sx: ev.clientX, sy: ev.clientY, moved: false, el: card };
		} else {
			mode = { type: "pan", sx: ev.clientX, sy: ev.clientY, vx: state.view.x, vy: state.view.y };
			canvas.classList.add("panning");
		}
		canvas.setPointerCapture(ev.pointerId);
	});

	canvas.addEventListener("pointermove", (ev) => {
		if (!mode) return;
		if (mode.type === "pan") {
			state.view.x = mode.vx + (ev.clientX - mode.sx);
			state.view.y = mode.vy + (ev.clientY - mode.sy);
			applyView();
		} else if (mode.type === "node" || mode.type === "add") {
			const n = node(mode.id);
			if (!n) return;
			const p = canvasPoint(ev);
			if (mode.type === "node") {
				// A still click selects; only real movement drags. Without the
				// threshold, one pixel of jitter turned every click into a drag
				// and editing felt like it needed a double-click.
				if (!mode.moved && Math.hypot(ev.clientX - mode.sx, ev.clientY - mode.sy) < 4) return;
				mode.moved = true;
				mode.el.classList.add("dragging");
				n.x = p.x - mode.dx;
				n.y = p.y - mode.dy;
			} else {
				n.x = p.x - CW / 2;
				n.y = p.y - CH / 2;
			}
			drawGraph();
		} else if (mode.type === "edge" && tmpEdge) {
			const p = canvasPoint(ev);
			tmpEdge.x2 = p.x;
			tmpEdge.y2 = p.y;
			drawGraph();
		}
	});

	canvas.addEventListener("pointerup", (ev) => {
		if (!mode) return;
		if (mode.type === "edge") {
			tmpEdge = null;
			const card = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest(
				".gbcard",
			) as HTMLElement | null;
			if (card) reparent(mode.fromId, card.dataset.id as string);
			state.onChange();
		} else if (mode.type === "node") {
			mode.el.classList.remove("dragging");
			if (!mode.moved) state.selection = mode.id;
			state.onChange();
		} else if (mode.type === "add") {
			state.selection = mode.id;
			state.onChange();
		}
		canvas.classList.remove("panning");
		mode = null;
	});

	canvas.addEventListener(
		"wheel",
		(ev) => {
			ev.preventDefault();
			const r = canvas.getBoundingClientRect();
			zoomAt(ev.clientX - r.left, ev.clientY - r.top, ev.deltaY < 0 ? 1.08 : 0.93);
		},
		{ passive: false },
	);

	const zoomAt = (px: number, py: number, m: number) => {
		const k2 = Math.min(1.6, Math.max(0.3, state.view.k * m));
		state.view.x = px - (px - state.view.x) * (k2 / state.view.k);
		state.view.y = py - (py - state.view.y) * (k2 / state.view.k);
		state.view.k = k2;
		applyView();
	};
	const center = () => {
		const r = canvas.getBoundingClientRect();
		return { x: r.width / 2, y: r.height / 2 };
	};
	document.getElementById("z-in")?.addEventListener("click", () => zoomAt(center().x, center().y, 1.2));
	document.getElementById("z-out")?.addEventListener("click", () => zoomAt(center().x, center().y, 1 / 1.2));
	document.getElementById("z-fit")?.addEventListener("click", fitView);

	const palette = document.getElementById("palette") as HTMLElement;
	for (const kind of Object.keys(KIND_META) as NodeKind[]) {
		const item = document.createElement("div");
		item.className = "palitem";
		item.dataset.kind = kind;
		item.dataset.kind = kind;
		item.innerHTML = `<span class="kdot"></span>${KIND_META[kind].label}`;
		palette.insertBefore(item, palette.querySelector(".hint"));
	}
	palette.addEventListener("pointerdown", (ev) => {
		const item = (ev.target as HTMLElement).closest(".palitem") as HTMLElement | null;
		if (!item || !state.bundle) return;
		const p = canvasPoint(ev as PointerEvent);
		const id = addNode(item.dataset.kind as NodeKind, p.x, p.y);
		mode = { type: "add", id };
		canvas.setPointerCapture((ev as PointerEvent).pointerId);
	});
}
