import { carriesInstructions } from "../core/types";
import {
	deleteSubtree,
	KIND_META,
	node,
	parentOf,
	renameId,
	reorder,
	state,
} from "./state";

function esc(t: string): string {
	return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/** The right pane: the selected node's form, or the graph's briefing. */
export function drawInspector(): void {
	const el = document.getElementById("inspector") as HTMLElement;
	const bundle = state.bundle;
	if (!bundle) {
		el.innerHTML = "";
		return;
	}
	const id = state.selection;
	const n = id ? node(id) : undefined;
	if (!id || !n) {
		el.innerHTML = `<h3>Briefing</h3>
		<p class="lede">What the lead reads before the graph: ground rules, the finding format, the voice. Click a node to edit it instead.</p>
		<div class="fld"><textarea class="inp mono" id="f-briefing" rows="22" spellcheck="false">${esc(bundle.briefing)}</textarea></div>`;
		el.querySelector("#f-briefing")?.addEventListener("input", (ev) => {
			bundle.briefing = (ev.target as HTMLTextAreaElement).value;
			state.onChange();
		});
		return;
	}
	const meta = KIND_META[n.kind];
	const pid = parentOf(id);
	const isRoot = id === bundle.doc.root;
	let extra = "";
	if (n.kind === "budget") {
		extra = `<div class="fld"><label>Minutes</label><input class="inp" id="f-min" type="number" min="1" value="${n.minutes ?? 10}" style="width:90px"></div>`;
	}
	if (n.kind === "loop") {
		extra = `<div class="fld"><label>Max rounds</label><input class="inp" id="f-rounds" type="number" min="1" value="${n.maxRounds ?? 2}" style="width:90px"></div>`;
	}
	if (n.kind === "agent") {
		extra += `<div class="fld"><label>With its findings, the lead may</label>
		<select class="sel" id="f-action">
			<option value="" ${!n.action ? "selected" : ""}>Not a findings node</option>
			<option value="fix-when-certain" ${n.action === "fix-when-certain" ? "selected" : ""}>Apply only clear-cut findings</option>
			<option value="fix" ${n.action === "fix" ? "selected" : ""}>Apply every finding</option>
			<option value="report" ${n.action === "report" ? "selected" : ""}>Report only, never edit</option>
		</select></div>
		<div class="fld" id="w-boundary" ${!n.action || n.action === "report" ? "hidden" : ""}><label>Never change</label>
		<p class="help">The line the lead must not cross when it applies findings from this node.</p>
		<textarea class="inp" id="f-boundary" rows="3">${esc(n.fixBoundary ?? "")}</textarea></div>`;
	}
	let md = "";
	if (carriesInstructions(n.kind)) {
		const label = n.kind === "loop" ? "Exit question" : "Instructions";
		const help =
			n.kind === "gate"
				? "Must end with YES: &lt;focus&gt; or NO: &lt;reason&gt;."
				: n.kind === "human"
					? "What the person is asked, and what their yes means."
					: n.kind === "loop"
						? "Answered DONE: &lt;why&gt; or AGAIN: &lt;what is left&gt; after each round."
						: "Markdown this node's agent reads. Saved as nodes/" + id + ".md.";
		md = `<div class="fld"><label>${label}</label><p class="help">${help}</p>
		<textarea class="inp mono" id="f-md" rows="14" spellcheck="false">${esc(bundle.instructions[id] ?? "")}</textarea></div>`;
	}
	const siblings = pid ? node(pid)?.children ?? [] : [];
	const at = siblings.indexOf(id);
	el.innerHTML = `<h3>${meta.label}</h3><p class="lede">${meta.lede}</p>
	<div class="fldrow fld">
		<div class="grow"><label>Name</label><input class="inp" id="f-title" value="${esc(n.title)}"></div>
	</div>
	<div class="fld"><label>Id</label><p class="help">Names the node's file and its run marks. Renaming moves nodes/${id}.md.</p>
	<input class="inp mono" id="f-id" value="${id}" spellcheck="false"><p class="help" id="id-err" style="color:var(--bad)"></p></div>
	${extra}${md}
	${
		pid
			? `<div class="fld"><label>Position under ${esc(node(pid)?.title ?? pid)}</label><div class="rowbtns">
			<button class="btn" id="f-up" ${at === 0 ? "disabled" : ""}>↑ Earlier</button>
			<button class="btn" id="f-down" ${at === siblings.length - 1 ? "disabled" : ""}>↓ Later</button></div></div>`
			: ""
	}
	${!isRoot ? '<button class="btn ghost" id="f-del">Delete node and its subtree</button>' : ""}`;

	const bind = (sel: string, fn: (v: string) => void) => {
		el.querySelector(sel)?.addEventListener("input", (ev) => {
			fn((ev.target as HTMLInputElement).value);
			state.onChange();
		});
	};
	bind("#f-title", (v) => {
		n.title = v;
	});
	bind("#f-min", (v) => {
		n.minutes = Math.max(1, Number(v) || 1);
	});
	bind("#f-rounds", (v) => {
		n.maxRounds = Math.max(1, Number(v) || 1);
	});
	bind("#f-md", (v) => {
		bundle.instructions[id] = v;
	});
	bind("#f-boundary", (v) => {
		n.fixBoundary = v;
	});
	el.querySelector("#f-action")?.addEventListener("change", (ev) => {
		const v = (ev.target as HTMLSelectElement).value;
		if (v) n.action = v as typeof n.action;
		else delete n.action;
		state.onChange();
	});
	const idInput = el.querySelector("#f-id") as HTMLInputElement | null;
	idInput?.addEventListener("change", () => {
		const next = idInput.value.trim();
		if (next === id) return;
		const err = renameId(id, next);
		const errEl = el.querySelector("#id-err") as HTMLElement;
		if (err) {
			errEl.textContent = err;
			idInput.value = id;
		}
	});
	el.querySelector("#f-up")?.addEventListener("click", () => reorder(id, -1));
	el.querySelector("#f-down")?.addEventListener("click", () => reorder(id, 1));
	el.querySelector("#f-del")?.addEventListener("click", () => deleteSubtree(id));
}
