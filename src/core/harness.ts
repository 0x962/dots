/**
 * A harness is the coding-agent CLI a node's agent runs in. dots spawns one
 * process per node, writes the node's prompt to its stdin, and reads its
 * stdout. Every CLI does that differently, so each one gets an entry here:
 * the command to spawn, how to read one line of its output, and how to open
 * a finished node's chat again.
 *
 * Two harnesses ship: `claude` (Claude Code) and `pi`
 * (@mariozechner/pi-coding-agent). Pi reaches many more models, because it
 * speaks to Vercel AI Gateway, OpenRouter, and the model providers directly.
 */

export type HarnessId = "claude" | "pi";

export const HARNESS_IDS: readonly HarnessId[] = ["claude", "pi"];

export function isHarnessId(v: unknown): v is HarnessId {
	return typeof v === "string" && (HARNESS_IDS as readonly string[]).includes(v);
}

/** Where one node's agent process runs and what it is called. */
export interface SpawnSpec {
	/** dots' own id for this node's agent. Claude takes it; pi makes its own. */
	sessionId: string;
	/** A directory this node's agent may keep its session files in. */
	sessionDir: string;
	/** The model, as the harness spells it. Unset means the harness default. */
	model?: string;
}

/** What one line of harness output added. */
export interface LineRead {
	/** Text for `<node>.stream.txt`, the readable tail the run view shows. */
	tail: string;
	/** True on the line that ends the turn: the whole reply is now in. */
	ended?: boolean;
}

/**
 * Reads one node's stdout, line by line, and holds what it learned. One
 * reader serves one spawned process.
 */
export interface OutputReader {
	line(raw: string): LineRead;
	/** What the process reported, read after its stdout closes. */
	result(): { text?: string; sessionId?: string; costUsd?: number };
}

export interface Harness {
	id: HarnessId;
	label: string;
	/** The command that runs one node. The prompt arrives on stdin. */
	command(spec: SpawnSpec): string[];
	/**
	 * True when the CLI keeps reading stdin while it works, so a time-budget
	 * notice can reach an agent that is already running.
	 */
	acceptsFollowUps: boolean;
	/** One stdin line that delivers `text` to a running agent. */
	followUp(text: string): string;
	/** Environment variables the agent process gets on top of dots' own. */
	env(spec: SpawnSpec): Record<string, string>;
	reader(): OutputReader;
	/** Opens a finished node's chat in the terminal. */
	resume(spec: { sessionId: string; sessionDir: string }): string[];
	/** Asks a finished node's agent one question; the answer is plain stdout. */
	ask(spec: { sessionId: string; sessionDir: string }): string[];
}

