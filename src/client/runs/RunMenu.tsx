import { ChevronDown, Plus } from "lucide-react";
import { useState } from "react";
import type { RunSummary } from "../shared/api";
import { CoreEcho } from "../shared/CoreEcho";

function fmtWhen(iso: string): string {
	const d = new Date(iso);
	const today = new Date().toDateString() === d.toDateString();
	const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	return today ? hm : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${hm}`;
}

function tone(s: RunSummary): { color: string; word: string; pulse: boolean } {
	if (s.status === "running") {
		return s.live
			? { color: "var(--s-running)", word: "Running", pulse: true }
			: { color: "var(--s-failed)", word: "Interrupted", pulse: false };
	}
	if (s.status === "waiting") return { color: "var(--s-waiting)", word: "Needs you", pulse: true };
	if (s.status === "failed") return { color: "var(--s-failed)", word: "Failed", pulse: false };
	return { color: "var(--s-ok)", word: "Done", pulse: false };
}

/** One control for runs: the current run's state, the history, and New run. */
export function RunMenu({
	summaries,
	runId,
	onPick,
	onNew,
}: {
	summaries: RunSummary[];
	runId: string | null;
	onPick: (runId: string) => void;
	onNew: () => void;
}) {
	const [open, setOpen] = useState(false);
	const current = summaries.find((s) => s.runId === runId) ?? null;
	const t = current ? tone(current) : null;

	return (
		<div className="rm">
			<button type="button" className="btn rm-btn" onClick={() => setOpen(!open)}>
				{t ? (
					<>
						{t.word === "Running" ? (
							<span style={{ color: t.color, display: "inline-flex" }}>
								<CoreEcho size={13} />
							</span>
						) : (
							<span className={`s-dot ${t.pulse ? "pulsing" : ""}`} style={{ background: t.color }} />
						)}
						{fmtWhen(current!.startedAt)} · {t.word}
					</>
				) : (
					"No runs yet"
				)}
				<ChevronDown size={13} style={{ color: "var(--text-faint)" }} />
			</button>
			{open && (
				<>
					<div className="rm-veil" onClick={() => setOpen(false)} />
					<div className="rm-pop">
						<button
							type="button"
							className="rm-new"
							onClick={() => {
								setOpen(false);
								onNew();
							}}
						>
							<Plus size={13} /> New run
						</button>
						{summaries.length > 0 && <div className="rm-sep" />}
						<div className="rm-list">
							{summaries.map((s) => {
								const st = tone(s);
								return (
									<button
										type="button"
										key={s.runId}
										className={`rm-row ${s.runId === runId ? "on" : ""}`}
										onClick={() => {
											setOpen(false);
											onPick(s.runId);
										}}
									>
										<span
											className={`s-dot ${st.pulse ? "pulsing" : ""}`}
											style={{ background: st.color }}
										/>
										<span className="rm-when">{fmtWhen(s.startedAt)}</span>
										<span className="rm-word">{st.word}</span>
										<span className="rm-target" title={s.target}>
											{s.target}
										</span>
									</button>
								);
							})}
						</div>
					</div>
				</>
			)}
		</div>
	);
}
