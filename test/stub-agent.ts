/**
 * Stands in for the real agent in runner tests. Reads the node's prompt on
 * stdin like the real thing, then answers from the per-node script in the
 * JSON file at DOTS_STUB_FILE:
 *   reply     the text to print (default: "OUTPUT from <id>")
 *   seq       replies per call; calls counted in DOTS_STUB_STATE/<id>
 *   expect    print "SAW: <expect>" when stdin contains it, else "MISSED"
 *   delayMs   sleep before answering (budget tests)
 *   exit      exit with this code instead of answering
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const id = process.env.DOTS_NODE_ID ?? "?";
const cfg =
	(JSON.parse(readFileSync(process.env.DOTS_STUB_FILE ?? "", "utf8")) as Record<string, {
		reply?: string;
		seq?: string[];
		expect?: string;
		delayMs?: number;
		exit?: number;
	}>)[id] ?? {};
const input = readFileSync(0, "utf8");
if (cfg.delayMs) await Bun.sleep(cfg.delayMs);
if (cfg.exit) process.exit(cfg.exit);
let reply = cfg.reply ?? `OUTPUT from ${id}`;
if (cfg.seq) {
	const stateDir = process.env.DOTS_STUB_STATE ?? "/tmp";
	mkdirSync(stateDir, { recursive: true });
	const path = join(stateDir, id);
	let n = 0;
	try {
		n = Number(readFileSync(path, "utf8"));
	} catch {
		// first call
	}
	writeFileSync(path, String(n + 1));
	reply = cfg.seq[Math.min(n, cfg.seq.length - 1)];
}
if (cfg.expect) reply = input.includes(cfg.expect) ? `SAW: ${cfg.expect}` : "MISSED";
console.log(reply);
