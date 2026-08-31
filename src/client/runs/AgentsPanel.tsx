import { useEffect, useState } from "react";
import type { RunNode } from "../../core/types";
import { api } from "../shared/api";
import { nodeDurationMs } from "../shared/diagram/CardNode";
import { fmtDur } from "../shared/diagram/tokens";
import { KIND } from "../shared/kinds";

function lastLine(stream: string): string {
	const lines = stream.split("\n").map((l) => l.trim()).filter(Boolean);
	const line = lines[lines.length - 1] ?? "";
	return line.length > 110 ? `${line.slice(0, 110)}…` : line;
}

/**
 * What every agent is doing right now: one row per running node with the
 * tail of its live output. Shown while the run is going and no node is
 * selected; a click opens the node's drawer.
 */
export function AgentsPanel({
	graph,
	runId,
	nodes,
	onSelect,
}: {
	graph: string;
	runId: string;
	nodes: RunNode[];
	onSelect: (id: string) => void;
}) {
	const running = nodes.filter(
		(n) => n.status === "running" && ["agent", "gate", "loop"].includes(n.kind),
	);
	const waiting = nodes.filter((n) => n.status === "waiting");
	const queued = nodes.filter(
		(n) => n.status === "pending" && !["parallel", "sequence", "budget"].includes(n.kind),
	).length;
	const [tails, setTails] = useState<Record<string, string>>({});
	const [, tick] = useState(0);

	useEffect(() => {
		let stop = false;
		const poll = async () => {
			const ids = running.map((n) => n.id);
			const details = await Promise.all(ids.map((id) => api.nodeDetail(graph, runId, id)));
			if (stop) return;
			setTails(Object.fromEntries(ids.map((id, i) => [id, lastLine(details[i].stream)])));
		};
		void poll();
		const iv = setInterval(() => void poll(), 2000);
		const clock = setInterval(() => tick((n) => n + 1), 1000);
		return () => {
			stop = true;
			clearInterval(iv);
			clearInterval(clock);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [graph, runId, running.map((n) => n.id).join(",")]);

	return (
		<aside className="ap">
			<div className="ap-head">Agents</div>
			<div className="ap-body">
				{waiting.map((n) => (
					<button type="button" key={n.id} className="ap-row" onClick={() => onSelect(n.id)}>
						<span className="s-dot pulsing" style={{ background: "var(--s-waiting)" }} />
						<div className="ap-main">
							<div className="ap-title">
								{n.title}
								<span className="ap-dur">needs you</span>
							</div>
							<div className="ap-tail">{n.note ?? "waiting for a decision"}</div>
						</div>
					</button>
				))}
				{running.map((n) => {
					const kind = KIND[n.kind];
					const dur = nodeDurationMs(n);
					return (
						<button type="button" key={n.id} className="ap-row" onClick={() => onSelect(n.id)}>
							<span className="s-dot pulsing" style={{ background: "var(--s-running)" }} />
							<div className="ap-main">
								<div className="ap-title">
									<kind.Icon size={11} style={{ color: kind.color, flex: "none" }} />
									{n.title}
									{dur !== null && <span className="ap-dur">{fmtDur(dur)}</span>}
								</div>
								<div className="ap-tail">{tails[n.id] || "starting…"}</div>
							</div>
						</button>
					);
				})}
				{running.length === 0 && waiting.length === 0 && (
					<div className="ap-empty">No agent is running right now.</div>
				)}
				{queued > 0 && <div className="ap-queued">{queued} queued</div>}
			</div>
		</aside>
	);
}