function truncate(input: unknown): string {
	const s = JSON.stringify(input) ?? "";
	return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

/* ------------------------------------------------------------------ claude */

interface ClaudeEvent {
	type?: string;
	session_id?: string;
	result?: string;
	total_cost_usd?: number;
	message?: {
		content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
	};
}

function claudeReader(): OutputReader {
	const found: { text?: string; sessionId?: string; costUsd?: number } = {};
	let plain = "";
	return {
		line(raw: string): LineRead {
			const trimmed = raw.trim();
			if (!trimmed) return { tail: "" };
			let ev: ClaudeEvent | undefined;
			try {
				ev = JSON.parse(trimmed) as ClaudeEvent;
			} catch {
				// A claude build that prints plain text, or a stub agent.
				plain += `${raw}\n`;
				return { tail: `${raw}\n` };
			}
			if (!ev || typeof ev.type !== "string") {
				plain += `${raw}\n`;
				return { tail: `${raw}\n` };
			}
			if (ev.session_id) found.sessionId = ev.session_id;
			if (ev.type === "assistant") {
				let out = "";
				for (const block of ev.message?.content ?? []) {
					if (block.type === "text" && block.text) out += `${block.text}\n`;
					else if (block.type === "tool_use") out += `⏺ ${block.name} ${truncate(block.input)}\n`;
				}
				return { tail: out };
			}
			if (ev.type === "result") {
				if (typeof ev.result === "string") found.text = ev.result;
				if (typeof ev.total_cost_usd === "number") found.costUsd = ev.total_cost_usd;
				return { tail: "", ended: true };
			}
			// system, user, and tool-result events are noise for the tail.
			return { tail: "" };
		},
		result() {
			return { ...found, text: found.text ?? (plain || undefined) };
		},
	};
}

export const CLAUDE: Harness = {
	id: "claude",
	label: "Claude Code",
	// stream-json out emits one JSON line per event as the agent works, which
	// is what lets the run view tail a node while it is still thinking.
	// stream-json in keeps stdin open, so time-budget notices can reach a
	// running agent as follow-up user messages.
	command: ({ sessionId, model }) => [
		"claude",
		"-p",
		"--dangerously-skip-permissions",
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--verbose",
		"--session-id",
		sessionId,
		...(model ? ["--model", model] : []),
	],
	acceptsFollowUps: true,
	followUp: (text) =>
		`${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } })}\n`,
	// A margin comment points back to the session that wrote it. Claude takes
	// its session id up front, and the same id goes into the environment, so
	// the margin CLI's $CLAUDE_SESSION_ID default fills the pointer without
	// the agent doing anything.
	env: ({ sessionId }) => ({ CLAUDE_SESSION_ID: sessionId }),
	reader: claudeReader,
	resume: ({ sessionId }) => ["claude", "--resume", sessionId],
	ask: ({ sessionId }) => ["claude", "-p", "--output-format", "text", "--resume", sessionId],
};

/* ---------------------------------------------------------------------- pi */

interface PiUsage {
	cost?: { total?: number };
}

interface PiMessage {
	role?: string;
	content?: Array<{ type: string; text?: string; name?: string; arguments?: unknown }>;
	usage?: PiUsage;
}

interface PiEvent {
	type?: string;
	id?: string;
	message?: PiMessage;
	toolName?: string;
	args?: unknown;
}

function piAssistantText(message: PiMessage): string {
	let out = "";
	for (const block of message.content ?? []) {
		if (block.type === "text" && block.text) out += `${block.text}\n`;
	}
	return out;
}

function piReader(): OutputReader {
	const found: { text?: string; sessionId?: string; costUsd?: number } = {};
	let cost = 0;
	let sawCost = false;
	let plain = "";
	return {
		line(raw: string): LineRead {
			const trimmed = raw.trim();
			if (!trimmed) return { tail: "" };
			let ev: PiEvent | undefined;
			try {
				ev = JSON.parse(trimmed) as PiEvent;
			} catch {
				// pi writes its startup warnings and its "no API key" refusal as
				// plain lines. Keep them; they are the whole story when it fails.
				plain += `${raw}\n`;
				return { tail: `${raw}\n` };
			}
			if (!ev || typeof ev.type !== "string") {
				plain += `${raw}\n`;
				return { tail: `${raw}\n` };
			}
			// The first line of a pi run names the session it just opened.
			if (ev.type === "session" && typeof ev.id === "string") {
				found.sessionId = ev.id;
				return { tail: "" };
			}
			if (ev.type === "tool_execution_start") {
				return { tail: `⏺ ${ev.toolName ?? "tool"} ${truncate(ev.args)}\n` };
			}
			if (ev.type === "message_end" && ev.message?.role === "assistant") {
				const text = piAssistantText(ev.message);
				// The reply is the last thing the assistant said, the same as
				// claude's `result` event.
				if (text.trim()) found.text = text.trim();
				const total = ev.message.usage?.cost?.total;
				if (typeof total === "number") {
					cost += total;
					sawCost = true;
				}
				return { tail: text };
			}
			if (ev.type === "agent_end") return { tail: "", ended: true };
			// turn, message_start, message_update, and queue events are noise
			// for the tail: message_end already carries the whole message.
			return { tail: "" };
		},
		result() {
			return {
				text: found.text ?? (plain || undefined),
				sessionId: found.sessionId,
				costUsd: sawCost ? cost : undefined,
			};
		},
	};
}

export const PI: Harness = {
	id: "pi",
	label: "Pi",
	// -p runs once and exits, and pi merges piped stdin into the prompt.
	// --mode json emits one session event per line, which is what the run
	// view tails. Each node keeps its session under the run folder, so
	// `dots debug` finds it however many runs later.
	command: ({ sessionDir, model }) => [
		"pi",
		"-p",
		"--mode",
		"json",
		"--session-dir",
		sessionDir,
		...(model ? ["--model", model] : []),
	],
	// pi -p reads the prompt and closes stdin, so nothing can reach it after
	// it starts. A node under a time budget still gets killed on expiry; it
	// just gets no warning first.
	acceptsFollowUps: false,
	followUp: (text) => `${text}\n`,
	// pi picks its own session id and reports it on its first line, so there
	// is no id to hand the margin CLI up front. A pi node's margin comments
	// carry no session pointer; the run file records the id instead.
	env: () => ({}),
	reader: piReader,
	resume: ({ sessionId, sessionDir }) => ["pi", "--session-dir", sessionDir, "--session", sessionId],
	ask: ({ sessionId, sessionDir }) => [
		"pi",
		"-p",
		"--session-dir",
		sessionDir,
		"--session",
		sessionId,
	],
};

const BY_ID: Record<HarnessId, Harness> = { claude: CLAUDE, pi: PI };

export function harness(id: HarnessId): Harness {
	return BY_ID[id];
}

/**
 * The harness a run uses when neither the node nor the graph names one.
 * DOTS_HARNESS overrides the built-in default of claude.
 */
export function defaultHarnessId(): HarnessId {
	const fromEnv = process.env.DOTS_HARNESS;
	return isHarnessId(fromEnv) ? fromEnv : "claude";
}
