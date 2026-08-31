import {
	Bot,
	GitFork,
	Repeat2,
	ListOrdered,
	Columns3,
	Timer,
	UserRound,
	type LucideIcon,
} from "lucide-react";
import type { NodeKind, RunNodeStatus } from "../../core/types";

export interface KindMeta {
	label: string;
	lede: string;
	/** CSS variable that holds this kind's hue. */
	color: string;
	Icon: LucideIcon;
	/** How a container lays its children out on the canvas. */
	flow: "leaf" | "column" | "row";
}

export const KIND: Record<NodeKind, KindMeta> = {
	agent: {
		label: "Agent",
		lede: "Does work: runs once and returns an output for the next node.",
		color: "var(--k-agent)",
		Icon: Bot,
		flow: "leaf",
	},
	gate: {
		label: "Gate",
		lede: "An if/else on the line: the agent answers YES or NO and the flow takes that branch. An empty branch is a skip.",
		color: "var(--k-gate)",
		Icon: GitFork,
		flow: "leaf",
	},
	parallel: {
		label: "Parallel",
		lede: "Starts every node inside at the same time. One failure never stops the others.",
		color: "var(--k-parallel)",
		Icon: Columns3,
		flow: "row",
	},
	sequence: {
		label: "Sequence",
		lede: "Runs the nodes inside in order, passing each output to the next. A failure halts the rest.",
		color: "var(--k-sequence)",
		Icon: ListOrdered,
		flow: "column",
	},
	budget: {
		label: "Budget",
		lede: "A time box: when the minutes run out, everything unfinished inside fails.",
		color: "var(--k-budget)",
		Icon: Timer,
		flow: "row",
	},
	loop: {
		label: "Loop",
		lede: "Runs the nodes inside as a round, then asks its exit question: DONE moves on, AGAIN repeats.",
		color: "var(--k-loop)",
		Icon: Repeat2,
		flow: "column",
	},
	human: {
		label: "Human",
		lede: "Parks until a person answers on the run board. The rest of the graph keeps going.",
		color: "var(--k-human)",
		Icon: UserRound,
		flow: "leaf",
	},
};

export const KIND_ORDER: NodeKind[] = [
	"agent",
	"gate",
	"parallel",
	"sequence",
	"budget",
	"loop",
	"human",
];

export interface StatusMeta {
	label: string;
	color: string;
}

export const STATUS: Record<RunNodeStatus, StatusMeta> = {
	pending: { label: "Pending", color: "var(--s-pending)" },
	running: { label: "Running", color: "var(--s-running)" },
	ok: { label: "Done", color: "var(--s-ok)" },
	failed: { label: "Failed", color: "var(--s-failed)" },
	skipped: { label: "Skipped", color: "var(--s-skipped)" },
	waiting: { label: "Needs you", color: "var(--s-waiting)" },
};
