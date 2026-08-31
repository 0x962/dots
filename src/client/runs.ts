import type { GraphBundle, GraphRun, RunNode, RunNodeStatus } from "../core/types";

interface RunSummary {
	runId: string;
	status: string;
	target: string;
	startedAt: string;
	finishedAt: string | null;
	found: number;
	fixed: number;
	costUsd: number;
	live: boolean;
}

const S = {
	graph: "",
	runId: "",
	run: null as (GraphRun & { live?: boolean }) | null,
	bundle: null as GraphBundle | null,
	runs: [] as RunSummary[],
	selection: null as string | null,
	expand: {} as Record<string, boolean>,
};

const $ = (id: string) => document.getElementById(id) as HTMLElement;

/**
 * Embed mode is how Canary DE (or anything else) mounts this page as a
 * pane: ?embed=1 hides the chrome, ?target pins the run list and the Run
 * button to one target (a PR), ?cwd tells new runs where to execute, and
 * ?theme overrides the color scheme.
 */
const PARAMS = new URLSearchParams(location.search);
const EMBED = PARAMS.get("embed") === "1";
const PIN_TARGET = PARAMS.get("target") ?? "";
const PIN_CWD = PARAMS.get("cwd") ?? "";
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/* ---------------- data ---------------- */

async function j<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, init);
	return (await res.json()) as T;
}

async function refreshRuns(): Promise<void> {
	S.runs = (await j<{ runs: RunSummary[] }>(`/api/graphs/${S.graph}/runs`)).runs;
	if (PIN_TARGET) S.runs = S.runs.filter((r) => r.target === PIN_TARGET);
	const sel = $("run-select") as HTMLSelectElement;
	sel.innerHTML = S.runs
		.map((r) => `<option value="${r.runId}">${r.runId.slice(4, 23)} · ${r.status}</option>`)
		.join("");
	if (S.runId && S.runs.some((r) => r.runId === S.runId)) sel.value = S.runId;
	else S.runId = S.runs[0]?.runId ?? "";
}

async function refreshRun(): Promise<void> {
	if (!S.runId) {
		S.run = null;
		render();
		return;
	}
	S.run = await j(`/api/graphs/${S.graph}/runs/${S.runId}`);
	render();
}

/* ---------------- verdict + helpers ---------------- */

