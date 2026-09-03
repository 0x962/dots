import { describe, expect, it } from "bun:test";
import { CLAUDE, PI, defaultHarnessId, harness, isHarnessId } from "../src/core/harness";

function read(h: typeof PI, lines: string[]) {
	const r = h.reader();
	let tail = "";
	let ended = false;
	for (const l of lines) {
		const out = r.line(l);
		tail += out.tail;
		ended = ended || Boolean(out.ended);
	}
	return { tail, ended, ...r.result() };
}

const piLines = [
	'{"type":"session","version":3,"id":"01a06860-5b07-73cd-a2a6-d4f5bf0fe3b0","cwd":"/repo"}',
	'{"type":"agent_start"}',
	'{"type":"tool_execution_start","toolCallId":"t1","toolName":"read","args":{"path":"src/index.ts"}}',
	'{"type":"message_update","message":{"role":"assistant","content":[]},"assistantMessageEvent":{"type":"text_delta","delta":"He"}}',
	'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"first pass"}],"usage":{"cost":{"total":0.01}}}}',
	'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"OUTPUT: the finding"}],"usage":{"cost":{"total":0.02}}}}',
	'{"type":"agent_end","messages":[]}',
];

describe("the pi harness", () => {
	it("takes the session id from the first line", () => {
		expect(read(PI, piLines).sessionId).toBe("01a06860-5b07-73cd-a2a6-d4f5bf0fe3b0");
	});

	it("takes the last assistant message as the reply", () => {
		expect(read(PI, piLines).text).toBe("OUTPUT: the finding");
	});

	it("adds up the cost of every assistant message", () => {
		expect(read(PI, piLines).costUsd).toBeCloseTo(0.03, 6);
	});

	it("ends the turn on agent_end", () => {
		expect(read(PI, piLines).ended).toBe(true);
	});

	it("writes tool calls and assistant text to the tail", () => {
		const { tail } = read(PI, piLines);
		expect(tail).toContain("⏺ read");
		expect(tail).toContain("first pass");
		// A delta repeats text that message_end carries whole.
		expect(tail.match(/first pass/g)).toHaveLength(1);
	});

	it("keeps a plain line, which is how pi reports a refusal", () => {
		const out = read(PI, ["No API key found for vercel-ai-gateway."]);
		expect(out.tail).toContain("No API key found");
		expect(out.text).toContain("No API key found");
	});

	it("runs pi non-interactively, in json mode, on the named model", () => {
		const cmd = PI.command({
			sessionId: "ignored",
			sessionDir: "/runs/x.d/check.session",
			model: "vercel-ai-gateway/meta/muse-spark-1.1",
		});
		expect(cmd).toEqual([
			"pi",
			"-p",
			"--mode",
			"json",
			"--session-dir",
			"/runs/x.d/check.session",
			"--model",
			"vercel-ai-gateway/meta/muse-spark-1.1",
		]);
	});

	it("sets no CLAUDE_SESSION_ID, because pi names its own session", () => {
		expect(PI.env({ sessionId: "abc", sessionDir: "/d" })).toEqual({});
	});
});

describe("the claude harness", () => {
	const claudeLines = [
		'{"type":"system","session_id":"s-1"}',
		'{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file":"a"}},{"type":"text","text":"thinking out loud"}]}}',
		'{"type":"result","result":"OUTPUT: done","total_cost_usd":0.5}',
	];

	it("still reads its own stream-json", () => {
		const out = read(CLAUDE, claudeLines);
		expect(out.sessionId).toBe("s-1");
		expect(out.text).toBe("OUTPUT: done");
		expect(out.costUsd).toBe(0.5);
		expect(out.ended).toBe(true);
		expect(out.tail).toContain("⏺ Read");
	});

	it("takes a plain-text agent's whole output as the reply", () => {
		expect(read(CLAUDE, ["OUTPUT from check"]).text).toBe("OUTPUT from check\n");
	});

	it("takes its session id up front, so margin comments point back", () => {
		expect(CLAUDE.command({ sessionId: "s-2", sessionDir: "/d" })).toContain("s-2");
		expect(CLAUDE.env({ sessionId: "s-2", sessionDir: "/d" })).toEqual({ CLAUDE_SESSION_ID: "s-2" });
	});
});

describe("harness names", () => {
	it("knows the two it ships", () => {
		expect(isHarnessId("claude")).toBe(true);
		expect(isHarnessId("pi")).toBe(true);
		expect(isHarnessId("codex")).toBe(false);
		expect(harness("pi").label).toBe("Pi");
	});

	it("reads the default from DOTS_HARNESS", () => {
		const before = process.env.DOTS_HARNESS;
		process.env.DOTS_HARNESS = "pi";
		expect(defaultHarnessId()).toBe("pi");
		process.env.DOTS_HARNESS = "nonsense";
		expect(defaultHarnessId()).toBe("claude");
		if (before === undefined) delete process.env.DOTS_HARNESS;
		else process.env.DOTS_HARNESS = before;
	});
});
