/**
 * A graph is a tree of nodes that an agent lead executes against a target
 * (a pull request, a codebase, any job). Four controllers shape the run and
 * three kinds do the touching:
 *
 * - `agent` does work: it runs once and returns an output for the next
 *   node. Anything it reports (review comments, say) it delivers itself.
 * - `gate` is an if/else. Its agent answers YES or NO; YES runs `children`,
 *   NO runs `elseChildren`, and the branch not taken is marked skipped. An
 *   empty branch is a plain skip.
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
import type { HarnessId } from "./harness";

export type NodeKind =
	| "agent"
	| "gate"
	| "parallel"
	| "sequence"
	| "budget"
	| "loop"
	| "human";

export interface GraphNode {
	kind: NodeKind;
	title: string;
	/** Child node ids, in run order. For a gate, the YES branch. */
	children: string[];
	/** gate: the NO branch, run when the gate answers NO. */
	elseChildren?: string[];
	/**
	 * The coding-agent CLI this node's agent runs in; unset takes the graph's
	 * choice, then the run's.
	 */
	harness?: HarnessId;
	/**
	 * The model this node's agent runs on, spelled the way its harness spells
	 * it: a claude alias or id for claude, `provider/model-id` for pi. Unset
	 * means the harness picks.
	 */
	model?: string;
	/**
	 * How hard this node's model thinks before it answers. The levels differ
	 * by harness, so a value here only means anything next to `harness`:
	 * claude takes low through max, pi takes off through xhigh. Unset leaves
	 * the CLI's own default.
	 */
	effort?: string;
	/** budget: the time box in minutes. */
	minutes?: number;
	/** loop: the round cap. */
	maxRounds?: number;
	/** Canvas position, editor-owned. */
	x?: number;
	y?: number;
}

/** Both branches of a node, in run order. Non-gates have only `children`. */
export function allChildren(node: GraphNode): string[] {
	return node.elseChildren ? [...node.children, ...node.elseChildren] : node.children;
}

export interface GraphDoc {
	version: 1;
	/** Display name; the folder name is the identity. */
	name: string;
	/** Id of the root node. */
	root: string;
	/** The harness every node of this graph runs in, unless it names its own. */
	harness?: HarnessId;
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
	/** Set when the parent is a gate and this node sits on its NO branch. */
	branch?: "no";
	status: RunNodeStatus;
	/** One line for the board: a gate's verdict, a skip reason, an ask. */
	note?: string;
	/** The node's returned output; feeds later nodes and resumes. */
	output?: string;
	/** loop: the round in progress or finished. */
	round?: number;
	startedAt?: string;
	finishedAt?: string;
	/** The harness this node ran in; `dots debug` and `dots ask` need it. */
	harness?: HarnessId;
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
