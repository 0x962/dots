import { Copy, Plus, Trash2, X } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { carriesInstructions } from "../../core/types";
import { KIND, KIND_ORDER } from "../shared/kinds";
import { useEditor } from "./store";

const NAME_SHAPE = /^[a-z0-9][a-z0-9-]*$/;

function NewGraphModal({ from, onClose }: { from?: string; onClose: () => void }) {
	const createGraph = useEditor((s) => s.createGraph);
	const [name, setName] = useState("");
	const ok = NAME_SHAPE.test(name);
	const submit = async () => {
		if (ok && (await createGraph(name, from))) onClose();
	};
	return (
		<div className="modal-veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div className="modal">
				<header>
					{from ? `Duplicate ${from}` : "New graph"}
					<button type="button" className="btn ghost icon sm" onClick={onClose}>
						<X size={14} />
					</button>
				</header>
				<div className="body">
					<div className="field">
						<label>Name</label>
						<input
							className="input mono"
							autoFocus
							placeholder="lowercase-with-dashes"
							value={name}
							onChange={(e) => setName(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && submit()}
						/>
						<span className="hint">becomes the folder graphs/{name || "<name>"}/</span>
					</div>
				</div>
				<footer>
					<button type="button" className="btn" onClick={onClose}>
						Cancel
					</button>
					<button type="button" className="btn primary" disabled={!ok} onClick={submit}>
						Create
					</button>
				</footer>
			</div>
		</div>
	);
}

function DeleteGraphModal({ name, onClose }: { name: string; onClose: () => void }) {
	const removeGraph = useEditor((s) => s.removeGraph);
	return (
		<div className="modal-veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div className="modal">
				<header>Delete {name}?</header>
				<div className="body">
					<p style={{ margin: 0, color: "var(--text-dim)" }}>
						Removes <span className="mono">graphs/{name}/</span> from disk, with every run and
						transcript in it.
					</p>
				</div>
				<footer>
					<button type="button" className="btn" onClick={onClose}>
						Cancel
					</button>
					<button
						type="button"
						className="btn danger"
						onClick={async () => {
							await removeGraph(name);
							onClose();
						}}
					>
						<Trash2 size={13} /> Delete
					</button>
				</footer>
			</div>
		</div>
	);
}

function Outline() {
	const bundle = useEditor((s) => s.bundle);
	const selection = useEditor((s) => s.selection);
	const select = useEditor((s) => s.select);
	const setExpanded = useEditor((s) => s.setExpanded);
	if (!bundle) return null;
	const rows: Array<{ id: string; depth: number; branch?: "no" }> = [];
	const walk = (id: string, depth: number, branch?: "no") => {
		if (!bundle.doc.nodes[id] || rows.some((r) => r.id === id)) return;
		rows.push({ id, depth, branch });
		for (const c of bundle.doc.nodes[id].children) walk(c, depth + 1);
		for (const c of bundle.doc.nodes[id].elseChildren ?? []) walk(c, depth + 1, "no");
	};
	walk(bundle.doc.root, 0);
	const orphans = Object.keys(bundle.doc.nodes).filter((id) => !rows.some((r) => r.id === id));
	for (const o of orphans) walk(o, 0);
	return (
		<div className="outline">
			{rows.map(({ id, depth, branch }) => {
				const n = bundle.doc.nodes[id];
				const meta = KIND[n.kind];
				return (
					<button
						type="button"
						key={id}
						className={`o-row ${selection === id ? "on" : ""}`}
						style={{ paddingLeft: 10 + depth * 14 }}
						onClick={() => select(id, true)}
						onDoubleClick={() => carriesInstructions(n.kind) && setExpanded(id)}
						title={`${meta.label}${branch ? " · on the gate's NO branch" : ""}`}
					>
						<meta.Icon size={12} style={{ color: "var(--text-faint)", flex: "none" }} />
						<span className="o-title">{n.title}</span>
						{branch && <span className="o-branch">no</span>}
					</button>
				);
			})}
		</div>
	);
}

export function SidePanel() {
	const graphs = useEditor((s) => s.graphs);
	const name = useEditor((s) => s.name);
	const bundle = useEditor((s) => s.bundle);
	const open = useEditor((s) => s.open);
	const addChild = useEditor((s) => s.addChild);
	const selection = useEditor((s) => s.selection);
	const [modal, setModal] = useState<null | { kind: "new"; from?: string } | { kind: "delete"; name: string }>(null);

	/** Where a palette click lands: the selected container, else the selection's parent, else the root. */
	const targetContainer = (): string | null => {
		if (!bundle) return null;
		if (selection && bundle.doc.nodes[selection]) {
			const k = bundle.doc.nodes[selection].kind;
			if (k !== "agent" && k !== "human") return selection;
			for (const [pid, n] of Object.entries(bundle.doc.nodes)) {
				if (n.children.includes(selection)) return pid;
			}
		}
		return bundle.doc.root;
	};

	return (
		<aside className="side">
			<section className="side-sec">
				<div className="side-head">
					<span>Graphs</span>
					<button type="button" className="btn ghost icon sm" title="New graph" onClick={() => setModal({ kind: "new" })}>
						<Plus size={13} />
					</button>
				</div>
				<div className="graph-list">
					{graphs.map((g) => (
						<div key={g} className={`g-row ${g === name ? "on" : ""}`}>
							<button type="button" className="g-name mono" onClick={() => open(g)}>
								{g}
							</button>
							<button
								type="button"
								className="g-act"
								title="Duplicate"
								onClick={() => setModal({ kind: "new", from: g })}
							>
								<Copy size={12} />
							</button>
							<button
								type="button"
								className="g-act"
								title="Delete"
								onClick={() => setModal({ kind: "delete", name: g })}
							>
								<Trash2 size={12} />
							</button>
						</div>
					))}
				</div>
			</section>

			<section className="side-sec">
				<div className="side-head">
					<span>Insert</span>
				</div>
				<div className="palette">
					{KIND_ORDER.map((k) => {
						const meta = KIND[k];
						return (
							<button
								type="button"
								key={k}
								className="pal-tile"
								draggable
								title={meta.lede}
								style={{ "--kc": meta.color } as CSSProperties}
								onDragStart={(e) => {
									e.dataTransfer.setData("application/dots-kind", k);
									e.dataTransfer.effectAllowed = "copy";
								}}
								onClick={() => {
									const t = targetContainer();
									if (t) addChild(t, k);
								}}
							>
								<span className="pal-ico">
									<meta.Icon size={13} />
								</span>
								{meta.label}
							</button>
						);
					})}
				</div>
				<p className="side-hint">
					Drag onto the canvas to place it: the section or gate branch under the pointer
					highlights, and the drop point sets its position. Click to add into the selected
					section instead.
				</p>
			</section>

			<section className="side-sec grow">
				<div className="side-head">
					<span>Outline</span>
				</div>
				<Outline />
			</section>

			{modal?.kind === "new" && <NewGraphModal from={modal.from} onClose={() => setModal(null)} />}
			{modal?.kind === "delete" && <DeleteGraphModal name={modal.name} onClose={() => setModal(null)} />}
		</aside>
	);
}