function fmtDur(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

function nodeDur(n: RunNode): string {
	if (!n.startedAt) return "";
	const end = n.finishedAt ? Date.parse(n.finishedAt) : Date.now();
	return fmtDur(end - Date.parse(n.startedAt));
}

function verdict(run: GraphRun & { live?: boolean }): { cls: string; word: string; msg: string } {
	const found = run.nodes.reduce((t, n) => t + (n.count ?? 0), 0);
	const failed = run.nodes.some((n) => n.status === "failed");
	if (run.status === "running") {
		const settled = run.nodes.filter((n) => !["pending", "running"].includes(n.status)).length;
		return { cls: "sl-running", word: "running", msg: `${run.nodes.length - settled} nodes open${run.live ? "" : " · no runner attached (resume from a terminal or below)"}` };
	}
	if (run.status === "waiting") {
		const asks = run.nodes.filter((n) => n.kind === "human" && n.status === "waiting").length;
		return { cls: "sl-waiting", word: "waiting on you", msg: `${asks} approval${asks === 1 ? "" : "s"} block${asks === 1 ? "s" : ""} the run` };
	}
	if (run.status === "failed" || failed) return { cls: "sl-failed", word: "failed", msg: run.note ?? "a node failed; open it for the reason" };
	if (found > 0) return { cls: "sl-done-items", word: "findings", msg: `${found} finding${found === 1 ? "" : "s"} await judgment` };
	return { cls: "sl-done-ok", word: "clean", msg: "every node came back clean" };
}

/* ---------------- metro board ---------------- */

const LANE = 17;
const X0 = 11;
const RB = 22;
const RSUB = 12;
const RHUM = 30;
const STR = 4.2;

interface Row {
	n: RunNode;
	depth: number;
	seqIndex: number | null;
	y: number;
	h: number;
	open: boolean;
	kids: string[];
	hasSub: boolean;
}

function statusCls(s: RunNodeStatus): string {
	return s;
}

function buildRows(run: GraphRun): Row[] {
	const byParent = new Map<string | null, RunNode[]>();
	for (const n of run.nodes) {
		const list = byParent.get(n.parentId) ?? [];
		list.push(n);
		byParent.set(n.parentId, list);
	}
	const rows: Row[] = [];
	const active = (id: string): boolean => {
		const n = run.nodes.find((x) => x.id === id);
		if (!n) return false;
		if (["running", "waiting", "failed"].includes(n.status)) return true;
		if (n.status === "items" && run.status !== "done") return true;
		return (byParent.get(id) ?? []).some((k) => active(k.id) || (k.status === "items" && true));
	};
	const hasItems = (id: string): boolean => {
		const n = run.nodes.find((x) => x.id === id);
		if (!n) return false;
		if ((n.count ?? 0) > 0) return true;
		return (byParent.get(id) ?? []).some((k) => hasItems(k.id));
	};
	const walk = (n: RunNode, depth: number, seqIndex: number | null) => {
		const kids = (byParent.get(n.id) ?? []).map((k) => k.id);
		const auto = active(n.id) || hasItems(n.id);
		const open = n.id in S.expand ? S.expand[n.id] : auto;
		const hasSub = !!(n.note || n.output) && kids.length === 0 && n.status !== "waiting";
		let h = RB;
		if (hasSub) h += RSUB;
		if (n.kind === "human" && n.status === "waiting") h += RSUB;
		rows.push({ n, depth, seqIndex, y: 0, h, open, kids, hasSub });
		if (open) {
			const parentKind = n.kind;
			(byParent.get(n.id) ?? []).forEach((k, i) =>
				walk(k, depth + 1, parentKind === "sequence" || parentKind === "loop" ? i + 1 : null),
			);
		}
	};
	const roots = byParent.get(null) ?? [];
	for (const r of roots) {
		for (const [i, k] of (byParent.get(r.id) ?? []).entries()) {
			// The root container itself is implicit; its children are the lanes.
			walk(k, 0, r.kind === "sequence" ? i + 1 : null);
		}
	}
	let y = 4;
	for (const row of rows) {
		row.y = y + 11;
		y += row.h;
	}
	return rows;
}

function renderMetro(run: GraphRun): string {
	const rows = buildRows(run);
	const total = rows.reduce((t, r) => t + r.h, 0) + 18;
	const X = (d: number) => X0 + d * LANE;
	const rowOf = new Map(rows.map((r) => [r.n.id, r]));
	let paths = "";
	let stations = "";
	const edge = (x1: number, y1: number, x2: number, y2: number, s: RunNodeStatus) => {
		if (x1 === x2) {
			paths += `<path class="edge e-${statusCls(s)}" d="M ${x1} ${y1} L ${x2} ${y2}"/>`;
		} else {
			const r = Math.min(9, (x2 - x1) / 1.5, y2 - y1);
			paths += `<path class="edge e-${statusCls(s)}" d="M ${x1} ${y1} L ${x1} ${y2 - r} Q ${x1} ${y2}, ${x1 + r} ${y2} L ${x2} ${y2}"/>`;
		}
	};
	// top-level chain
	const tops = rows.filter((r) => r.depth === 0);
	tops.forEach((row, i) => {
		if (i > 0) edge(X(0), tops[i - 1].y + STR, X(0), row.y - STR, row.n.status);
	});
	for (const row of rows) {
		if (!row.open || row.kids.length === 0) continue;
		const kidRows = row.kids.map((k) => rowOf.get(k)).filter(Boolean) as Row[];
		const seq = row.n.kind === "sequence" || row.n.kind === "loop";
		kidRows.forEach((kid, i) => {
			if (seq && i > 0) edge(X(kid.depth), kidRows[i - 1].y + STR, X(kid.depth), kid.y - STR, kid.n.status);
			else edge(X(row.depth), row.y + STR, X(kid.depth) - STR, kid.y, kid.n.status);
		});
		if (row.n.kind === "loop" && kidRows.length) {
			const last = kidRows[kidRows.length - 1];
			const bx = X(last.depth) + 15;
			paths += `<path class="edge e-waiting" style="opacity:.55" d="M ${X(last.depth) + STR} ${last.y} C ${bx} ${last.y}, ${bx} ${row.y}, ${X(row.depth) + STR + 2} ${row.y}"/>`;
		}
	}
	for (const row of rows) {
		if (row.n.status === "running" || (row.n.status === "waiting" && row.n.kind === "human")) {
			stations += `<circle class="halo" cx="${X(row.depth)}" cy="${row.y}" r="6"/>`;
		}
		stations += `<circle class="stn s-${statusCls(row.n.status)}" cx="${X(row.depth)}" cy="${row.y}" r="${row.kids.length ? 4.6 : 3.6}"/>`;
	}
	let html = `<div class="runwrap" style="height:${total}px"><svg width="${X0 + 8 * LANE}" height="${total}">${paths}${stations}</svg>`;
	for (const row of rows) {
		const n = row.n;
		const gn = S.bundle?.doc.nodes[n.id];
		let chips = "";
		const c = n.count ?? 0;
		const f = n.fixed ?? 0;
		if (c || f) chips += `<span class="cf">${c ? `<b>${c}</b>` : ""}${f ? `·<i>${f}✓</i>` : ""}</span>`;
		let tags = "";
		if (n.kind === "loop" && n.round) tags += `<span class="rollchip">×${n.round}</span>`;
		if (n.kind === "budget" && gn?.minutes) tags += `<span class="rollchip">≤${gn.minutes}m</span>`;
		const dur = n.startedAt ? `<span class="dur ${n.status === "running" ? "live" : ""}">${nodeDur(n)}</span>` : "";
		const num = row.seqIndex ? `<span style="color:var(--faint);font-size:10px;flex:none;font-family:ui-monospace,monospace">${row.seqIndex}</span>` : "";
		const twist = row.kids.length
			? `<span data-twist="${n.id}" style="color:var(--faint);cursor:pointer;font-family:ui-monospace,monospace;font-size:10px">${row.open ? "▾" : "▸"}</span>`
			: "";
		const ans = n.note && row.kids.length ? `<span class="ans">· ${esc(n.note)}</span>` : "";
		let sub = "";
		if (row.hasSub) sub = `<div class="sub">${esc((n.note || n.output || "").slice(0, 120))}</div>`;
		if (n.kind === "human" && n.status === "waiting") sub = `<div class="sub" style="color:var(--hl)">waiting for you · answer above</div>`;
		const dim = n.status === "pending" || n.status === "skipped" ? "dim" : "";
		html += `<div class="rrow ${dim} ${S.selection === n.id ? "selrow" : ""}" data-node="${n.id}" style="left:${X(row.depth) + 11}px;right:0;top:${row.y - 11}px;height:${row.h}px">${num}<div class="t"><div class="nm"><span class="lbl" ${row.kids.length ? 'style="font-weight:600"' : ""}>${esc(n.title)}</span>${tags}${ans}<span class="rail">${chips}${dur}</span>${twist}</div>${sub}</div></div>`;
	}
	return `${html}</div>`;
}

/* ---------------- board ---------------- */

function render(): void {
	const board = $("board");
	const run = S.run;
	if (!run) {
		board.innerHTML = `<div class="statusline sl-idle"><span class="txt"><b>no runs yet</b> · ${PIN_TARGET ? "Run review starts the first one" : "start one with a target above"}</span></div>`;
		$("nodepane").innerHTML = "";
		return;
	}
	const v = verdict(run);
	const found = run.nodes.reduce((t, n) => t + (n.count ?? 0), 0);
	const fixed = run.nodes.reduce((t, n) => t + (n.fixed ?? 0), 0);
	const cost = run.nodes.reduce((t, n) => t + (n.costUsd ?? 0), 0);
	const settled = run.nodes.filter((n) => !["pending", "running"].includes(n.status)).length;
	const elapsed = fmtDur((run.finishedAt ? Date.parse(run.finishedAt) : Date.now()) - Date.parse(run.startedAt));
	const canResume = !run.live && (run.status === "waiting" || run.status === "failed" || run.status === "running");
	let h = `<div class="statusline ${v.cls}"><span class="txt"><b>${v.word}</b> · ${esc(v.msg)}</span>
		${canResume ? `<button class="btn" id="resume">${run.status === "waiting" ? "Continue" : "Resume"}</button>` : ""}</div>`;
	h += `<div class="statrow">
		<div><div class="k">nodes</div><div class="v">${settled}<em>/${run.nodes.length}</em></div></div>
		<div><div class="k">found</div><div class="v" ${found ? 'style="color:var(--warn)"' : ""}>${found}</div></div>
		<div><div class="k">fixed</div><div class="v" ${fixed ? 'style="color:var(--ok)"' : ""}>${fixed}</div></div>
		<div><div class="k">cost</div><div class="v">$${cost.toFixed(2)}</div></div>
		<div><div class="k">elapsed</div><div class="v">${elapsed}</div></div>
	</div>`;
	// Containers inherit waiting from a parked child; only the human node
	// itself is answerable.
	const waiting = run.nodes.filter((n) => n.kind === "human" && n.status === "waiting");
	if (waiting.length) {
		h += `<span class="meta hd">Needs you</span>`;
		for (const n of waiting) {
			h += `<div class="needcard"><div class="t"><div class="ttl">${esc(n.title)}</div>
			<div class="sub2">${esc((n.output || n.note || "").slice(0, 400))}</div>
			<div class="humanrow"><input class="inp" data-note="${n.id}" placeholder="note (optional)">
			<button class="btn" data-approve="${n.id}">Approve</button>
			<button class="btn ghost" data-reject="${n.id}">Request changes</button></div></div></div>`;
		}
	}
	h += `<span class="meta hd">Run · target: ${esc(run.target)}</span>`;
	h += renderMetro(run);
	if (S.runs.length > 1) {
		h += `<div class="hist"><span class="meta hd">History</span>`;
		for (const r of S.runs) {
			h += `<div class="hrow" data-run="${r.runId}"><span class="when">${r.runId.slice(4, 23)}</span><span>${r.status}</span><span class="tot">${r.found} found · ${r.fixed} fixed · $${r.costUsd.toFixed(2)}</span></div>`;
		}
		h += `</div>`;
	}
	board.innerHTML = h;

	board.querySelector("#resume")?.addEventListener("click", async () => {
		await j(`/api/graphs/${S.graph}/runs/${run.runId}/resume`, { method: "POST" });
		setTimeout(() => void refreshRun(), 500);
	});
	board.querySelectorAll("[data-approve],[data-reject]").forEach((b) => {
		b.addEventListener("click", async () => {
			const el = b as HTMLElement;
			const nodeId = el.dataset.approve ?? el.dataset.reject ?? "";
			const note = (board.querySelector(`[data-note="${nodeId}"]`) as HTMLInputElement | null)?.value ?? "";
			await j(`/api/graphs/${S.graph}/runs/${run.runId}/answer`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ nodeId, approve: "approve" in el.dataset, note }),
			});
			await refreshRun();
		});
	});
	board.querySelectorAll("[data-twist]").forEach((t) => {
		t.addEventListener("click", (ev) => {
			ev.stopPropagation();
			const id = (t as HTMLElement).dataset.twist as string;
			const row = S.run?.nodes.find((n) => n.id === id);
			const open = (t as HTMLElement).textContent === "▾";
			S.expand[id] = !open;
			void row;
			render();
		});
	});
	board.querySelectorAll(".rrow").forEach((r) => {
		r.addEventListener("click", () => {
			S.selection = (r as HTMLElement).dataset.node ?? null;
			render();
			void showNode();
		});
	});
	board.querySelectorAll(".hist .hrow").forEach((r) => {
		r.addEventListener("click", () => {
			S.runId = (r as HTMLElement).dataset.run ?? S.runId;
			($("run-select") as HTMLSelectElement).value = S.runId;
			S.selection = null;
			void refreshRun();
		});
	});
}

