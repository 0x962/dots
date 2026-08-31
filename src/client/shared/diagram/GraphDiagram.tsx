import {
	Background,
	BackgroundVariant,
	Controls,
	MarkerType,
	MiniMap,
	ReactFlow,
	ReactFlowProvider,
	ViewportPortal,
	useReactFlow,
	type Edge,
	type Node,
	type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { NodeKind, RunNode } from "../../../core/types";
import { KIND } from "../kinds";
import { computeLayout, frameAt, insertionIndex, laneOf, START_ID, type DiagramDoc, type Rect } from "../layout";
import { CardNode } from "./CardNode";
import "./diagram.css";
import { ElbowEdge } from "./ElbowEdge";
import { FrameNode } from "./FrameNode";
import { LaneNode } from "./LaneNode";
import { TerminalNode } from "./TerminalNode";
import { useTokens } from "./tokens";

export interface DiagramProps {
	/** Refit the viewport when this changes (graph or run switch). */
	docKey: string;
	doc: DiagramDoc;
	mode: "edit" | "run";
	selection: string | null;
	onSelect: (id: string | null) => void;
	runById?: Map<string, RunNode>;
	/** Bump nonce to pan the viewport to a node. */
	focus?: { id: string; nonce: number } | null;
	onMove?: (id: string, parentId: string, index: number) => void;
	onDropKind?: (kind: NodeKind, parentId: string, index: number) => void;
	onAddInto?: (parentId: string) => void;
	onAnswer?: (id: string, approve: boolean) => void;
	/** Double-click on a node, e.g. to open its prompt editor. Start passes "briefing". */
	onNodeOpen?: (id: string) => void;
	/** Run board: what the End marker shows. */
	runVerdict?: { word: string; tone: string };
}

const nodeTypes: NodeTypes = { card: CardNode, frame: FrameNode, lane: LaneNode, terminal: TerminalNode };
const edgeTypes = { elbow: ElbowEdge };

const TOKEN_NAMES = [
	"--edge",
	"--canvas",
	"--dot",
	"--accent",
	"--flow",
	"--flow-no",
	"--text-faint",
	"--k-agent",
	"--k-gate",
	"--k-parallel",
	"--k-sequence",
	"--k-budget",
	"--k-loop",
	"--k-human",
];

const SETTLED = new Set(["ok", "failed", "skipped"]);

function DiagramInner(props: DiagramProps) {
	const { doc, docKey, mode, selection, onSelect, runById, focus, onMove, onDropKind, onAddInto, onAnswer, onNodeOpen, runVerdict } = props;
	const rf = useReactFlow();
	const tokens = useTokens(TOKEN_NAMES);
	const [highlight, setHighlight] = useState<Rect | null>(null);

	const cardH = 46;
	// A parked human card carries its Approve buttons, so it alone is taller.
	const tall = useMemo(() => {
		if (mode !== "run" || !runById) return undefined;
		const ids = new Set(
			[...runById.values()].filter((n) => n.kind === "human" && n.status === "waiting").map((n) => n.id),
		);
		return ids.size > 0 ? { ids, h: 78 } : undefined;
	}, [mode, runById]);
	const layout = useMemo(() => computeLayout(doc, cardH, tall), [doc, cardH, tall]);

	const progress = useMemo(() => {
		if (mode !== "run" || !runById) return new Map<string, { done: number; total: number }>();
		const map = new Map<string, { done: number; total: number }>();
		const walk = (id: string): { done: number; total: number } => {
			let done = 0;
			let total = 0;
			const n = doc.nodes[id];
			for (const c of [...(n?.children ?? []), ...(n?.elseChildren ?? [])]) {
				if (!doc.nodes[c]) continue;
				total += 1;
				if (SETTLED.has(runById.get(c)?.status ?? "")) done += 1;
				const sub = walk(c);
				done += sub.done;
				total += sub.total;
			}
			map.set(id, { done, total });
			return { done, total };
		};
		walk(doc.root);
		return map;
	}, [doc, runById, mode]);

	const rfNodes = useMemo(() => {
		const out: Node[] = [];
		for (const id of layout.order) {
			const r = layout.rects.get(id);
			if (!r) continue;
			const rfp = layout.rfParent.get(id);
			const pr = rfp ? layout.rects.get(rfp) : undefined;
			const position = pr ? { x: r.x - pr.x, y: r.y - pr.y } : { x: r.x, y: r.y };
			const terminal = layout.terminals.get(id);
			if (terminal) {
				out.push({
					id,
					type: "terminal",
					position,
					style: { width: r.w, height: r.h },
					draggable: false,
					selectable: false,
					className: terminal === "start" && selection === "briefing" ? "sel" : "",
					data: {
						kind: terminal,
						mode,
						...(terminal === "end" && runVerdict
							? { runWord: runVerdict.word, runTone: runVerdict.tone }
							: {}),
					},
				});
				continue;
			}
			const lane = layout.lanes.get(id);
			if (lane) {
				const gateRun = runById?.get(lane.gateId);
				const verdict = gateRun?.note?.startsWith("YES") ? "yes" : gateRun?.note?.startsWith("NO") ? "no" : null;
				out.push({
					id,
					type: "lane",
					position,
					...(rfp ? { parentId: rfp } : {}),
					style: { width: r.w, height: r.h },
					draggable: false,
					selectable: false,
					data: {
						laneId: id,
						gateId: lane.gateId,
						tone: lane.tone,
						empty: lane.empty,
						mode,
						notTaken: !!verdict && verdict !== lane.tone,
						onAddInto,
					},
				});
				continue;
			}
			const meta = doc.nodes[id];
			if (!meta) continue;
			const gpid = layout.parent.get(id);
			const parentMeta = gpid ? doc.nodes[gpid] : undefined;
			const seqIndex =
				parentMeta && KIND[parentMeta.kind].flow === "column" && parentMeta.kind !== "gate"
					? parentMeta.children.filter((c) => doc.nodes[c]).indexOf(id) + 1
					: null;
			const frame = meta.kind !== "gate" && KIND[meta.kind].flow !== "leaf";
			out.push({
				id,
				type: frame ? "frame" : "card",
				position,
				...(rfp ? { parentId: rfp } : {}),
				style: { width: r.w, height: r.h },
				draggable: mode === "edit" && !!onMove && id !== doc.root,
				selectable: false,
				className: id === selection ? "sel" : "",
				data: {
					nodeId: id,
					meta,
					mode,
					isRoot: id === doc.root,
					seqIndex,
					muted: layout.muted.has(id),
					run: runById?.get(id),
					progress: frame ? progress.get(id) : undefined,
					onAddInto,
					onAnswer,
				},
			});
		}
		return out;
	}, [layout, doc, runById, selection, mode, onAddInto, onAnswer, onMove, progress]);

	const rfEdges = useMemo(() => {
		const neutral = tokens["--edge"] || "#8892a4";
		const toneColor = { yes: tokens["--flow"] || "#35815a", no: tokens["--flow-no"] || "#b65454" };
		return layout.arrows.map((a): Edge => {
			const color = a.tone ? toneColor[a.tone] : neutral;
			return {
				id: `a:${a.from}->${a.to}`,
				source: a.from,
				target: a.to,
				sourceHandle: a.fromHandle ?? "s",
				targetHandle: a.toHandle ?? "t",
				type: "elbow",
				zIndex: 2400,
				style: { stroke: color, strokeWidth: 1.5, ...(a.tone === "no" ? { strokeDasharray: "5 4" } : {}) },
				markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color },
			};
		});
	}, [layout, tokens]);

	const current = useRef({ layout, doc, rfNodes });
	current.current = { layout, doc, rfNodes };

	useEffect(() => {
		rf.setNodes(rfNodes);
		rf.setEdges(rfEdges);
	}, [rf, rfNodes, rfEdges]);

	// Zoom and pan survive reloads and Editor↔Runs switches: the viewport is
	// remembered per graph. It is restored only while it still shows a fifth
	// of the graph; a stale zoom that leaves the diagram off screen refits.
	const wrapRef = useRef<HTMLDivElement>(null);
	const vpKey = `dots:vp:${docKey.split(":")[0]}`;
	useEffect(() => {
		const saved = localStorage.getItem(vpKey);
		const t = setTimeout(() => {
			const el = wrapRef.current;
			if (saved && el) {
				const vp = JSON.parse(saved) as { x: number; y: number; zoom: number };
				let minX = Infinity;
				let minY = Infinity;
				let maxX = -Infinity;
				let maxY = -Infinity;
				for (const r of current.current.layout.rects.values()) {
					minX = Math.min(minX, r.x);
					minY = Math.min(minY, r.y);
					maxX = Math.max(maxX, r.x + r.w);
					maxY = Math.max(maxY, r.y + r.h);
				}
				const sx = minX * vp.zoom + vp.x;
				const sy = minY * vp.zoom + vp.y;
				const ex = maxX * vp.zoom + vp.x;
				const ey = maxY * vp.zoom + vp.y;
				const visW = Math.min(ex, el.clientWidth) - Math.max(sx, 0);
				const visH = Math.min(ey, el.clientHeight) - Math.max(sy, 0);
				const frac = visW > 0 && visH > 0 ? (visW * visH) / ((ex - sx) * (ey - sy)) : 0;
				if (frac > 0.2) {
					void rf.setViewport(vp);
					return;
				}
			}
			void rf.fitView({ padding: 0.12, maxZoom: 1 });
		}, 40);
		return () => clearTimeout(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [docKey]);

	useEffect(() => {
		if (!focus) return;
		const r = current.current.layout.rects.get(focus.id);
		if (r) rf.fitBounds({ x: r.x, y: r.y, width: r.w, height: r.h }, { padding: 0.6, duration: 260 });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [focus?.nonce]);

	// Two clicks on the same node inside 400ms open it. Hand-rolled because
	// React Flow's own dblclick handler misses when a click re-renders nodes.
	const lastClick = useRef<{ id: string; t: number }>({ id: "", t: 0 });
	const onNodeClick = (_: unknown, node: Node) => {
		// A lane is chrome for its gate: clicking it means the gate. Start is
		// the briefing; End is inert.
		const terminal = layout.terminals.get(node.id);
		const id = terminal ? (terminal === "start" ? "briefing" : null) : (laneOf(node.id)?.gateId ?? node.id);
		if (id === null) {
			onSelect(null);
			return;
		}
		const now = Date.now();
		if (onNodeOpen && lastClick.current.id === id && now - lastClick.current.t < 400) {
			lastClick.current = { id: "", t: 0 };
			onNodeOpen(id);
			return;
		}
		lastClick.current = { id, t: now };
		onSelect(id);
	};

	const pointOf = (e: { clientX: number; clientY: number }) =>
		rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });

	type DragEv = globalThis.MouseEvent | globalThis.TouchEvent;
	const dragPoint = (e: DragEv) => pointOf("clientX" in e ? e : e.changedTouches[0]);

	const onNodeDrag = (e: DragEv, node: Node) => {
		const pt = dragPoint(e);
		const target = frameAt(current.current.doc, current.current.layout, pt, node.id);
		setHighlight(target ? (current.current.layout.rects.get(target) ?? null) : null);
	};

	const onNodeDragStop = (e: DragEv, node: Node) => {
		setHighlight(null);
		const pt = dragPoint(e);
		const { doc: d, layout: l } = current.current;
		const target = frameAt(d, l, pt, node.id);
		if (target && onMove) {
			onMove(node.id, target, insertionIndex(d, l, target, pt, node.id));
		}
		requestAnimationFrame(() => rf.setNodes(current.current.rfNodes));
	};

	const onDragOver = (e: DragEvent) => {
		if (!e.dataTransfer.types.includes("application/dots-kind")) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = "copy";
		const pt = pointOf(e);
		const target = frameAt(current.current.doc, current.current.layout, pt);
		setHighlight(target ? (current.current.layout.rects.get(target) ?? null) : null);
	};

	const onDrop = (e: DragEvent) => {
		const kind = e.dataTransfer.getData("application/dots-kind") as NodeKind | "";
		setHighlight(null);
		if (!kind || !onDropKind) return;
		e.preventDefault();
		const pt = pointOf(e);
		const { doc: d, layout: l } = current.current;
		const target = frameAt(d, l, pt) ?? d.root;
		onDropKind(kind, target, insertionIndex(d, l, target, pt));
	};

	return (
		<div ref={wrapRef} className="diagram" onDragOver={onDragOver} onDrop={onDrop} onDragLeave={() => setHighlight(null)}>
			<ReactFlow
				defaultNodes={[]}
				defaultEdges={[]}
				nodeTypes={nodeTypes}
				edgeTypes={edgeTypes}
				proOptions={{ hideAttribution: true }}
				minZoom={0.2}
				maxZoom={1.6}
				panOnScroll
				zoomOnScroll={false}
				zoomOnDoubleClick={false}
				selectNodesOnDrag={false}
				nodesConnectable={false}
				elementsSelectable={false}
				deleteKeyCode={null}
				onNodeClick={onNodeClick}
				onMoveEnd={(_, viewport) => localStorage.setItem(vpKey, JSON.stringify(viewport))}
				onNodeDrag={onNodeDrag}
				onNodeDragStop={onNodeDragStop}
				onPaneClick={() => onSelect(null)}
			>
				<Background variant={BackgroundVariant.Dots} gap={24} size={1.4} color={tokens["--dot"] || "#d0d4dc"} />
				<Controls showInteractive={false} position="bottom-right" />
				{/* A small graph fits on screen whole; the minimap only earns its
				    corner once there is something off screen to find. */}
				{Object.keys(doc.nodes).length >= 16 && (
					<MiniMap
						pannable
						zoomable
						position="bottom-left"
						style={{ width: 160, height: 104 }}
						maskColor={(tokens["--canvas"] || "#eef0f4") + "c9"}
						bgColor={tokens["--canvas"] || undefined}
						nodeColor={(n) => {
							const meta = (n.data as { meta?: { kind: NodeKind } }).meta;
							if (!meta) return tokens["--dot"] || "#333";
							if (KIND[meta.kind].flow !== "leaf") return tokens["--dot"] || "#333";
							const varName = KIND[meta.kind].color.slice(4, -1);
							return tokens[varName] || "#888";
						}}
						nodeStrokeWidth={0}
					/>
				)}
				{highlight && (
					<ViewportPortal>
						<div
							style={{
								position: "absolute",
								transform: `translate(${highlight.x}px, ${highlight.y}px)`,
								width: highlight.w,
								height: highlight.h,
								border: "2px solid var(--accent)",
								borderRadius: 12,
								background: "var(--accent-soft)",
								pointerEvents: "none",
								zIndex: 3000,
							}}
						/>
					</ViewportPortal>
				)}
			</ReactFlow>
		</div>
	);
}

export function GraphDiagram(props: DiagramProps) {
	return (
		<ReactFlowProvider>
			<DiagramInner {...props} />
		</ReactFlowProvider>
	);
}
