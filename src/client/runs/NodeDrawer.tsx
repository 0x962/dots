import { Check, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { RunNode } from "../../core/types";
import { api, type NodeDetail } from "../shared/api";
import { fmtDur } from "../shared/diagram/tokens";
import { nodeDurationMs } from "../shared/diagram/CardNode";
import { KIND, STATUS } from "../shared/kinds";
import { Markdown } from "../shared/Markdown";
import { toast } from "../shared/toast";

type Tab = "work" | "reply" | "prompt" | "input";

export function NodeDrawer({
	graph,
	runId,
	node,
	live,
	onClose,
	onAnswer,
}: {
	graph: string;
	runId: string;
	node: RunNode;
	/** A runner is currently executing this run. */
	live: boolean;
	onClose: () => void;
	onAnswer: (id: string, approve: boolean, note: string) => Promise<void>;
}) {
	const [detail, setDetail] = useState<NodeDetail | null>(null);
	const running = node.status === "running";
	const [tab, setTab] = useState<Tab>(running ? "work" : "reply");
	const [note, setNote] = useState("");
	const kind = KIND[node.kind];
	const status = STATUS[node.status];
	const dur = nodeDurationMs(node);
	const bodyRef = useRef<HTMLDivElement>(null);
	// Containers and human nodes run no agent: no prompt, no reply to show.
	const hasTranscript = ["agent", "gate", "loop"].includes(node.kind);

	useEffect(() => {
		if (!hasTranscript) return;
		setDetail(null);
		void api.nodeDetail(graph, runId, node.id).then(setDetail);
		// A running node's stream grows: keep tailing it.
		if (node.status !== "running") return;
		const iv = setInterval(
			() => void api.nodeDetail(graph, runId, node.id).then(setDetail),
			1500,
		);
		return () => clearInterval(iv);
	}, [graph, runId, node.id, node.status, node.finishedAt]);

	// The moment the node settles, hand over from the work tail to the reply;
	// the Work tab stays available for reading the transcript back.
	useEffect(() => {
		if (!running && tab === "work") setTab("reply");
		if (running && tab === "reply") setTab("work");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [running]);

	useEffect(() => {
		const el = bodyRef.current;
		if (el && tab === "work" && running) el.scrollTop = el.scrollHeight;
	}, [detail?.stream, tab, running]);

	const body =
		tab === "work"
			? detail?.stream
			: tab === "reply"
				? detail?.reply
				: tab === "prompt"
					? detail?.prompt
					: detail?.input;

	return (
		<aside className="drawer" style={{ "--kc": kind.color, "--sc": status.color } as CSSProperties}>
			<div className="dr-head">
				<span className="dr-ico">
					<kind.Icon size={15} />
				</span>
				<div className="dr-title grow">{node.title}</div>
				{!live && hasTranscript && node.status !== "pending" && (
					<button
						type="button"
						className="btn ghost icon sm"
						title="Run this one node again, with its recorded input and the graph's current instructions"
						onClick={() => {
							void api
								.retryRunNode(graph, runId, node.id)
								.then(() => toast("Node re-running"))
								.catch((error: unknown) =>
									toast(error instanceof Error ? error.message : String(error), "error"),
								);
						}}
					>
						<RotateCcw size={13} />
					</button>
				)}
				<button type="button" className="btn ghost icon sm" onClick={onClose}>
					<X size={14} />
				</button>
			</div>

			<div className="dr-meta">
				<span className="n-stat">
					<span className="s-dot" />
					{status.label}
				</span>
				<span className="n-meta">{kind.label}</span>
				{node.round ? <span className="n-meta">round {node.round}</span> : null}
				{dur !== null && <span className="n-meta">{fmtDur(dur)}</span>}
				{node.sessionId && (
					<span
						className="dr-session"
						title="Copy the claude session id · resume it with: dots debug"
						onClick={() => {
							void navigator.clipboard.writeText(node.sessionId!);
							toast("Session id copied");
						}}
					>
						{node.sessionId.slice(0, 8)}…
					</span>
				)}
			</div>

			{node.note && <p className="dr-note">{node.note}</p>}

			{node.status === "waiting" && node.kind === "human" && (
				<div className="dr-approve">
					<textarea
						className="input"
						rows={2}
						placeholder="note (optional) · sent back into the run"
						value={note}
						onChange={(e) => setNote(e.target.value)}
					/>
					<div className="dr-approve-btns">
						<button type="button" className="btn primary" onClick={() => void onAnswer(node.id, true, note)}>
							<Check size={13} /> Approve
						</button>
						<button type="button" className="btn danger" onClick={() => void onAnswer(node.id, false, note)}>
							Request changes
						</button>
					</div>
				</div>
			)}

			{hasTranscript && (
				<div className="dr-section">
					<div className="seg dr-tabs">
						{((running ? ["work", "prompt", "input"] : ["reply", "work", "prompt", "input"]) as Tab[]).map((t) => (
							<button key={t} type="button" className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
								{t === "work" ? "Work" : t === "reply" ? "Reply" : t === "prompt" ? "Prompt" : "Input"}
							</button>
						))}
					</div>
					<div className="dr-body" ref={bodyRef}>
						{detail === null ? (
							<div className="dr-empty">Loading…</div>
						) : tab === "work" ? (
							<pre className="dr-pre dr-live">
								{body || (running ? "waiting for the agent's first output…" : "No work recorded.")}
							</pre>
						) : !body ? (
							<div className="dr-empty">
								{tab === "reply" ? "No reply yet." : tab === "prompt" ? "No prompt recorded." : "No input recorded."}
							</div>
						) : tab === "reply" ? (
							<Markdown text={body} />
						) : (
							<pre className="dr-pre">{body}</pre>
						)}
					</div>
				</div>
			)}
		</aside>
	);
}