/* ---------------- node pane ---------------- */

let nodeTab: "reply" | "prompt" | "input" = "reply";

async function showNode(): Promise<void> {
	const pane = $("nodepane");
	if (!S.selection || !S.run) {
		pane.innerHTML = `<h2>Pick a node</h2><p class="sub3">click a station on the left · its prompt, input, reply, session, and cost land here</p>`;
		return;
	}
	const data = await j<{ node: RunNode | null; prompt: string; input: string; reply: string }>(
		`/api/graphs/${S.graph}/runs/${S.run.runId}/node/${S.selection}`,
	);
	const n = data.node;
	if (!n) return;
	const chips = [
		n.kind,
		n.status,
		n.round ? `round ${n.round}` : "",
		n.count ? `${n.count} findings` : "",
		n.startedAt ? nodeDur(n) : "",
		n.costUsd !== undefined ? `$${n.costUsd.toFixed(4)}` : "",
	]
		.filter(Boolean)
		.map((c) => `<span class="badgechip">${esc(String(c))}</span>`)
		.join("");
	const text = nodeTab === "reply" ? data.reply : nodeTab === "prompt" ? data.prompt : data.input;
	pane.innerHTML = `<h2>${esc(n.title)}</h2>
	<p class="sub3">${n.id}${n.sessionId ? ` · dots debug ${S.graph} ${n.id} → resumes session ${n.sessionId.slice(0, 8)}…` : ""}</p>
	<div>${chips}</div>
	${n.note ? `<p style="font-size:12px;color:var(--muted)">${esc(n.note)}</p>` : ""}
	<div class="tabs">
		<button data-tab="reply" class="${nodeTab === "reply" ? "on" : ""}">Reply</button>
		<button data-tab="prompt" class="${nodeTab === "prompt" ? "on" : ""}">Prompt</button>
		<button data-tab="input" class="${nodeTab === "input" ? "on" : ""}">Input</button>
	</div>
	<pre>${esc(text || "(empty)")}</pre>`;
	pane.querySelectorAll("[data-tab]").forEach((b) => {
		b.addEventListener("click", () => {
			nodeTab = (b as HTMLElement).dataset.tab as typeof nodeTab;
			void showNode();
		});
	});
}

