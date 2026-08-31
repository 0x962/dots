import { Play, Redo2, TriangleAlert, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { validateGraph } from "../../core/validate";
import { carriesInstructions } from "../../core/types";
import { GraphDiagram } from "../shared/diagram/GraphDiagram";
import { laneOf } from "../shared/layout";
import { RunDialog } from "../shared/RunDialog";
import { Toasts } from "../shared/Toasts";
import { FullEditor } from "./FullEditor";
import { Inspector } from "./Inspector";
import { SidePanel } from "./SidePanel";
import { useDirty, useEditor } from "./store";

function IssuesPill({ issues }: { issues: string[] }) {
	const [open, setOpen] = useState(false);
	const bundle = useEditor((s) => s.bundle);
	const select = useEditor((s) => s.select);
	useEffect(() => {
		if (issues.length === 0) setOpen(false);
	}, [issues.length]);
	if (issues.length === 0) return null;

	const jumpTo = (issue: string) => {
		if (!bundle) return;
		for (const [id, n] of Object.entries(bundle.doc.nodes)) {
			if (issue.startsWith(`${n.title || id}:`) || issue.startsWith(`${id}:`) || issue.includes(`"${id}"`)) {
				select(id, true);
				return;
			}
		}
	};

	return (
		<div className="issues-wrap">
			<button type="button" className="btn sm issues-pill" onClick={() => setOpen(!open)}>
				<TriangleAlert size={12} />
				{issues.length} {issues.length === 1 ? "issue" : "issues"}
			</button>
			{open && (
				<>
					<div className="pop-veil" onClick={() => setOpen(false)} />
					<div className="issues-pop">
						{issues.map((issue) => (
							<button type="button" key={issue} onClick={() => jumpTo(issue)}>
								{issue}
							</button>
						))}
					</div>
				</>
			)}
		</div>
	);
}

export function EditorApp() {
	const name = useEditor((s) => s.name);
	const bundle = useEditor((s) => s.bundle);
	const selection = useEditor((s) => s.selection);
	const focus = useEditor((s) => s.focus);
	const select = useEditor((s) => s.select);
	const init = useEditor((s) => s.init);
	const undo = useEditor((s) => s.undo);
	const redo = useEditor((s) => s.redo);
	const save = useEditor((s) => s.save);
	const saving = useEditor((s) => s.saving);
	const canUndo = useEditor((s) => s.past.length > 0);
	const canRedo = useEditor((s) => s.future.length > 0);
	const addChild = useEditor((s) => s.addChild);
	const moveNode = useEditor((s) => s.moveNode);
	const deleteNode = useEditor((s) => s.deleteNode);
	const dirty = useDirty();
	const [runOpen, setRunOpen] = useState(false);

	useEffect(() => {
		void init();
	}, [init]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const el = e.target as HTMLElement;
			const typing =
				el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
			const mod = e.metaKey || e.ctrlKey;
			const state = useEditor.getState();
			if (mod && e.key === "s") {
				e.preventDefault();
				void save();
			} else if (mod && e.key === "z" && !typing) {
				e.preventDefault();
				e.shiftKey ? redo() : undo();
			} else if (e.key === "Escape") {
				// The full editor closes first; a second Escape clears the selection.
				if (state.expanded) {
					state.setExpanded(null);
				} else if (!typing) {
					select(null);
				}
			} else if (typing) {
				return;
			} else if (e.key === "Delete" || e.key === "Backspace") {
				if (state.selection) {
					e.preventDefault();
					deleteNode(state.selection);
				}
			} else if (e.key === "Enter" && !state.expanded && state.selection && state.bundle) {
				if (state.selection === "briefing") {
					e.preventDefault();
					state.setExpanded("briefing");
					return;
				}
				const n = state.bundle.doc.nodes[state.selection];
				if (n && carriesInstructions(n.kind)) {
					e.preventDefault();
					state.setExpanded(state.selection);
				}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [save, undo, redo, deleteNode, select]);

	useEffect(() => {
		const warn = (e: BeforeUnloadEvent) => {
			const s = useEditor.getState();
			if (s.bundle && JSON.stringify(s.bundle) !== s.savedJson) e.preventDefault();
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, []);

	const issues = useMemo(() => (bundle ? validateGraph(bundle) : []), [bundle]);

	return (
		<div className="app">
			<header className="topbar">
				<a className="brand" href="/">
					<span className="dot" />
					dots
				</a>
				<nav className="nav-tabs">
					<a className="on" href="/">
						Editor
					</a>
					<a href={`/runs${name ? `?g=${name}` : ""}`}>Runs</a>
				</nav>
				<span className="sep" />
				{name && (
					<span className="mono" style={{ color: "var(--text-faint)", fontSize: 11.5 }}>
						graphs/{name}/
					</span>
				)}
				{name && (
					<span
						className={`save-state ${dirty ? (issues.length > 0 ? "held" : "busy") : ""}`}
						title={
							dirty && issues.length > 0
								? "Held in memory until the issues are fixed"
								: "Every change saves to disk on its own"
						}
					>
						{saving || (dirty && issues.length === 0) ? "Saving…" : dirty ? "Unsaved" : "Saved"}
					</span>
				)}
				<span className="spacer" />
				<IssuesPill issues={issues} />
				<button type="button" className="btn ghost icon" title="Undo (⌘Z)" disabled={!canUndo} onClick={undo}>
					<Undo2 size={14} />
				</button>
				<button type="button" className="btn ghost icon" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redo}>
					<Redo2 size={14} />
				</button>
				<span className="sep" />
				<button
					type="button"
					className="btn primary"
					disabled={!bundle || issues.length > 0}
					title={issues.length > 0 ? "Fix the issues first" : "Start a run of this graph"}
					onClick={() => setRunOpen(true)}
				>
					<Play size={13} /> Run
				</button>
			</header>

			<div className="main">
				<SidePanel />
				<div className="canvas-wrap">
					{bundle && name ? (
						<GraphDiagram
							docKey={name}
							doc={bundle.doc}
							mode="edit"
							selection={selection}
							onSelect={(id) => select(id)}
							focus={focus}
							onMove={(id, target, index) => {
								const lane = laneOf(target);
								moveNode(id, lane?.gateId ?? target, index, lane?.tone);
							}}
							onDropKind={(kind, target, index) => {
								const lane = laneOf(target);
								addChild(lane?.gateId ?? target, kind, index, lane?.tone);
							}}
							onAddInto={(target) => {
								const lane = laneOf(target);
								addChild(lane?.gateId ?? target, "agent", undefined, lane?.tone);
							}}
							onNodeOpen={(id) => {
								if (id === "briefing") {
									useEditor.getState().setExpanded("briefing");
									return;
								}
								const n = bundle.doc.nodes[id];
								if (n && carriesInstructions(n.kind)) useEditor.getState().setExpanded(id);
							}}
						/>
					) : (
						<div className="empty-state">
							<p>No graphs yet.</p>
							<p className="hint">Create one from the panel on the left.</p>
						</div>
					)}
				</div>
				{selection !== null && <Inspector />}
			</div>

			<FullEditor />
			{runOpen && name && (
				<RunDialog
					graph={name}
					dirty={dirty}
					beforeStart={dirty ? save : undefined}
					onClose={() => setRunOpen(false)}
					onStarted={(runId) => {
						location.href = `/runs?g=${name}&run=${runId}`;
					}}
				/>
			)}
			<Toasts />
		</div>
	);
}
