import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import type { CSSProperties } from "react";
import type { RunNode } from "../../../core/types";
import { KIND, STATUS } from "../kinds";
import type { DiagramMeta } from "../layout";

export interface FrameData {
	nodeId: string;
	meta: DiagramMeta;
	mode: "edit" | "run";
	isRoot: boolean;
	seqIndex: number | null;
	/** The frame is a frame's only child: the parent's region already contains it, so it draws no chrome. */
	muted: boolean;
	run?: RunNode;
	/** Settled descendants over all descendants, run mode. */
	progress?: { done: number; total: number };
	onAddInto?: (id: string) => void;
	[key: string]: unknown;
}

/**
 * A container draws as a quiet region: a hairline rounded border with a faint
 * fill in the kind's hue, and a small header (kind icon, config, progress) in
 * the top-left corner. Clicking anywhere on the region selects it.
 */
export function FrameNode(props: NodeProps) {
	const data = props.data as FrameData;
	const { meta, mode, run, seqIndex, progress } = data;
	const kind = KIND[meta.kind];
	const status = run ? STATUS[run.status] : null;
	const style = {
		"--kc": kind.color,
		...(status ? { "--sc": status.color } : {}),
	} as CSSProperties;
	const empty = meta.children.length === 0;

	const config =
		meta.kind === "budget"
			? `${meta.minutes ?? "?"}m`
			: meta.kind === "loop"
				? mode === "run" && run?.round
					? `${run.round}/${meta.maxRounds ?? "?"}`
					: `×${meta.maxRounds ?? "?"}`
				: null;
	const progressStr =
		mode === "run" && progress && progress.total > 0 && meta.kind !== "loop"
			? `${progress.done}/${progress.total}`
			: null;
	const detail = [config, progressStr].filter(Boolean).join(" · ");

	return (
		<div
			className={`n-frame ${data.muted ? "muted" : ""} ${run ? `st-${run.status}` : ""}`}
			style={style}
			title={`${meta.title} · ${kind.label}${status ? ` · ${status.label}` : ""}`}
		>
			<Handle type="target" position={Position.Top} id="t" className="port" isConnectable={false} />
			{/* "open" sits on the top border but its edges leave downward, into
			    the children; "tc" sits on the bottom border and its edges arrive
			    from above. Position sets the edge direction, CSS sets the spot. */}
			<Handle type="source" position={Position.Bottom} id="open" className="port" isConnectable={false} />
			<Handle type="target" position={Position.Top} id="tc" className="port" isConnectable={false} />
			{!data.muted && (
				<div className="f-head">
					{seqIndex !== null && <span className="f-num">{seqIndex}</span>}
					<span className="f-ico">
						<kind.Icon size={12} />
					</span>
					{detail && <span className="f-detail">{detail}</span>}
				</div>
			)}
			{empty && mode === "edit" && data.onAddInto && (
				<button
					type="button"
					className="f-empty nodrag"
					onClick={(e) => {
						e.stopPropagation();
						data.onAddInto?.(data.nodeId);
					}}
				>
					<Plus size={13} /> Add a step
				</button>
			)}
			<Handle type="source" position={Position.Bottom} id="s" className="port" isConnectable={false} />
		</div>
	);
}
