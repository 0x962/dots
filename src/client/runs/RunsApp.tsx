import { ExternalLink, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphBundle } from "../../core/types";
import { api, type LiveRun } from "../shared/api";
import { GraphDiagram } from "../shared/diagram/GraphDiagram";
import { fmtDur } from "../shared/diagram/tokens";
import type { DiagramDoc, DiagramMeta } from "../shared/layout";
import { RunDialog } from "../shared/RunDialog";
import { toast } from "../shared/toast";
import { Toasts } from "../shared/Toasts";
import { AgentsPanel } from "./AgentsPanel";
import { NodeDrawer } from "./NodeDrawer";
import { RunList, targetLabel, targetUrl, type RunRow } from "./RunList";

const PARAMS = new URLSearchParams(location.search);
const EMBED = PARAMS.get("embed") === "1";
const PIN_TARGET = PARAMS.get("target") ?? "";
const PIN_CWD = PARAMS.get("cwd") ?? "";

function docFromRun(run: LiveRun, bundle: GraphBundle | null): DiagramDoc {
	const nodes: Record<string, DiagramMeta> = {};
	for (const rn of run.nodes) {
		const gn = bundle?.doc.nodes[rn.id];
		nodes[rn.id] = {
			kind: rn.kind,
			title: rn.title,
			children: [],
			minutes: gn?.minutes,
			maxRounds: gn?.maxRounds,
		};
	}
	for (const rn of run.nodes) {
		const parent = rn.parentId ? nodes[rn.parentId] : undefined;
		if (!parent) continue;
		if (rn.branch === "no") (parent.elseChildren ??= []).push(rn.id);
		else parent.children.push(rn.id);
	}
	const root = run.nodes.find((n) => !n.parentId)?.id ?? run.nodes[0]?.id ?? "";
	return { root, nodes };
}

function verdictOf(run: LiveRun): { word: string; cls: string; detail: string } {
	if (run.status === "waiting") return { word: "Needs a decision", cls: "waiting", detail: "a human node is parked" };
	if (run.status === "failed") return { word: "Failed", cls: "failed", detail: run.note ?? "" };
	if (run.status === "done") return { word: "Done", cls: "ok", detail: "" };
	return run.live
		? { word: "Running", cls: "running", detail: "" }
		: { word: "Interrupted", cls: "failed", detail: "the runner is not alive · resume it" };
}

