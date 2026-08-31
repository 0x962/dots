import type { GraphBundle, GraphRun, RunNode } from "../../core/types";

export interface RunSummary {
	runId: string;
	status: string;
	target: string;
	startedAt: string;
	finishedAt: string | null;
	costUsd: number;
	live: boolean;
}

export interface NodeDetail {
	node: RunNode | null;
	prompt: string;
	input: string;
	reply: string;
	/** The live tail of the agent's work, grown while the node runs. */
	stream: string;
}

export type LiveRun = GraphRun & { live?: boolean };

async function j<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, init);
	const body = (await res.json()) as T & { error?: string; errors?: string[] };
	if (!res.ok) {
		throw new Error(body.error ?? body.errors?.join(" · ") ?? `${res.status} on ${url}`);
	}
	return body;
}

const post = (payload: unknown): RequestInit => ({
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify(payload),
});

export const api = {
	graphs: () => j<{ graphs: string[] }>("/api/graphs").then((r) => r.graphs),
	graph: (name: string) => j<GraphBundle>(`/api/graphs/${name}`),
	saveGraph: (name: string, bundle: GraphBundle) =>
		j<{ ok: boolean; errors: string[] }>(`/api/graphs/${name}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(bundle),
		}),
	createGraph: (name: string, from?: string) =>
		j<{ ok: boolean }>("/api/graphs", post({ name, from })),
	deleteGraph: (name: string) =>
		j<{ ok: boolean }>(`/api/graphs/${name}`, { method: "DELETE" }),

	runs: (graph: string) =>
		j<{ runs: RunSummary[] }>(`/api/graphs/${graph}/runs`).then((r) => r.runs),
	run: (graph: string, runId: string) =>
		j<LiveRun>(`/api/graphs/${graph}/runs/${runId}`),
	startRun: (graph: string, body: { target: string; cwd?: string; vars?: Record<string, string> }) =>
		j<{ runId: string }>(`/api/graphs/${graph}/runs`, post(body)),
	nodeDetail: (graph: string, runId: string, nodeId: string) =>
		j<NodeDetail>(`/api/graphs/${graph}/runs/${runId}/node/${nodeId}`),
	answer: (graph: string, runId: string, nodeId: string, approve: boolean, note?: string) =>
		j<{ ok: boolean }>(`/api/graphs/${graph}/runs/${runId}/answer`, post({ nodeId, approve, note })),
	resume: (graph: string, runId: string) =>
		j<{ ok: boolean }>(`/api/graphs/${graph}/runs/${runId}/resume`, post({})),
	testNode: (
		graph: string,
		body: {
			nodeId: string;
			target: string;
			input?: string;
			cwd?: string;
			vars?: Record<string, string>;
			instructions?: string;
			briefing?: string;
		},
	) => j<{ runId: string }>(`/api/graphs/${graph}/test-node`, post(body)),
	retryRunNode: (graph: string, runId: string, nodeId: string) =>
		j<{ ok: boolean }>(`/api/graphs/${graph}/runs/${runId}/retry-node`, post({ nodeId })),
};
