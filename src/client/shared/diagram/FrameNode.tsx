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
	run?: RunNode;
	/** Settled descendants over all descendants, run mode. */
	progress?: { done: number; total: number };
	onAddInto?: (id: string) => void;
	[key: string]: unknown;
}

/**
 * A container is not a box: an opening bracket line above its children and
 * a closing line below. The circled kind icon sits on the opening line only.
 * Clicking anywhere on the section selects it.
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

	/** One short string under the badge; two would collide between rails. */
	const config =
		meta.kind === "budget"
			? `${meta.minutes ?? "?"}m`
			: meta.kind === "loop"
				? mode === "run" && run?.round
					? `${run.round}/${meta.maxRounds ?? "?"}`
					: `×${meta.maxRounds ?? "?"}`
				: null;
	const detail =
		mode === "run" && progress && progress.total > 0 && meta.kind !== "budget" && meta.kind !== "loop"
			? `${progress.done}/${progress.total}`
			: config;

	return (
		<div
			className={`n-rail ${run ? `st-${run.status}` : ""}`}
			style={style}
			title={`${meta.title} · ${kind.label}${status ? ` · ${status.label}` : ""}`}
		>
			{seqIndex !== null && <div className="seq-n">{seqIndex}</div>}
			<Handle type="target" position={Position.Top} id="t" className="port" isConnectable={false} />
			{/* "open" sits on the opening line but its edges leave downward, into
			    the children; "tc" sits on the closing line and its edges arrive
			    from above. Position sets the edge direction, CSS sets the spot. */}
			<Handle type="source" position={Position.Bottom} id="open" className="port" isConnectable={false} />
			<Handle type="target" position={Position.Top} id="tc" className="port" isConnectable={false} />
			<div className="rail-line" />
			<div className="rail-line closing" />
			<div className="rail-badge">
				<kind.Icon size={14} />
			</div>
			{detail && <div className="rail-detail">{detail}</div>}
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
