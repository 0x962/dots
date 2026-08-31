import type { NodeKind } from "../../core/types";
import { KIND } from "./kinds";

/**
 * The canvas draws containment, not wires: a container (sequence, parallel,
 * budget, loop) is a frame and its children sit inside it. This module
 * computes every rectangle from the tree alone, so two nodes can never
 * overlap and the picture is the same on every machine. Sequence and loop
 * children stack top to bottom (their run order); parallel and budget
 * children flow left to right, wrapping into rows.
 *
 * A gate is not a frame: it is an if/else decision point on the line. The
 * gate's card sits in the flow, and two branch lanes hang below it, YES on
 * the left, NO on the right. A lane is a synthetic canvas element (id
 * `<gateId>~yes` / `<gateId>~no`), not a graph node; an empty lane draws as
 * a "skip" terminal. In a sequence, both lanes point at the next step.
 */

export interface DiagramMeta {
	kind: NodeKind;
	title: string;
	children: string[];
	elseChildren?: string[];
	minutes?: number;
	maxRounds?: number;
}

export interface DiagramDoc {
	root: string;
	nodes: Record<string, DiagramMeta>;
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface LaneInfo {
	gateId: string;
	tone: "yes" | "no";
	empty: boolean;
}

export interface Arrow {
	from: string;
	to: string;
	tone?: "yes" | "no";
	label?: string;
	/** Handle overrides: "open" leaves a container's opening line, "tc" lands on its closing line. */
	fromHandle?: string;
	toHandle?: string;
}

export interface Layout {
	/** Absolute rectangles, canvas coordinates. Includes synthetic ids. */
	rects: Map<string, Rect>;
	/** Every laid-out id, parents before children. Includes synthetic ids. */
	order: string[];
	/** Graph parent of each node (a gate's NO members map to the gate). */
	parent: Map<string, string>;
	/** What each id nests under on the canvas (lane members nest in lanes). */
	rfParent: Map<string, string>;
	/** Lane ids to their gate and side. */
	lanes: Map<string, LaneInfo>;
	/** The Start and End markers that bracket the main flow. */
	terminals: Map<string, "start" | "end">;
	/** Frames that draw no chrome: each one is a frame's only child and itself a frame. */
	muted: Set<string>;
	arrows: Arrow[];
}

export const START_ID = "~start";
export const END_ID = "~end";

export const CARD_W = 224;
/** Room above a frame's children for its header, and below for breathing space. */
export const RAIL_H = 34;
const RAIL_BOTTOM_H = 16;
/** A frame whose only child is another frame draws no chrome of its own. */
const MUTED_RAIL = 8;
const FRAME_PAD_X = 14;
const COL_GAP = 28;
const ROW_GAP_X = 14;
const ROW_GAP_Y = 16;
const WRAP = 3;
const EMPTY_W = 204;
const EMPTY_H = 56;
const ORPHAN_GAP = 80;

const LANE_RAIL_H = 26;
const LANE_WRAP = 2;
const SKIP_W = 104;
const SKIP_EMPTY_H = 30;
const BRANCH_DROP = 40;
const BRANCH_GAP_X = 22;
const TERM_W = 132;
const TERM_H = 40;

function isFrame(kind: NodeKind): boolean {
	return kind !== "gate" && KIND[kind].flow !== "leaf";
}

export function laneOf(id: string): { gateId: string; tone: "yes" | "no" } | null {
	const m = /^(.*)~(yes|no)$/.exec(id);
	return m ? { gateId: m[1], tone: m[2] as "yes" | "no" } : null;
}

function chunk<T>(items: T[], size: number): T[][] {
	const rows: T[][] = [];
	for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
	return rows;
}

interface Size {
	w: number;
	h: number;
}

export function computeLayout(
	doc: DiagramDoc,
	cardH: number,
	/** Cards that need extra height, e.g. a parked human node's buttons. */
	tall?: { ids: Set<string>; h: number },
): Layout {
	const leafH = (id: string): number => (tall?.ids.has(id) ? tall.h : cardH);
	const rects = new Map<string, Rect>();
	const order: string[] = [];
	const parent = new Map<string, string>();
	const rfParent = new Map<string, string>();
	const lanes = new Map<string, LaneInfo>();
	const terminals = new Map<string, "start" | "end">();
	const arrows: Arrow[] = [];
	const sizes = new Map<string, Size>();
	const placed = new Set<string>();

	for (const [id, n] of Object.entries(doc.nodes)) {
		for (const c of [...n.children, ...(n.elseChildren ?? [])]) {
			if (doc.nodes[c] && !parent.has(c)) parent.set(c, id);
		}
	}

	const valid = (list: string[] | undefined, owner: string): string[] =>
		(list ?? []).filter((c) => doc.nodes[c] && parent.get(c) === owner);

	const muted = new Set<string>();
	for (const [id, n] of Object.entries(doc.nodes)) {
		if (!isFrame(n.kind)) continue;
		const kids = valid(n.children, id);
		if (kids.length === 1 && isFrame(doc.nodes[kids[0]].kind)) muted.add(kids[0]);
	}
	const railTop = (id: string): number => (muted.has(id) ? MUTED_RAIL : RAIL_H);
	const railBottom = (id: string): number => (muted.has(id) ? MUTED_RAIL : RAIL_BOTTOM_H);
	const padX = (id: string): number => (muted.has(id) ? 0 : FRAME_PAD_X);

	const gridSize = (members: Size[], wrap: number, minW: number, headerH: number, pad: number): Size => {
		const rows = chunk(members, wrap);
		const rowWs = rows.map((r) => r.reduce((t, c) => t + c.w, 0) + ROW_GAP_X * (r.length - 1));
		const rowHs = rows.map((r) => Math.max(...r.map((c) => c.h)));
		return {
			w: Math.max(minW, Math.max(...rowWs) + pad * 2),
			h: headerH + pad + rowHs.reduce((t, rh) => t + rh, 0) + ROW_GAP_Y * (rows.length - 1) + pad,
		};
	};

	const laneSize = (members: Size[]): Size => {
		if (members.length === 0) return { w: SKIP_W, h: LANE_RAIL_H + SKIP_EMPTY_H };
		const g = gridSize(members, LANE_WRAP, 0, 0, 0);
		return { w: Math.max(SKIP_W, g.w), h: LANE_RAIL_H + g.h };
	};

	const measure = (id: string, trail: Set<string>): Size => {
		const hit = sizes.get(id);
		if (hit) return hit;
		const n = doc.nodes[id];
		let size: Size = { w: CARD_W, h: leafH(id) };
		if (n && !trail.has(id)) {
			trail.add(id);
			if (n.kind === "gate") {
				const yes = laneSize(valid(n.children, id).map((c) => measure(c, trail)));
				const no = laneSize(valid(n.elseChildren, id).map((c) => measure(c, trail)));
				size = {
					w: Math.max(CARD_W, yes.w + BRANCH_GAP_X + no.w),
					h: cardH + BRANCH_DROP + Math.max(yes.h, no.h),
				};
			} else if (isFrame(n.kind)) {
				const children = valid(n.children, id).map((c) => measure(c, trail));
				if (children.length === 0) {
					size = { w: EMPTY_W, h: railTop(id) + EMPTY_H + railBottom(id) };
				} else if (KIND[n.kind].flow === "column") {
					size = {
						w: Math.max(...children.map((c) => c.w)) + padX(id) * 2,
						h:
							railTop(id) +
							children.reduce((t, c) => t + c.h, 0) +
							COL_GAP * (children.length - 1) +
							railBottom(id),
					};
				} else {
					const g = gridSize(children, WRAP, 0, 0, 0);
					size = { w: g.w + padX(id) * 2, h: railTop(id) + g.h + railBottom(id) };
				}
			}
			trail.delete(id);
		}
		sizes.set(id, size);
		return size;
	};

	/** Lays out `members` as a wrapped grid inside (x..x+w, from y down). */
	const placeGrid = (
		members: string[],
		x: number,
		y: number,
		w: number,
		wrap: number,
		rfp: string,
	): void => {
		const rows = chunk(members, wrap);
		let ry = y;
		for (const row of rows) {
			const rowW = row.reduce((t, c) => t + (sizes.get(c)?.w ?? CARD_W), 0) + ROW_GAP_X * (row.length - 1);
			const rowH = Math.max(...row.map((c) => sizes.get(c)?.h ?? leafH(c)));
			let rx = x + (w - rowW) / 2;
			for (const c of row) {
				place(c, rx, ry, rfp);
				rx += (sizes.get(c)?.w ?? CARD_W) + ROW_GAP_X;
			}
			ry += rowH + ROW_GAP_Y;
		}
	};

	const place = (id: string, x: number, y: number, rfp: string): void => {
		if (placed.has(id)) return;
		placed.add(id);
		const n = doc.nodes[id];
		const size = sizes.get(id) ?? { w: CARD_W, h: leafH(id) };
		if (n?.kind === "gate") {
			const cardX = x + (size.w - CARD_W) / 2;
			rects.set(id, { x: cardX, y, w: CARD_W, h: cardH });
			order.push(id);
			if (rfp) rfParent.set(id, rfp);
			const yesMembers = valid(n.children, id);
			const noMembers = valid(n.elseChildren, id);
			const yesSize = laneSize(yesMembers.map((c) => sizes.get(c) ?? { w: CARD_W, h: leafH(c) }));
			const noSize = laneSize(noMembers.map((c) => sizes.get(c) ?? { w: CARD_W, h: leafH(c) }));
			const lanesY = y + cardH + BRANCH_DROP;
			let lx = x + (size.w - (yesSize.w + BRANCH_GAP_X + noSize.w)) / 2;
			for (const [tone, laneSz, members] of [
				["yes", yesSize, yesMembers],
				["no", noSize, noMembers],
			] as const) {
				const laneId = `${id}~${tone}`;
				rects.set(laneId, { x: lx, y: lanesY, w: laneSz.w, h: laneSz.h });
				order.push(laneId);
				lanes.set(laneId, { gateId: id, tone, empty: members.length === 0 });
				if (rfp) rfParent.set(laneId, rfp);
				placeGrid(members, lx, lanesY + LANE_RAIL_H, laneSz.w, LANE_WRAP, laneId);
				arrows.push({ from: id, to: laneId, tone });
				// A lone child under the lane line is a pass-through: thread the
				// flow into it. Several children hang from the line unordered.
				if (members.length === 1) {
					arrows.push({ from: laneId, to: members[0], tone, fromHandle: "open" });
				}
				lx += laneSz.w + BRANCH_GAP_X;
			}
			return;
		}
		rects.set(id, { x, y, w: size.w, h: size.h });
		order.push(id);
		if (rfp) rfParent.set(id, rfp);
		if (!n || !isFrame(n.kind)) return;
		const children = valid(n.children, id);
		const intoClosing = (c: string): void => {
			if (doc.nodes[c].kind === "gate") {
				arrows.push(
					{ from: `${c}~yes`, to: id, toHandle: "tc" },
					{ from: `${c}~no`, to: id, toHandle: "tc" },
				);
			} else {
				arrows.push({ from: c, to: id, toHandle: "tc" });
			}
		};
		if (KIND[n.kind].flow === "column") {
			let cy = y + railTop(id);
			for (let i = 0; i < children.length; i++) {
				const c = children[i];
				const cs = sizes.get(c) ?? { w: CARD_W, h: leafH(c) };
				place(c, x + (size.w - cs.w) / 2, cy, id);
				cy += cs.h + COL_GAP;
				if (i < children.length - 1) {
					const next = children[i + 1];
					// A gate hands the flow on through its lanes: both point at
					// the next step, so the if and the else visibly converge.
					if (doc.nodes[c].kind === "gate") {
						arrows.push({ from: `${c}~yes`, to: next }, { from: `${c}~no`, to: next });
					} else {
						arrows.push({ from: c, to: next });
					}
				}
			}
			if (children.length > 0) {
				arrows.push({ from: id, to: children[0], fromHandle: "open" });
				intoClosing(children[children.length - 1]);
			}
		} else {
			// The frame itself is the distributor; an arrow to every child would
			// dogleg across the row and read as extra wiring. A lone child sits
			// on the center line, so threading it stays straight. A muted child
			// draws no chrome, so an arrow at it would point at nothing.
			placeGrid(children, x + padX(id), y + railTop(id), size.w - padX(id) * 2, WRAP, id);
			if (children.length === 1 && !muted.has(children[0])) {
				arrows.push({ from: id, to: children[0], fromHandle: "open" });
				intoClosing(children[0]);
			}
		}
	};

	const placeTerminal = (id: string, kind: "start" | "end", cx: number, y: number): void => {
		rects.set(id, { x: cx - TERM_W / 2, y, w: TERM_W, h: TERM_H });
		order.push(id);
		terminals.set(id, kind);
	};

	/** An arrow out of `fromId`: a gate hands the flow on through its lanes. */
	const flowArrow = (fromId: string, toId: string): void => {
		if (doc.nodes[fromId]?.kind === "gate") {
			arrows.push({ from: `${fromId}~yes`, to: toId }, { from: `${fromId}~no`, to: toId });
		} else {
			arrows.push({ from: fromId, to: toId });
		}
	};

	let x = 0;
	const rootNode = doc.nodes[doc.root];
	if (rootNode) {
		let mainW: number;
		if (rootNode.kind !== "gate" && KIND[rootNode.kind].flow === "column") {
			// The root sequence is the flow itself, so its frame is not drawn:
			// Start, then its steps top to bottom, then End.
			const children = valid(rootNode.children, doc.root);
			const childSizes = children.map((c) => measure(c, new Set([doc.root])));
			mainW = Math.max(TERM_W, ...childSizes.map((s) => s.w));
			let cy = 0;
			placeTerminal(START_ID, "start", x + mainW / 2, cy);
			cy += TERM_H + COL_GAP;
			let prev = START_ID;
			for (const c of children) {
				const cs = sizes.get(c) ?? { w: CARD_W, h: leafH(c) };
				place(c, x + (mainW - cs.w) / 2, cy, "");
				flowArrow(prev, c);
				prev = c;
				cy += cs.h + COL_GAP;
			}
			placeTerminal(END_ID, "end", x + mainW / 2, cy);
			flowArrow(prev, END_ID);
		} else {
			const size = measure(doc.root, new Set());
			mainW = size.w;
			placeTerminal(START_ID, "start", x + mainW / 2, 0);
			place(doc.root, x, TERM_H + COL_GAP, "");
			arrows.push({ from: START_ID, to: doc.root });
			placeTerminal(END_ID, "end", x + mainW / 2, TERM_H + COL_GAP + size.h + COL_GAP);
			flowArrow(doc.root, END_ID);
		}
		x += mainW + ORPHAN_GAP;
	}
	for (const id of Object.keys(doc.nodes)) {
		if (id !== doc.root && !parent.has(id)) {
			const size = measure(id, new Set());
			place(id, x, 0, "");
			x += size.w + ORPHAN_GAP;
		}
	}

	return { rects, order, parent, rfParent, lanes, terminals, muted, arrows };
}

/**
 * The deepest drop target whose rectangle contains the point: a frame, or a
 * gate's branch lane. Skips `exclude` and everything under it.
 */
export function frameAt(
	doc: DiagramDoc,
	layout: Layout,
	point: { x: number; y: number },
	exclude?: string,
): string | null {
	const banned = new Set<string>();
	if (exclude) {
		const walk = (id: string) => {
			banned.add(id);
			const n = doc.nodes[id];
			if (!n) return;
			for (const c of [...n.children, ...(n.elseChildren ?? [])]) {
				if (doc.nodes[c]) walk(c);
			}
		};
		walk(exclude);
	}
	let best: string | null = null;
	let bestArea = Infinity;
	for (const [id, r] of layout.rects) {
		const lane = layout.lanes.get(id);
		if (lane) {
			if (banned.has(lane.gateId)) continue;
		} else {
			const n = doc.nodes[id];
			if (!n || !isFrame(n.kind) || banned.has(id)) continue;
		}
		if (point.x < r.x || point.x > r.x + r.w || point.y < r.y || point.y > r.y + r.h) continue;
		const area = r.w * r.h;
		if (area < bestArea) {
			best = id;
			bestArea = area;
		}
	}
	return best;
}

/** Where among the target's members the point lands, as an insertion index. */
export function insertionIndex(
	doc: DiagramDoc,
	layout: Layout,
	targetId: string,
	point: { x: number; y: number },
	exclude?: string,
): number {
	const lane = layout.lanes.get(targetId);
	const gate = lane ? doc.nodes[lane.gateId] : undefined;
	const list = lane
		? (lane.tone === "yes" ? (gate?.children ?? []) : (gate?.elseChildren ?? []))
		: (doc.nodes[targetId]?.children ?? []);
	const children = list.filter((c) => c !== exclude && layout.rects.has(c));
	const columnFlow = !lane && KIND[doc.nodes[targetId]?.kind ?? "sequence"].flow === "column";
	let index = 0;
	for (const c of children) {
		const r = layout.rects.get(c)!;
		const midX = r.x + r.w / 2;
		const midY = r.y + r.h / 2;
		const after = columnFlow
			? point.y > midY
			: point.y > r.y + r.h || (point.y > r.y - ROW_GAP_Y && point.x > midX);
		if (after) index++;
	}
	return index;
}
