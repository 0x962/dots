/**
 * A graph is a tree of nodes that an agent lead executes against a target
 * (a pull request, a codebase, any job). Four controllers shape the run and
 * three kinds do the touching:
 *
 * - `agent` does work: it runs once, read-only, and returns an output plus
 *   zero or more findings.
 * - `gate` is an agent whose whole contract is a verdict. YES runs its
 *   subtree and the focus text feeds the children; NO marks the subtree
 *   skipped with the reason.
 * - `parallel` starts every child at the same time. A child's failure never
 *   stops its siblings.
 * - `sequence` runs children in order and passes each output to the next. A
 *   failed child halts the rest of the sequence.
 * - `budget` is a time box: when the minutes run out, the scheduler stops
 *   waiting and everything unfinished inside is marked failed.
 * - `loop` runs its children (in order) as one round, then asks its exit
 *   question; AGAIN starts the next round, DONE moves on, and the round
 *   count never passes `maxRounds`.
 * - `human` parks: the run records what it needs from a person and waits
 *   for an answer from the run view.
 *
 * On disk a graph is one folder: `graph.json` (this structure plus canvas
 * positions), `briefing.md`, and `nodes/<id>.md` for every node that
 * carries text: instructions for agent, gate, and human nodes, the exit
 * question for loop nodes.
 */
export type NodeKind =
	| "agent"
	| "gate"
	| "parallel"
	| "sequence"
	| "budget"
	| "loop"
	| "human";

/** What the lead may do with an agent node's findings. */
export type NodeAction = "fix" | "fix-when-certain" | "report";

export interface GraphNode {
	kind: NodeKind;
	title: string;
	/** Child node ids, in run order. Only containers carry children. */
	children: string[];
	action?: NodeAction;
	/** The edits the lead must never make from this node's findings. */
	fixBoundary?: string;
	/** budget: the time box in minutes. */
	minutes?: number;
	/** loop: the round cap. */
	maxRounds?: number;
	/** Canvas position, editor-owned. */
	x?: number;
	y?: number;
}

export interface GraphDoc {
	version: 1;
	/** Display name; the folder name is the identity. */
	name: string;
	/** Id of the root node. */
	root: string;
	nodes: Record<string, GraphNode>;
}

/** A graph folder in memory: the structure plus every markdown file. */
export interface GraphBundle {
	doc: GraphDoc;
	briefing: string;
	/** nodes/<id>.md contents, keyed by node id. */
	instructions: Record<string, string>;
}

/** The kinds whose folder carries a nodes/<id>.md file. */
export function carriesInstructions(kind: NodeKind): boolean {
	return (
		kind === "agent" || kind === "gate" || kind === "human" || kind === "loop"
	);
}

export function isContainer(kind: NodeKind): boolean {
	return kind !== "agent" && kind !== "human";
}

export type RunNodeStatus =
	| "pending"
	| "running"
	| "ok"
	| "items"
	| "failed"
	| "skipped"
	| "waiting";

export type RunStatus = "running" | "waiting" | "done" | "failed";

/** One node of one run: the graph node plus what happened to it. */
export interface RunNode {
	id: string;
	parentId: string | null;
	kind: NodeKind;
	title: string;
	status: RunNodeStatus;
	/** Findings returned. */
	count?: number;
	/** Findings the lead applied. */
	fixed?: number;
	/** One line for the board: a gate's verdict, a skip reason, an ask. */
	note?: string;
	/** The node's returned output; feeds later nodes and resumes. */
	output?: string;
	/** loop: the round in progress or finished. */
	round?: number;
	startedAt?: string;
	finishedAt?: string;
	/** The agent session behind this node; `dots debug` resumes it. */
	sessionId?: string;
	costUsd?: number;
}

/** One run of one graph, stored at `<graph folder>/runs/<runId>.json`. */
export interface GraphRun {
	/** Sortable, newest last: `run-<timestamp>`. */
	runId: string;
	graphName: string;
	/** What the run was aimed at, e.g. a pull request URL. */
	target: string;
	startedAt: string;
	finishedAt: string | null;
	status: RunStatus;
	note?: string;
	/** Where the run's agents execute, so a resume lands in the same place. */
	cwd?: string;
	vars?: Record<string, string>;
	nodes: RunNode[];
}
