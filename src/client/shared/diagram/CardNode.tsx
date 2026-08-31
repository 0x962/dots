import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Check, Minus, UserRound, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { RunNode } from "../../../core/types";
import { CoreEcho } from "../CoreEcho";
import { KIND, STATUS } from "../kinds";
import type { DiagramMeta } from "../layout";
import { fmtDur } from "./tokens";

export interface CardData {
	nodeId: string;
	meta: DiagramMeta;
	mode: "edit" | "run";
	isRoot: boolean;
	seqIndex: number | null;
	run?: RunNode;
	onAnswer?: (id: string, approve: boolean) => void;
	[key: string]: unknown;
}

export function nodeDurationMs(run: RunNode): number | null {
	if (!run.startedAt) return null;
	const end = run.finishedAt ? Date.parse(run.finishedAt) : Date.now();
	return end - Date.parse(run.startedAt);
}

/** What the card's one circle shows: the kind at rest, the state in a run. */
function circleFor(meta: DiagramMeta, run: RunNode | undefined): { icon: ReactNode; color: string; pulse?: boolean; faint?: boolean } {
	const kind = KIND[meta.kind];
	if (!run || run.status === "pending") {
		return { icon: <kind.Icon size={13} />, color: kind.color, faint: !!run };
	}
	switch (run.status) {
		case "running":
			return { icon: <CoreEcho size={12} />, color: "var(--s-running)" };
		case "waiting":
			return { icon: <UserRound size={13} />, color: "var(--s-waiting)", pulse: true };
		case "failed":
			return { icon: <X size={13} />, color: "var(--s-failed)" };
		case "skipped":
			return { icon: <Minus size={13} />, color: "var(--s-skipped)" };
		default:
			return { icon: <Check size={13} />, color: "var(--s-ok)" };
	}
}

export function CardNode(props: NodeProps) {
	const data = props.data as CardData;
	const { meta, mode, run, seqIndex } = data;
	const status = run ? STATUS[run.status] : null;
	const style = { "--kc": KIND[meta.kind].color } as CSSProperties;
	const dur = run ? nodeDurationMs(run) : null;
	const waitingHuman = mode === "run" && meta.kind === "human" && run?.status === "waiting";
	const circle = circleFor(meta, mode === "run" ? run : undefined);
	const tooltip = [
		`${meta.title} · ${KIND[meta.kind].label}`,
		status?.label,
		run?.note,
		dur !== null && dur !== undefined ? fmtDur(dur) : null,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<div className={`n-card ${run ? `st-${run.status}` : ""}`} style={style} title={tooltip}>
			<Handle type="target" position={Position.Top} id="t" className="port" isConnectable={false} />
			<div className="n-top">
				{seqIndex !== null && <span className="n-num">{seqIndex}</span>}
				<div className="n-title">{meta.title}</div>
				<span
					className={`n-circle ${circle.pulse ? "pulsing" : ""} ${circle.faint ? "faint" : ""}`}
					style={{ color: circle.color }}
				>
					{circle.icon}
				</span>
			</div>
			{waitingHuman && data.onAnswer && (
				<div className="n-approve nodrag">
					<button
						type="button"
						className="yes"
						onClick={(e) => {
							e.stopPropagation();
							data.onAnswer?.(data.nodeId, true);
						}}
					>
						Approve
					</button>
					<button
						type="button"
						className="no"
						onClick={(e) => {
							e.stopPropagation();
							data.onAnswer?.(data.nodeId, false);
						}}
					>
						Request changes
					</button>
				</div>
			)}
			<Handle type="source" position={Position.Bottom} id="s" className="port" isConnectable={false} />
		</div>
	);
}
