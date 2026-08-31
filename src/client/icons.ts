import {
	Bot,
	Columns2,
	Diamond,
	Repeat2,
	Rows3,
	Timer,
	User,
} from "lucide-static";
import type { NodeKind } from "../core/types";

/** Lucide SVG per kind; colored by the kind classes in the stylesheet. */
export const KIND_ICON: Record<NodeKind, string> = {
	agent: Bot,
	gate: Diamond,
	parallel: Columns2,
	sequence: Rows3,
	budget: Timer,
	loop: Repeat2,
	human: User,
};