export function RunsApp() {
	const [graphs, setGraphs] = useState<string[]>([]);
	const [graph, setGraph] = useState<string | null>(PARAMS.get("g"));
	const [rows, setRows] = useState<RunRow[]>([]);
	const [runId, setRunId] = useState<string | null>(PARAMS.get("run"));
	const [run, setRun] = useState<LiveRun | null>(null);
	const [bundle, setBundle] = useState<GraphBundle | null>(null);
	const [selection, setSelection] = useState<string | null>(null);
	const [dialog, setDialog] = useState(false);
	const [, tick] = useState(0);

	const state = useRef({ graph, runId });
	state.current = { graph, runId };

	useEffect(() => {
		if (!graph) return;
		setBundle(null);
		void api.graph(graph).then(setBundle, () => setBundle(null));
	}, [graph]);

	const refresh = async () => {
		const gs = await api.graphs();
		setGraphs(gs);
		const lists = await Promise.all(
			gs.map(async (g) => (await api.runs(g)).map((s): RunRow => ({ ...s, graph: g }))),
		);
		let all = lists.flat().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
		if (PIN_TARGET) all = all.filter((s) => s.target === PIN_TARGET);
		setRows(all);
		const { graph: g, runId: r } = state.current;
		const wanted = (r && all.find((s) => s.runId === r && s.graph === g)) || all[0] || null;
		if (wanted && (wanted.runId !== r || wanted.graph !== g)) {
			setGraph(wanted.graph);
			setRunId(wanted.runId);
		}
		if (wanted) setRun(await api.run(wanted.graph, wanted.runId));
		else setRun(null);
	};

	useEffect(() => {
		void refresh();
		const poll = setInterval(() => void refresh(), 1500);
		const clock = setInterval(() => tick((n) => n + 1), 1000);
		return () => {
			clearInterval(poll);
			clearInterval(clock);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [graph, runId]);

	const doc = useMemo(() => (run ? docFromRun(run, bundle) : null), [run, bundle]);
	const runById = useMemo(() => new Map((run?.nodes ?? []).map((n) => [n.id, n])), [run]);

	const answer = async (nodeId: string, approve: boolean, note: string) => {
		if (!graph || !run) return;
		await api.answer(graph, run.runId, nodeId, approve, note || undefined);
		await api.resume(graph, run.runId);
		toast(approve ? "Approved · run resumed" : "Changes requested · run resumed");
		await refresh();
	};

	const resume = async () => {
		if (!graph || !run) return;
		await api.resume(graph, run.runId);
		toast("Run resumed");
		await refresh();
	};

	const settled = run?.nodes.filter((n) => ["ok", "failed", "skipped"].includes(n.status)).length ?? 0;
	const elapsed = run
		? (run.finishedAt ? Date.parse(run.finishedAt) : Date.now()) - Date.parse(run.startedAt)
		: 0;
	const verdict = run ? verdictOf(run) : null;
	const selected = selection ? (runById.get(selection) ?? null) : null;
	const prUrl = run ? targetUrl(run.target) : null;

	return (
		<div className="app">
			<header className="topbar">
				{!EMBED && (
					<>
						<a className="brand" href={`/?g=${graph ?? ""}`}>
							<span className="dot" />
							dots
						</a>
						<nav className="nav-tabs">
							<a href={`/?g=${graph ?? ""}`}>Editor</a>
							<a className="on" href={`/runs?g=${graph ?? ""}`}>
								Runs
							</a>
						</nav>
					</>
				)}
				<span className="spacer" />
				<button type="button" className="btn primary" onClick={() => setDialog(true)}>
					<Play size={13} /> New run
				</button>
			</header>

			<div className="main">
				{/* The embed keeps the rail too: it lists every run of the pinned
				    target, which is the whole review history of that PR. */}
				<RunList
					rows={rows}
					graph={graph}
					runId={runId}
					onPick={(row) => {
						setGraph(row.graph);
						setRunId(row.runId);
						setSelection(null);
					}}
				/>
				<div className="center">
					{run && verdict && (
						<div className="runhead">
							<span className={`verdict v-${verdict.cls}`}>
								<span className="s-dot" />
								{verdict.word}
								{verdict.detail && <em>· {verdict.detail}</em>}
							</span>
							{prUrl ? (
								<a className="runhead-target" href={prUrl} target="_blank" rel="noreferrer" title={run.target}>
									{targetLabel(run.target)}
									<ExternalLink size={11} />
								</a>
							) : (
								<span className="runhead-target plain" title={run.target}>
									{targetLabel(run.target)}
								</span>
							)}
							<span className="runhead-meta">{graph}</span>
							{run.cwd && (
								<span className="runhead-meta mono" title={run.cwd}>
									{run.cwd}
								</span>
							)}
							<span className="spacer" />
							{!run.live && run.status !== "done" && (
								<button type="button" className="btn sm" onClick={() => void resume()}>
									<RotateCcw size={12} /> Resume
								</button>
							)}
							<span className="stat">
								<b>
									{settled}/{run.nodes.length}
								</b>{" "}
								nodes
							</span>
							<span className="stat-time">{fmtDur(elapsed)}</span>
						</div>
					)}
					<div className="canvas-wrap">
						{doc && run && graph ? (
							<GraphDiagram
								docKey={`${graph}:${run.runId}`}
								doc={doc}
								mode="run"
								selection={selection}
								onSelect={setSelection}
								runById={runById}
								onAnswer={(id, approve) => {
									if (approve) void answer(id, true, "");
									else setSelection(id);
								}}
							/>
						) : (
							<div className="empty-state">
								<p>{graphs.length > 0 ? "No runs yet." : "No graphs yet."}</p>
								{graphs.length > 0 && (
									<button type="button" className="btn primary" onClick={() => setDialog(true)}>
										<Play size={13} /> Start the first run
									</button>
								)}
							</div>
						)}
					</div>
				</div>
				{graph && run && selected ? (
					<NodeDrawer
						graph={graph}
						runId={run.runId}
						node={selected}
						live={!!run.live}
						onClose={() => setSelection(null)}
						onAnswer={answer}
					/>
				) : graph && run && (run.status === "running" || run.status === "waiting") ? (
					<AgentsPanel graph={graph} runId={run.runId} nodes={run.nodes} onSelect={setSelection} />
				) : null}
			</div>

			{dialog && (
				<RunDialog
					graph={graph ?? localStorage.getItem("dots:last-graph") ?? graphs[0] ?? ""}
					graphs={graphs}
					pinTarget={PIN_TARGET || undefined}
					defaultCwd={PIN_CWD || undefined}
					onClose={() => setDialog(false)}
					onStarted={(id, g) => {
						localStorage.setItem("dots:last-graph", g);
						setDialog(false);
						setGraph(g);
						setRunId(id);
						setSelection(null);
					}}
				/>
			)}
			<Toasts />
		</div>
	);
}
