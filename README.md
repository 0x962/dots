# dots

Agent flows as graphs that you can see. Define an agent process as a tree
of nodes, store it as plain files, run it, and watch it on a live board.

## What it is

dots has three parts:

- An editor at `http://localhost:4517`. Draw the flow on a canvas: add
  nodes, nest them in containers, and edit each node's instructions in a
  markdown editor. The layout comes from the tree, so there are no
  positions to manage. Every change autosaves to disk.
- A runner (`./dots run <graph> --target <text>`). A deterministic
  scheduler walks the tree and spawns one agent per node. The node's
  prompt arrives on stdin. Run state lands in
  `graphs/<name>/runs/<runId>.json`, and each node's transcript lands in
  `runs/<runId>.d/`.
- A run board at `http://localhost:4517/runs`. The board shows the same
  diagram as the editor, lit by live status. Click a node to read its
  reply, its exact prompt, and its input, or to re-run it.

The repository includes an example graph (`hello`) and a multi-agent code
review graph (`review`), whose checkers post their findings as local
review comments through [margin](https://github.com/0x962/margin).

## Requirements

- [Bun](https://bun.sh)
- An agent CLI. The default command is
  `claude -p --dangerously-skip-permissions`. Set `DOTS_AGENT_CMD` to use
  a different one.

## Run

1. Install the dependencies: `bun install`.
2. Start the server: `bun dev`.
3. Open `http://localhost:4517` and select or create a graph.
4. Run a graph: `./dots run hello --target "some input"`.
5. Watch the run at `http://localhost:4517/runs`.

## Node kinds

- `agent` does work. It runs once and returns an output for the next
  node. Anything it reports, it delivers itself; the framework tracks no
  findings of its own.
- `gate` is an if/else. Its agent answers exactly `YES` or `NO`, and the
  flow runs that branch. The branch not taken is skipped.
- `sequence` runs its children in order and passes each output forward. A
  failure halts the rest.
- `parallel` starts every child at once. A child's failure spares its
  siblings.
- `budget` is a time box. On expiry, everything unfinished inside fails.
- `loop` runs its children as a round, then asks its exit question. DONE
  moves on, AGAIN starts the next round, capped by `maxRounds`.
- `human` parks the run until a person answers on the board.

## One folder per graph

```
graphs/<name>/
  graph.json     structure and per-node settings
  briefing.md    what every node's agent reads before its instructions
  nodes/<id>.md  instructions for agent, gate, and human nodes;
                 the exit question for loop nodes
  runs/          run state, written by the runner
```

Every file is hand-editable. The editor and the files stay in sync
through full-folder saves.

## The CLI

```
dots run <graph> --target <text>   start a run (--var K=V fills {K})
dots runs                          list run history
dots plan <graph>                  print the tree
dots show <graph> <node>           print a node's verdict and reply
dots retry <graph> <node>          re-run one node with its recorded input
dots debug <graph> <node>          resume the node's agent session
dots ask <graph> <node> "<q>"      ask one question, log the answer
dots approve | dots reject         answer a parked human node
dots resume                        carry an interrupted run on
```

Every node leaves three files in `runs/<runId>.d/`: `<node>.prompt.txt`
(what its agent was told), `<node>.input.txt` (what it received), and
`<node>.txt` (its whole reply). The run file adds timing, cost, and the
agent session id.

## Stack

Bun serves the pages and bundles the client from `src/client/`. React 18,
@xyflow/react for the canvas, TipTap for the markdown editors, zustand
for editor state. `src/core/` (types, store, runner, prompt, validate)
has no client dependencies and is what the CLI uses.
