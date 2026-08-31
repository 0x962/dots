import { Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphBundle } from "../../core/types";
import { api, type LiveRun, type RunSummary } from "../shared/api";
import { GraphDiagram } from "../shared/diagram/GraphDiagram";
import { fmtDur } from "../shared/diagram/tokens";
import type { DiagramDoc, DiagramMeta } from "../shared/layout";
import { RunDialog } from "../shared/RunDialog";
import { toast } from "../shared/toast";
import { Toasts } from "../shared/Toasts";
import { AgentsPanel } from "./AgentsPanel";
import { NodeDrawer } from "./NodeDrawer";
import { RunMenu } from "./RunMenu";

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
	const [summaries, setSummaries] = useState<RunSummary[]>([]);
	const [runId, setRunId] = useState<string | null>(PARAMS.get("run"));
	const [run, setRun] = useState<LiveRun | null>(null);
	const [bundle, setBundle] = useState<GraphBundle | null>(null);
	const [selection, setSelection] = useState<string | null>(null);
	const [dialog, setDialog] = useState(false);
	const [, tick] = useState(0);

	const state = useRef({ graph, runId });
	state.current = { graph, runId };

	useEffect(() => {
		void api.graphs().then((gs) => {
			setGraphs(gs);
			setGraph((g) => (g && gs.includes(g) ? g : (gs[0] ?? null)));
		});
	}, []);

	useEffect(() => {
		if (!graph) return;
		setBundle(null);
		void api.graph(graph).then(setBundle, () => setBundle(null));
	}, [graph]);

	const refresh = async () => {
		const { graph: g, runId: r } = state.current;
		if (!g) return;
		let list = await api.runs(g);
		if (PIN_TARGET) list = list.filter((s) => s.target === PIN_TARGET);
		setSummaries(list);
		const wanted = r && list.some((s) => s.runId === r) ? r : (list[0]?.runId ?? null);
		if (wanted !== r) setRunId(wanted);
		if (wanted) setRun(await api.run(g, wanted));
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
				{PIN_TARGET && (
					<span className="pin-target mono" title={PIN_TARGET}>
						{PIN_TARGET}
					</span>
				)}
				<span className="spacer" />
				{run && !run.live && run.status !== "done" && (
					<button type="button" className="btn" onClick={() => void resume()}>
						<RotateCcw size={13} /> Resume
					</button>
				)}
				{!EMBED && (
					<select
						className="select"
						style={{ width: 140 }}
						value={graph ?? ""}
						onChange={(e) => {
							setGraph(e.target.value);
							setRunId(null);
							setSelection(null);
						}}
					>
						{graphs.map((g) => (
							<option key={g} value={g}>
								{g}
							</option>
						))}
					</select>
				)}
				<RunMenu
					summaries={summaries}
					runId={runId}
					onPick={(id) => {
						setRunId(id);
						setSelection(null);
					}}
					onNew={() => setDialog(true)}
				/>
			</header>

			{run && verdict && (
				<div className="statstrip">
					<span className={`verdict v-${verdict.cls}`}>
						<span className="s-dot" />
						{verdict.word}
						{verdict.detail && <em>· {verdict.detail}</em>}
					</span>
					<span className="stat-target mono" title={run.target}>
						{run.target}
					</span>
					<span className="spacer" />
					<span className="stat">
						<b>
							{settled}/{run.nodes.length}
						</b>{" "}
						nodes
					</span>
					<span className="stat-time">{fmtDur(elapsed)}</span>
				</div>
			)}

			<div className="main">
				<div className="canvas-wrap">
					{doc && run ? (
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
							<p>{graph ? "No runs of this graph yet." : "No graphs yet."}</p>
							{graph && (
								<button type="button" className="btn primary" onClick={() => setDialog(true)}>
									<Play size={13} /> Start the first run
								</button>
							)}
						</div>
					)}
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

			{dialog && graph && (
				<RunDialog
					graph={graph}
					pinTarget={PIN_TARGET || undefined}
					defaultCwd={PIN_CWD || undefined}
					onClose={() => setDialog(false)}
					onStarted={(id) => {
						setDialog(false);
						setRunId(id);
						setSelection(null);
					}}
				/>
			)}
			<Toasts />
		</div>
	);
}
