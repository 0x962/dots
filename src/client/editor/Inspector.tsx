import { ChevronDown, ChevronUp, Maximize2, Trash2 } from "lucide-react";
import {
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
} from "react";
import { carriesInstructions } from "../../core/types";
import { KIND } from "../shared/kinds";
import { toast } from "../shared/toast";
import { MarkdownEditor } from "./MarkdownEditor";
import { useEditor } from "./store";

/** Passed verbatim to `claude --model`: aliases resolve to the latest of
 * each family; pinned ids stay on an exact model. */
const MODEL_GROUPS: Array<{ group: string; options: Array<{ value: string; label: string }> }> = [
	{
		group: "Latest",
		options: [
			{ value: "opus", label: "Opus (latest)" },
			{ value: "sonnet", label: "Sonnet (latest)" },
			{ value: "haiku", label: "Haiku (latest)" },
		],
	},
	{
		group: "Pinned",
		options: [
			{ value: "claude-fable-5", label: "Fable 5" },
			{ value: "claude-opus-5", label: "Opus 5" },
			{ value: "claude-opus-4-8", label: "Opus 4.8" },
			{ value: "claude-opus-4-7", label: "Opus 4.7" },
			{ value: "claude-opus-4-6", label: "Opus 4.6" },
			{ value: "claude-sonnet-5", label: "Sonnet 5" },
			{ value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
			{ value: "claude-haiku-4-5", label: "Haiku 4.5" },
		],
	},
];

function useInspectorWidth() {
	const [width, setWidth] = useState(() => Number(localStorage.getItem("dots:inspector-w")) || 400);
	const ref = useRef(width);
	const startDrag = (e: ReactMouseEvent) => {
		e.preventDefault();
		const x0 = e.clientX;
		const w0 = ref.current;
		const move = (ev: MouseEvent) => {
			const w = Math.min(720, Math.max(320, w0 + (x0 - ev.clientX)));
			ref.current = w;
			setWidth(w);
		};
		const up = () => {
			window.removeEventListener("mousemove", move);
			window.removeEventListener("mouseup", up);
			localStorage.setItem("dots:inspector-w", String(ref.current));
		};
		window.addEventListener("mousemove", move);
		window.addEventListener("mouseup", up);
	};
	return { width, startDrag };
}

function ExpandButton({ target, title }: { target: string; title: string }) {
	const setExpanded = useEditor((s) => s.setExpanded);
	return (
		<button
			type="button"
			className="btn ghost icon sm"
			title={title}
			onClick={() => setExpanded(target)}
		>
			<Maximize2 size={12} />
		</button>
	);
}

export function Inspector() {
	const bundle = useEditor((s) => s.bundle);
	const selection = useEditor((s) => s.selection);
	const setNode = useEditor((s) => s.setNode);
	const setInstructions = useEditor((s) => s.setInstructions);
	const setBriefing = useEditor((s) => s.setBriefing);
	const deleteNode = useEditor((s) => s.deleteNode);
	const shiftNode = useEditor((s) => s.shiftNode);
	const commitTitle = useEditor((s) => s.commitTitle);
	const { width, startDrag } = useInspectorWidth();

	const wrap = (style: CSSProperties | undefined, children: ReactNode) => (
		<aside className="inspector" style={{ ...style, width }}>
			<div className="resize-h" onMouseDown={startDrag} />
			{children}
		</aside>
	);

	if (!bundle) return wrap(undefined, null);

	const node = selection ? bundle.doc.nodes[selection] : undefined;
	if (!selection || !node) {
		return wrap(
			undefined,
			<>
				<div className="insp-head">
					<div className="grow">
						<h3>Briefing</h3>
						<p className="lede">
							What every agent in the run reads first: the ground rules, the finding format, the
							voice. Select a node to edit it instead.
						</p>
					</div>
					<div className="insp-tools">
						<ExpandButton target="briefing" title="Open the full editor" />
					</div>
				</div>
				<MarkdownEditor
					tall
					value={bundle.briefing}
					onChange={setBriefing}
					placeholder="Ground rules for every node…"
				/>
			</>,
		);
	}

	const meta = KIND[node.kind];
	const isRoot = selection === bundle.doc.root;

	return wrap(
		{ "--kc": meta.color } as CSSProperties,
		<>
			<div className="insp-head">
				<div className="grow">
					<div className="insp-kind">
						<span className="n-ico">
							<meta.Icon size={13} />
						</span>
						<span>{meta.label}</span>
						{isRoot && <span className="chip start-flag">START</span>}
					</div>
					<p className="lede">{meta.lede}</p>
				</div>
				<div className="insp-tools">
					<button type="button" className="btn ghost icon sm" title="Move earlier" disabled={isRoot} onClick={() => shiftNode(selection, -1)}>
						<ChevronUp size={13} />
					</button>
					<button type="button" className="btn ghost icon sm" title="Move later" disabled={isRoot} onClick={() => shiftNode(selection, 1)}>
						<ChevronDown size={13} />
					</button>
					<button type="button" className="btn ghost icon sm danger" title="Delete node and its subtree" disabled={isRoot} onClick={() => deleteNode(selection)}>
						<Trash2 size={13} />
					</button>
				</div>
			</div>

			<div className="insp-body">
				<div className="field">
					<label>Title</label>
					<input
						className="input"
						value={node.title}
						onChange={(e) => setNode(selection, { title: e.target.value }, `title:${selection}`)}
						onBlur={() => commitTitle(selection)}
						onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
					/>
				</div>

				{["agent", "gate", "loop"].includes(node.kind) && (
					<div className="field">
						<label>Model</label>
						<select
							className="select"
							value={node.model ?? ""}
							onChange={(e) =>
								setNode(selection, { model: e.target.value || undefined }, `model:${selection}`)
							}
						>
							<option value="">Default (CLI setting)</option>
							{MODEL_GROUPS.map((g) => (
								<optgroup key={g.group} label={g.group}>
									{g.options.map((m) => (
										<option key={m.value} value={m.value}>
											{m.label}
										</option>
									))}
								</optgroup>
							))}
						</select>
						<span className="hint">the claude model this node's agent runs on</span>
					</div>
				)}

				{node.kind === "budget" && (
					<div className="field">
						<label>Minutes</label>
						<input
							className="input"
							type="number"
							min={1}
							style={{ width: 110 }}
							value={node.minutes ?? 10}
							onChange={(e) => setNode(selection, { minutes: Number(e.target.value) }, `minutes:${selection}`)}
						/>
						<span className="hint">when time runs out, everything unfinished inside fails</span>
					</div>
				)}

				{node.kind === "loop" && (
					<div className="field">
						<label>Max rounds</label>
						<input
							className="input"
							type="number"
							min={1}
							style={{ width: 110 }}
							value={node.maxRounds ?? 2}
							onChange={(e) => setNode(selection, { maxRounds: Number(e.target.value) }, `rounds:${selection}`)}
						/>
					</div>
				)}

				{carriesInstructions(node.kind) && (
					<div className="field grow-field">
						<div className="label-row">
							<label>{node.kind === "loop" ? "Exit question" : "Instructions"}</label>
							<ExpandButton target={selection} title="Open the full editor (Enter, or double-click the node)" />
						</div>
						{node.kind === "gate" && (
							<span className="hint">
								the agent ends with exactly YES or NO · YES runs the left lane, NO the right ·
								drop nodes on a lane to build its branch
							</span>
						)}
						{node.kind === "loop" && (
							<span className="hint">asked after each round; the agent ends with DONE or AGAIN</span>
						)}
						<MarkdownEditor
							key={selection}
							tall
							value={bundle.instructions[selection] ?? ""}
							onChange={(text) => setInstructions(selection, text)}
							placeholder={node.kind === "human" ? "What the person approves…" : "What this node does…"}
						/>
					</div>
				)}
			</div>
		</>,
	);
}
