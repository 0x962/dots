import { FlaskConical, X } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import type { NodeKind } from "../../core/types";
import { KIND } from "../shared/kinds";
import { MarkdownEditor } from "./MarkdownEditor";
import { useEditor } from "./store";
import { TestPane } from "./TestPane";

/** What the runner expects at the end of this node's reply. */
const CONTRACT: Partial<Record<NodeKind, string>> = {
	agent:
		"The agent ends with its OUTPUT for the next node, or SKIP: <reason> when \"Runs when\" misses. Anything it reports, it delivers itself.",
	gate: "An if/else. The agent ends with one line that is exactly YES or NO; the flow then runs that branch, and an empty branch is a skip.",
	loop: "Asked after every round. The agent ends with DONE: <why nothing is left> or AGAIN: <what is left>.",
	human: "Shown to the person on the run board. Put what they are approving in the first line.",
};

/**
 * The full-screen prompt editor. The inspector's editors are for touch-ups;
 * this is where whole prompts get written.
 */
export function FullEditor() {
	const expanded = useEditor((s) => s.expanded);
	const name = useEditor((s) => s.name);
	const bundle = useEditor((s) => s.bundle);
	const setExpanded = useEditor((s) => s.setExpanded);
	const setNode = useEditor((s) => s.setNode);
	const setInstructions = useEditor((s) => s.setInstructions);
	const setBriefing = useEditor((s) => s.setBriefing);
	const expandedForTest = useEditor((s) => s.expandedForTest);
	const [testing, setTesting] = useState(expandedForTest);
	useEffect(() => setTesting(expandedForTest), [expanded, expandedForTest]);

	if (!expanded || !bundle) return null;

	const briefing = expanded === "briefing";
	const node = briefing ? undefined : bundle.doc.nodes[expanded];
	if (!briefing && !node) return null;
	const meta = node ? KIND[node.kind] : null;
	const value = briefing ? bundle.briefing : (bundle.instructions[expanded] ?? "");
	const hint = briefing
		? "Every agent in the run reads this before its own instructions: ground rules, the finding format, the voice."
		: (CONTRACT[node!.kind] ?? "");

	return (
		<div
			className="modal-veil fe-veil"
			onMouseDown={(e) => e.target === e.currentTarget && setExpanded(null)}
		>
			<div className="fe" style={meta ? ({ "--kc": meta.color } as CSSProperties) : undefined}>
				<header className="fe-head">
					{meta && (
						<span className="n-ico">
							<meta.Icon size={15} />
						</span>
					)}
					<div className="fe-titles">
						{node ? (
							<input
								className="fe-title"
								value={node.title}
								onChange={(e) => setNode(expanded, { title: e.target.value }, `title:${expanded}`)}
								onBlur={() => useEditor.getState().commitTitle(expanded)}
							/>
						) : (
							<div className="fe-title-static">Briefing</div>
						)}
						<div className="fe-sub">
							{node ? meta!.label : "read by every agent in the run"}
						</div>
					</div>
					{node && ["agent", "gate", "loop"].includes(node.kind) && (
						<button
							type="button"
							className={`btn ${testing ? "" : "primary"}`}
							title="Run this one node against a target, with the prompt as written here"
							onClick={() => setTesting(!testing)}
						>
							<FlaskConical size={13} /> Test
						</button>
					)}
					<button type="button" className="btn" onClick={() => setExpanded(null)}>
						Done
					</button>
					<button type="button" className="btn ghost icon" onClick={() => setExpanded(null)}>
						<X size={15} />
					</button>
				</header>
				{hint && <div className="fe-hint">{hint}</div>}
				<div className="fe-main">
					<div className="fe-body">
						<MarkdownEditor
							key={expanded}
							tall
							large
							autoFocus
							value={value}
							onChange={briefing ? setBriefing : (text) => setInstructions(expanded, text)}
							placeholder={briefing ? "Ground rules for every node…" : "What this node does…"}
						/>
					</div>
					{testing && node && name && (
						<TestPane
							key={expanded}
							graph={name}
							nodeId={expanded}
							instructions={value}
							briefing={bundle.briefing}
							onClose={() => setTesting(false)}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
