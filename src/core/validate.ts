import type { GraphBundle, GraphNode } from "./types";
import { allChildren, carriesInstructions, isContainer } from "./types";

const ID_SHAPE = /^[a-z0-9][a-z0-9-]*$/;
const KINDS = ["agent", "gate", "parallel", "sequence", "budget", "loop", "human"];

/**
 * Checks a bundle before it is written to disk. It comes from the editor or
 * from hand-edited files, so every field is a person's input. Returns one
 * message per problem; an empty list means the graph is safe to save and to
 * run. Nodes unreachable from the root are reported, not deleted: the
 * editor keeps them on the canvas as work in progress.
 */
export function validateGraph(bundle: GraphBundle): string[] {
	const errors: string[] = [];
	const { doc } = bundle;
	if (!doc.nodes || typeof doc.nodes !== "object") {
		return ["graph.json needs a nodes map."];
	}
	if (!doc.root || !doc.nodes[doc.root]) {
		errors.push(`The root "${doc.root}" is not in the nodes map.`);
	}
	for (const [id, node] of Object.entries(doc.nodes)) {
		const where = node.title || id;
		if (!ID_SHAPE.test(id)) {
			errors.push(`${where}: the id "${id}" must be lowercase-with-dashes.`);
		}
		if (!KINDS.includes(node.kind)) {
			errors.push(`${where}: unknown kind "${node.kind}".`);
			continue;
		}
		if (!node.title?.trim()) errors.push(`${id}: the title is empty.`);
		if (!Array.isArray(node.children)) {
			errors.push(`${where}: children must be a list.`);
			continue;
		}
		for (const child of allChildren(node)) {
			if (!doc.nodes[child]) {
				errors.push(`${where}: the child "${child}" is not in the nodes map.`);
			}
		}
		if (!isContainer(node.kind) && node.children.length > 0) {
			errors.push(`${where}: a ${node.kind} runs no children.`);
		}
		if (node.elseChildren && node.kind !== "gate") {
			errors.push(`${where}: only a gate has a NO branch.`);
		}
		if (isContainer(node.kind) && node.kind !== "gate" && node.children.length === 0) {
			errors.push(`${where}: a ${node.kind} needs at least one child.`);
		}
		if (node.kind === "gate" && allChildren(node).length === 0) {
			errors.push(`${where}: a gate needs at least one node on YES or NO.`);
		}
		if (node.kind === "budget" && !((node.minutes ?? 0) > 0)) {
			errors.push(`${where}: the budget needs minutes above zero.`);
		}
		if (node.kind === "loop" && !((node.maxRounds ?? 0) > 0)) {
			errors.push(`${where}: the loop needs maxRounds above zero.`);
		}
		if (carriesInstructions(node.kind) && !bundle.instructions[id]?.trim()) {
			errors.push(
				`${where}: nodes/${id}.md is missing or empty. ${node.kind === "loop" ? "A loop needs its exit question there." : "It holds this node's instructions."}`,
			);
		}
	}
	// One parent per node, and no cycles: walk from the root, each node once.
	const parents = new Map<string, string>();
	for (const [id, node] of Object.entries(doc.nodes)) {
		for (const child of allChildren(node)) {
			if (parents.has(child)) {
				errors.push(
					`"${child}" has two parents: ${parents.get(child)} and ${id}. A node runs under one parent.`,
				);
			}
			parents.set(child, id);
		}
	}
	if (doc.root && doc.nodes[doc.root]) {
		const seen = new Set<string>();
		const walk = (id: string, trail: string[]): void => {
			if (trail.includes(id)) {
				errors.push(`Cycle: ${[...trail, id].join(" → ")}.`);
				return;
			}
			if (seen.has(id)) return;
			seen.add(id);
			const node = doc.nodes[id];
			if (!node) return;
			for (const child of allChildren(node)) {
				if (doc.nodes[child]) walk(child, [...trail, id]);
			}
		};
		walk(doc.root, []);
	}
	return errors;
}

/** Children of a node that exist, for walkers that trust a validated doc. */
export function childNodes(
	doc: GraphBundle["doc"],
	id: string,
): Array<[string, GraphNode]> {
	return (doc.nodes[id]?.children ?? [])
		.filter((child) => doc.nodes[child])
		.map((child) => [child, doc.nodes[child]] as [string, GraphNode]);
}
