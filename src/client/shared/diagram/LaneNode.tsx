import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import type { CSSProperties } from "react";

export interface LaneData {
	laneId: string;
	gateId: string;
	tone: "yes" | "no";
	empty: boolean;
	mode: "edit" | "run";
	/** The gate ran and took the other branch. */
	notTaken?: boolean;
	onAddInto?: (target: string) => void;
	[key: string]: unknown;
}

/**
 * One branch of a gate: a small YES or NO pill that the gate's branch arrow
 * lands on, with the branch's nodes below. An empty branch means the flow
 * passes straight through, drawn as a "skip" capsule; in the editor that
 * capsule takes a click or a drop to start the branch.
 */
export function LaneNode(props: NodeProps) {
	const data = props.data as LaneData;
	const tone = data.tone;
	const style = {
		"--lc": tone === "yes" ? "var(--flow)" : "var(--flow-no)",
	} as CSSProperties;

	return (
		<div className={`n-lane ${data.notTaken ? "not-taken" : ""}`} style={style}>
			<Handle type="target" position={Position.Top} id="t" className="port" isConnectable={false} />
			{/* On the pill; its edges leave downward into the branch. */}
			<Handle type="source" position={Position.Bottom} id="open" className="port" isConnectable={false} />
			<div className="lane-chip">{tone.toUpperCase()}</div>
			{data.empty &&
				(data.mode === "edit" && data.onAddInto ? (
					<button
						type="button"
						className="lane-skip nodrag"
						title={`Add a step to the ${tone.toUpperCase()} branch`}
						onClick={(e) => {
							e.stopPropagation();
							data.onAddInto?.(data.laneId);
						}}
					>
						<Plus size={11} className="lane-add" /> skip
					</button>
				) : (
					<div className="lane-skip quiet">skip</div>
				))}
			<Handle type="source" position={Position.Bottom} id="s" className="port" isConnectable={false} />
		</div>
	);
}