/* ---------------- boot ---------------- */

async function main(): Promise<void> {
	const theme = PARAMS.get("theme");
	if (theme === "dark" || theme === "light") {
		document.documentElement.dataset.theme = theme;
	}
	if (EMBED) document.body.classList.add("embed");
	const graphs = (await j<{ graphs: string[] }>("/api/graphs")).graphs;
	const gsel = $("graph-select") as HTMLSelectElement;
	gsel.innerHTML = graphs.map((g) => `<option>${g}</option>`).join("");
	const params = new URLSearchParams(location.search);
	S.graph = params.get("g") && graphs.includes(params.get("g") as string) ? (params.get("g") as string) : graphs[0] ?? "";
	gsel.value = S.graph;
	($("cwd") as HTMLInputElement).value = PIN_CWD;
	if (PIN_TARGET) {
		($("target") as HTMLInputElement).value = PIN_TARGET;
		($("target") as HTMLInputElement).readOnly = true;
		($("start") as HTMLElement).textContent = "Run review";
	}
	gsel.addEventListener("change", async () => {
		S.graph = gsel.value;
		S.runId = "";
		S.selection = null;
		await refreshRuns();
		await refreshRun();
	});
	const rsel = $("run-select") as HTMLSelectElement;
	rsel.addEventListener("change", () => {
		S.runId = rsel.value;
		S.selection = null;
		void refreshRun();
	});
	$("start").addEventListener("click", async () => {
		const target = ($("target") as HTMLInputElement).value.trim();
		const cwd = ($("cwd") as HTMLInputElement).value.trim();
		if (!target) return alert("a run needs a target");
		const res = await j<{ runId?: string; error?: string }>(`/api/graphs/${S.graph}/runs`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ target, cwd }),
		});
		if (res.error) return alert(res.error);
		S.runId = res.runId ?? "";
		await refreshRuns();
		await refreshRun();
	});
	if (S.graph) {
		S.bundle = await j(`/api/graphs/${S.graph}`);
		await refreshRuns();
		await refreshRun();
	}
	await showNode();
	setInterval(async () => {
		if (!S.run) return;
		if (S.run.status === "running" || S.run.live || S.run.status === "waiting") {
			await refreshRuns();
			await refreshRun();
		}
	}, 2000);
}

void main();
