import index from "./client/index.html";
import { listGraphs, loadGraph, saveGraph } from "./core/store";
import type { GraphBundle } from "./core/types";
import { validateGraph } from "./core/validate";

const PORT = Number(process.env.DOTS_PORT ?? 4517);

const server = Bun.serve({
	port: PORT,
	routes: {
		"/": index,
		"/api/graphs": {
			GET: async () => Response.json({ graphs: await listGraphs() }),
		},
		"/api/graphs/:name": {
			GET: async (req) => {
				try {
					return Response.json(await loadGraph(req.params.name));
				} catch (error) {
					return Response.json(
						{ error: error instanceof Error ? error.message : String(error) },
						{ status: 404 },
					);
				}
			},
			PUT: async (req) => {
				const bundle = (await req.json()) as GraphBundle;
				const errors = validateGraph(bundle);
				if (errors.length > 0) {
					return Response.json({ ok: false, errors }, { status: 422 });
				}
				await saveGraph(req.params.name, bundle);
				return Response.json({ ok: true, errors: [] });
			},
		},
	},
});

console.log(`dots editor · http://localhost:${server.port}`);
