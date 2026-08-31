# dots

Agent flows as graphs you can see. Define a review (or any agent process) as
a tree of nodes on a canvas, store it as plain files, run it, and watch it.

## The pieces

- **Editor** (`bun dev`, then http://localhost:4517): a canvas graph builder.
- **Runner** (`./dots run <graph> --target <text>`): a deterministic
  scheduler walks the tree and spawns one agent per node (the prompt arrives
  on stdin; the command comes from `DOTS_AGENT_CMD`, default `claude -p
  --dangerously-skip-permissions`). Run state lands in
  `graphs/<name>/runs/<runId>.json` after every transition, transcripts in
  `runs/<runId>.d/`. `dots approve|reject` answers a parked human node,
  `dots resume` carries a run on, `dots plan` prints the tree, `dots runs`
  lists history. `--var K=V` fills `{K}` in briefing and instructions.
- **Run view**: planned; the live metro board for a running graph.
- **Canary DE integration**: planned; the desktop app consumes all three.

## Node kinds

- `agent` does work: read-only, returns an output plus findings.
- `gate` answers `YES: <focus>` or `NO: <reason>`; NO prunes its subtree.
- `parallel` starts every child at once; a child's failure spares siblings.
- `sequence` runs children in order, passing each output forward; a failure
  halts the rest.
- `budget` is a time box; on expiry, everything unfinished inside fails.
- `loop` runs its children as a round, then asks its exit question:
  DONE moves on, AGAIN starts the next round, capped by `maxRounds`.
- `human` parks until a person answers on the board.

## One folder per graph

```
graphs/<name>/
  graph.json     structure, per-node settings, canvas positions
  briefing.md    what the lead reads before the tree
  nodes/<id>.md  instructions for agent, gate, and human nodes;
                 the exit question for loop nodes
  runs/          run state, written by the execution layer
```

Everything is hand-editable; the editor and the files stay in sync through
full-folder saves.
