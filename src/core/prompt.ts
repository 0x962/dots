import type { GraphBundle, GraphNode, NodeKind } from "./types";

/** `{TARGET}` and every `--var KEY=VAL` fill in; unknown braces stay. */
export function substitute(text: string, vars: Record<string, string>): string {
	return text.replace(/\{([A-Z_]+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

const RETURN_CONTRACT: Partial<Record<NodeKind, string>> = {
	gate: `You are a gate. End your reply with one line, exactly one of:
YES: <what the nodes behind this gate should focus on>
NO: <why this area is not touched by the change>`,
	loop: `You are a loop's exit check. End your reply with one line, exactly one of:
DONE: <why nothing is left>
AGAIN: <what is left to do>`,
};

const AGENT_CONTRACT = `End your reply with your result:
- If your instructions' "Runs when" misses, one line: SKIP: <the file or fact that decides it>.
- Otherwise your OUTPUT (what later nodes should read), plus any FINDING blocks in the briefing's format.`;

/** The whole prompt one node's agent receives. */
export function composePrompt(args: {
	bundle: GraphBundle;
	id: string;
	node: GraphNode;
	input: string;
	target: string;
	vars: Record<string, string>;
	/** Shell command prefix for questioning an earlier node's agent. */
	askCommand?: string;
}): string {
	const { bundle, id, node, input, target, vars, askCommand } = args;
	const all = { TARGET: target, ...vars };
	const contract = RETURN_CONTRACT[node.kind] ?? AGENT_CONTRACT;
	const ask = askCommand
		? `\nEvery earlier node's agent is still reachable. To ask one a question (why it decided something, what exactly it saw), run:\n  ${askCommand} <node-id> "<your question>"\nIt answers from that agent's own session. Ask instead of guessing about earlier work.`
		: "";
	return [
		substitute(bundle.briefing, all).trim(),
		"---",
		`You are one node of this run: "${node.title}" (id: ${id}).`,
		`Target: ${target}`,
		"",
		"Input from the step before you:",
		input.trim() || "(none)",
		"",
		"Your instructions:",
		substitute(bundle.instructions[id] ?? "", all).trim() + ask,
		"---",
		contract,
	].join("\n");
}

export interface ParsedReply {
	/** The final verdict line for gates and loop checks, lower-cased keyword. */
	verdict: "yes" | "no" | "done" | "again" | null;
	skipped: boolean;
	findings: number;
	/** The reply with nothing stripped; later nodes read it whole. */
	output: string;
	/** The text after the verdict/skip keyword, for the board's note. */
	note: string;
}

/** Reads an agent's stdout against the return contract. */
export function parseReply(stdout: string): ParsedReply {
	const output = stdout.trim();
	const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
	const last = lines[lines.length - 1] ?? "";
	const verdictMatch = /^(YES|NO|DONE|AGAIN)\s*[:.]?\s*(.*)$/i.exec(last);
	const skipMatch = output.match(/^SKIP\s*:\s*(.*)$/im);
	const findings = (output.match(/^FINDING$/gm) ?? []).length;
	return {
		verdict: verdictMatch
			? (verdictMatch[1].toLowerCase() as ParsedReply["verdict"])
			: null,
		skipped: !!skipMatch && findings === 0,
		findings,
		output,
		note: verdictMatch?.[2] || skipMatch?.[1] || "",
	};
}
