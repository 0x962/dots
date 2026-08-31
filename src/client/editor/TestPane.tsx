import { Copy, FlaskConical, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { RunNode } from "../../core/types";
import { api, type NodeDetail } from "../shared/api";
import { nodeDurationMs } from "../shared/diagram/CardNode";
import { fmtDur } from "../shared/diagram/tokens";
import { STATUS } from "../shared/kinds";
import { Markdown } from "../shared/Markdown";
import { toast } from "../shared/toast";

const SETTLED = new Set(["ok", "failed", "skipped"]);

interface TestForm {
	target: string;
	input: string;
	cwd: string;
}

function rememberedForm(graph: string, nodeId: string): TestForm {
	const own = localStorage.getItem(`dots:test:${graph}:${nodeId}`);
	if (own) return JSON.parse(own) as TestForm;
	const lastRun = localStorage.getItem(`dots:last-run:${graph}`);
	const run = lastRun ? (JSON.parse(lastRun) as { target?: string; cwd?: string }) : {};
	return { target: run.target ?? "", input: "", cwd: run.cwd ?? "" };
}

function lastRunVars(graph: string): Record<string, string> {
	const raw = localStorage.getItem(`dots:last-run:${graph}`);
	if (!raw) return {};
	const rows = (JSON.parse(raw) as { vars?: Array<{ k: string; v: string }> }).vars ?? [];
	return Object.fromEntries(rows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v]));
}

/**
 * Runs the one node against a target, with the prompt text exactly as it
 * stands in the editor: unsaved edits are sent along and override the files
 * on disk for this test only.
 */
export function TestPane({
	graph,
	nodeId,
	instructions,
	briefing,
	onClose,
}: {
	graph: string;
	nodeId: string;
	instructions: string;
	briefing: string;
	onClose: () => void;
}) {
	const [form, setForm] = useState<TestForm>(() => rememberedForm(graph, nodeId));
	const [runId, setRunId] = useState<string | null>(null);
	const [node, setNode] = useState<RunNode | null>(null);
	const [detail, setDetail] = useState<NodeDetail | null>(null);
	const [showPrompt, setShowPrompt] = useState(false);
	const [, tick] = useState(0);
	const latest = useRef({ instructions, briefing });
	latest.current = { instructions, briefing };

	const running = !!runId && (!node || !SETTLED.has(node.status));
	const vars = lastRunVars(graph);

	const start = async () => {
		if (!form.target.trim() || running) return;
		localStorage.setItem(`dots:test:${graph}:${nodeId}`, JSON.stringify(form));
		setNode(null);
		setDetail(null);
		setShowPrompt(false);
		try {
			const { runId: id } = await api.testNode(graph, {
				nodeId,
				target: form.target.trim(),
				input: form.input,
				cwd: form.cwd.trim() || undefined,
				vars,
				instructions: latest.current.instructions,
				briefing: latest.current.briefing,
			});
			setRunId(id);
		} catch (error) {
			toast(error instanceof Error ? error.message : String(error), "error");
		}
	};

	useEffect(() => {
		if (!runId) return;
		let stop = false;
		const poll = async () => {
			const run = await api.run(graph, runId);
			if (stop) return;
			const n = run.nodes[0] ?? null;
			setNode(n);
			if (n && SETTLED.has(n.status)) {
				setDetail(await api.nodeDetail(graph, runId, nodeId));
				clearInterval(iv);
			}
		};
		const iv = setInterval(() => void poll(), 1200);
		void poll();
		return () => {
			stop = true;
			clearInterval(iv);
		};
	}, [graph, runId, nodeId]);

	useEffect(() => {
		if (!running) return;
		const iv = setInterval(() => tick((n) => n + 1), 1000);
		return () => clearInterval(iv);
	}, [running]);

	const status = node ? STATUS[node.status] : null;
	const dur = node ? nodeDurationMs(node) : null;

	return (
		<div className="tp" style={status ? ({ "--sc": status.color } as CSSProperties) : undefined}>
			<div className="tp-head">
				<FlaskConical size={13} />
				<span className="grow">Test this node</span>
				<button type="button" className="btn ghost icon sm" onClick={onClose}>
					<X size={13} />
				</button>
			</div>

			<div className="tp-form">
				<div className="field">
					<label>Target</label>
					<input
						className="input"
						placeholder="what the run is aimed at, e.g. a PR URL"
						value={form.target}
						onChange={(e) => setForm({ ...form, target: e.target.value })}
					/>
				</div>
				<div className="field">
					<label>Input</label>
					<textarea
						className="input"
						rows={3}
						placeholder="what the step before this node would pass along"
						value={form.input}
						onChange={(e) => setForm({ ...form, input: e.target.value })}
					/>
				</div>
				<div className="field">
					<label>Working directory</label>
					<input
						className="input mono"
						placeholder="where the agent runs · empty = the server's directory"
						value={form.cwd}
						onChange={(e) => setForm({ ...form, cwd: e.target.value })}
					/>
					{Object.keys(vars).length > 0 && (
						<span className="hint">uses the last run form's variables: {Object.keys(vars).join(", ")}</span>
					)}
				</div>
				<button
					type="button"
					className="btn primary"
					disabled={!form.target.trim() || running}
					onClick={() => void start()}
				>
					<FlaskConical size={13} />
					{running ? "Running…" : node ? "Run again" : "Run test"}
				</button>
				<span className="hint">runs the prompt as written here; nothing needs saving first</span>
			</div>

			{node && (
				<div className="tp-result">
					<div className="tp-status">
						{status && (
							<span className={`n-stat ${node.status}`}>
								<span className="s-dot" />
								{status.label}
							</span>
						)}
						<span className="grow" />
						{dur !== null && <span className="n-meta">{fmtDur(dur)}</span>}
						{node.sessionId && (
							<button
								type="button"
								className="btn ghost sm mono session-btn"
								title="Copy the claude session id · resume it with: dots debug"
								onClick={() => {
									void navigator.clipboard.writeText(node.sessionId!);
									toast("Session id copied");
								}}
							>
								<Copy size={11} /> {node.sessionId.slice(0, 8)}…
							</button>
						)}
					</div>
					{node.note && <div className="tp-note">{node.note}</div>}
					{detail && (
						<>
							<div className="tp-tabs seg">
								<button type="button" className={showPrompt ? "" : "on"} onClick={() => setShowPrompt(false)}>
									Reply
								</button>
								<button type="button" className={showPrompt ? "on" : ""} onClick={() => setShowPrompt(true)}>
									Prompt
								</button>
							</div>
							<div className="tp-body">
								{showPrompt ? (
									<pre className="tp-pre">{detail.prompt || "no prompt recorded"}</pre>
								) : detail.reply ? (
									<Markdown text={detail.reply} />
								) : (
									<div className="hint">no reply</div>
								)}
							</div>
						</>
					)}
				</div>
			)}
		</div>
	);
}
