import type { RunSummary } from "../shared/api";
import { CoreEcho } from "../shared/CoreEcho";

export type RunRow = RunSummary & { graph: string };

export function fmtWhen(iso: string): string {
	const d = new Date(iso);
	const today = new Date().toDateString() === d.toDateString();
	const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	return today ? hm : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${hm}`;
}

/** "repo#123" for a GitHub PR URL; the target text as it is for anything else. */
export function targetLabel(target: string): string {
	const m = /github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/.exec(target);
	return m ? `${m[1]}#${m[2]}` : target;
}

export function targetUrl(target: string): string | null {
	return /^https?:\/\//.test(target) ? target : null;
}

export function tone(s: RunSummary): { color: string; word: string; pulse: boolean } {
	if (s.status === "running") {
		return s.live
			? { color: "var(--s-running)", word: "Running", pulse: true }
			: { color: "var(--s-failed)", word: "Interrupted", pulse: false };
	}
	if (s.status === "waiting") return { color: "var(--s-waiting)", word: "Needs you", pulse: true };
	if (s.status === "failed") return { color: "var(--s-failed)", word: "Failed", pulse: false };
	return { color: "var(--s-ok)", word: "Done", pulse: false };
}

/** Every run on record, newest first, like an issue list. A row is one run. */
export function RunList({
	rows,
	graph,
	runId,
	onPick,
}: {
	rows: RunRow[];
	graph: string | null;
	runId: string | null;
	onPick: (row: RunRow) => void;
}) {
	return (
		<aside className="rl">
			<div className="rl-head">Runs</div>
			<div className="rl-body">
				{rows.map((s) => {
					const t = tone(s);
					const on = s.runId === runId && s.graph === graph;
					return (
						<button
							type="button"
							key={`${s.graph}:${s.runId}`}
							className={`rl-row ${on ? "on" : ""}`}
							onClick={() => onPick(s)}
						>
							{t.word === "Running" ? (
								<span className="rl-dot" style={{ color: t.color }}>
									<CoreEcho size={11} />
								</span>
							) : (
								<span className={`s-dot ${t.pulse ? "pulsing" : ""}`} style={{ background: t.color }} />
							)}
							<div className="rl-main">
								<div className="rl-title">
									<span className="rl-target" title={s.target}>
										{targetLabel(s.target)}
									</span>
									<span className="rl-when">{fmtWhen(s.startedAt)}</span>
								</div>
								<div className="rl-sub">
									{s.graph} · {t.word}
								</div>
							</div>
						</button>
					);
				})}
				{rows.length === 0 && <div className="rl-empty">No runs yet.</div>}
			</div>
		</aside>
	);
}
