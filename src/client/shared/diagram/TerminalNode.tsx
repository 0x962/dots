import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";

export interface TerminalData {
	kind: "start" | "end";
	mode: "edit" | "run";
	/** Run-board End marker: the run's overall state. */
	runWord?: string;
	runTone?: string;
	[key: string]: unknown;
}

/**
 * The Start and End markers that bracket the flow. Start doubles as the
 * shared context: clicking it edits the briefing every agent reads.
 */
export function TerminalNode(props: NodeProps) {
	const data = props.data as TerminalData;
	if (data.kind === "start") {
		return (
			<div className="n-term start" title="The shared context every agent reads · click to edit">
				<div className="term-word">Start</div>
				<div className="term-sub">shared context</div>
				<Handle type="source" position={Position.Bottom} id="s" className="port" isConnectable={false} />
			</div>
		);
	}
	return (
		<div className="n-term end" style={data.runTone ? ({ "--sc": data.runTone } as CSSProperties) : undefined}>
			<Handle type="target" position={Position.Top} id="t" className="port" isConnectable={false} />
			{data.runWord ? (
				<div className="term-word run">
					<span className="s-dot" />
					{data.runWord}
				</div>
			) : (
				<div className="term-word">End</div>
			)}
		</div>
	);
}
