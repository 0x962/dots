import { Play, Plus, X } from "lucide-react";
import { useState } from "react";
import { api } from "./api";
import { toast } from "./toast";

interface Remembered {
	target: string;
	cwd: string;
	vars: Array<{ k: string; v: string }>;
}

function remembered(graph: string): Remembered {
	const raw = localStorage.getItem(`dots:last-run:${graph}`);
	return raw ? (JSON.parse(raw) as Remembered) : { target: "", cwd: "", vars: [] };
}

export function RunDialog({
	graph,
	onClose,
	onStarted,
	pinTarget,
	defaultCwd,
	dirty,
	beforeStart,
}: {
	graph: string;
	onClose: () => void;
	onStarted: (runId: string) => void;
	/** Embed mode pins the run to one target. */
	pinTarget?: string;
	defaultCwd?: string;
	/** Unsaved editor changes: the run reads from disk, so save first. */
	dirty?: boolean;
	beforeStart?: () => Promise<boolean>;
}) {
	const last = remembered(graph);
	const [target, setTarget] = useState(pinTarget ?? last.target);
	const [cwd, setCwd] = useState(defaultCwd ?? last.cwd);
	const [vars, setVars] = useState<Array<{ k: string; v: string }>>(last.vars);
	const [busy, setBusy] = useState(false);

	const start = async () => {
		if (!target.trim()) return;
		setBusy(true);
		try {
			if (beforeStart && !(await beforeStart())) return;
			localStorage.setItem(`dots:last-run:${graph}`, JSON.stringify({ target, cwd, vars }));
			const varMap = Object.fromEntries(
				vars.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v]),
			);
			const { runId } = await api.startRun(graph, {
				target: target.trim(),
				cwd: cwd.trim() || undefined,
				vars: varMap,
			});
			onStarted(runId);
		} catch (error) {
			toast(error instanceof Error ? error.message : String(error), "error");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="modal-veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div className="modal">
				<header>
					Run {graph}
					<button type="button" className="btn ghost icon sm" onClick={onClose}>
						<X size={14} />
					</button>
				</header>
				<div className="body">
					<div className="field">
						<label>Target</label>
						<input
							className="input"
							autoFocus={!pinTarget}
							readOnly={!!pinTarget}
							placeholder="what the run is aimed at, e.g. a PR URL"
							value={target}
							onChange={(e) => setTarget(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && start()}
						/>
					</div>
					<div className="field">
						<label>Working directory</label>
						<input
							className="input mono"
							placeholder="where the agents run · empty = the server's directory"
							value={cwd}
							onChange={(e) => setCwd(e.target.value)}
						/>
					</div>
					<div className="field">
						<label>Variables</label>
						{vars.map((row, i) => (
							<div key={i} style={{ display: "flex", gap: 6 }}>
								<input
									className="input mono"
									style={{ width: 130 }}
									placeholder="KEY"
									value={row.k}
									onChange={(e) =>
										setVars(vars.map((r, j) => (j === i ? { ...r, k: e.target.value.toUpperCase() } : r)))
									}
								/>
								<input
									className="input"
									placeholder="value"
									value={row.v}
									onChange={(e) => setVars(vars.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))}
								/>
								<button
									type="button"
									className="btn ghost icon"
									onClick={() => setVars(vars.filter((_, j) => j !== i))}
								>
									<X size={13} />
								</button>
							</div>
						))}
						<div>
							<button type="button" className="btn sm" onClick={() => setVars([...vars, { k: "", v: "" }])}>
								<Plus size={12} /> Variable
							</button>
							<span className="hint" style={{ marginLeft: 8 }}>
								fills {"{KEY}"} in the briefing and instructions
							</span>
						</div>
					</div>
				</div>
				<footer>
					<button type="button" className="btn" onClick={onClose}>
						Cancel
					</button>
					<button type="button" className="btn primary" disabled={!target.trim() || busy} onClick={start}>
						<Play size={13} /> {dirty ? "Save & start" : "Start run"}
					</button>
				</footer>
			</div>
		</div>
	);
}
