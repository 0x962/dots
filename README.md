# dots

Agent flows as graphs you can see. Define a review (or any agent process) as
a tree of nodes, store it as plain files, run it, and watch it.

## The pieces

- **Editor** (`bun dev`, then http://localhost:4517): a React canvas over
  React Flow, styled after Linear. The flow reads as a flowchart: a Start
  terminal (click it to edit the shared context every agent reads), the
  steps, an End terminal. A container draws as a pair of bracket lines, an
  opening line above its children and a closing line below, with a circled
  kind icon on the opening line beside the flow arrow. A sequence stacks
  its children with numbered arrows; parallel and budget children sit in a
  grid between the brackets. A gate is an if/else decision point on the
  line: a YES lane and a NO lane hang under its card, either lane can hold
  nodes, and an empty lane is a bare bracket. Layout is computed
  from the tree, so nothing overlaps and there are no positions to manage.
  Drag a card onto a frame or lane to reparent it, drag a kind from the
  Insert palette, or click a kind to add it into the selection. The left
  panel holds the graph list (new, duplicate, delete), the palette, and an
  outline; the right panel (resizable) edits the selected node, and
  Enter/double-click opens a full-screen TipTap prompt editor that reads
  and writes the markdown files on disk (a Raw tab shows the text) and can
  test-run the one node from a side pane. Every change autosaves about a
  second after typing stops; a graph that does not validate is held in
  memory and the issues pill says why. Undo/redo (⌘Z) and Run live in the
  top bar.
- **Runner** (`./dots run <graph> --target <text>`): a deterministic
  scheduler walks the tree and spawns one agent per node (the prompt arrives
  on stdin; the command comes from `DOTS_AGENT_CMD`, default `claude -p
  --dangerously-skip-permissions`). Run state lands in
  `graphs/<name>/runs/<runId>.json` after every transition, transcripts in
  `runs/<runId>.d/`. `dots approve|reject` answers a parked human node,
  `dots resume` carries a run on, `dots plan` prints the tree, `dots runs`
  lists history. `--var K=V` fills `{K}` in briefing and instructions.
- **Inspect and debug**: every node leaves `runs/<runId>.d/<node>.prompt.txt`
  (exactly what its agent was told), `<node>.input.txt` (what it received),
  and `<node>.txt` (its whole reply); the run file adds timing, cost, and
  the agent session id. `dots show <graph> <node>` prints a node's verdict
  and reply (`--prompt` / `--reply` for the raw files), `dots retry` re-runs
  one node with its recorded input and the graph's current instructions
  (edit `nodes/<id>.md`, retry, read), and `dots debug` resumes the node's
  actual claude session to ask it why. `dots ask <graph> <node> "<question>"`
  asks one question non-interactively and logs the answer beside the run;
  every node's prompt carries the same command, so a later agent questions
  an earlier one instead of guessing about its work.
- **Run board** (http://localhost:4517/runs): the same diagram as the
  editor, lit by live status. Cards show state as a corner dot plus one
  quiet line (a gate's verdict, a skip reason) and the duration; the lane a
  gate did not take dims; loop frames show the round; container headers
  show settled-over-total progress; the End terminal shows the run's
  verdict. A stat strip carries the verdict, target, nodes, and elapsed.
  Click a node for its drawer: reply rendered as markdown, the exact
  prompt and input, the session id, a Re-run button (recorded input,
  current instructions), and Approve / Request changes on a parked human
  node. Runs start from the New run dialog (target, cwd, `{KEY}`
  variables) and execute as a detached runner child of the server; the
  page polls the run file. `?embed=1&target=&cwd=&theme=` strips the
  chrome and pins the page to one target, for a host app's pane.
- **Canary DE integration**: planned; the desktop app consumes all three.

## Node kinds

- `agent` does work: runs once and returns an output for the next node.
  Anything it reports it delivers itself (the review graph's checkers post
  local review comments with `cde pr comments add`); the framework tracks
  no findings of its own.
- `gate` is an if/else: its agent answers exactly `YES` or `NO`, the flow
  runs that branch (`children` on YES, `elseChildren` on NO), and the
  branch not taken is skipped.
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
  graph.json     structure and per-node settings
  briefing.md    what every node's agent reads before its instructions
  nodes/<id>.md  instructions for agent, gate, and human nodes;
                 the exit question for loop nodes
  runs/          run state, written by the execution layer
```

Everything is hand-editable; the editor and the files stay in sync through
full-folder saves. The server also creates and deletes graph folders
(`POST /api/graphs`, `DELETE /api/graphs/:name`) for the editor's graph
list.

## Stack

Bun serves both pages and bundles the client from source (`src/client/`),
React 18, @xyflow/react for the canvas, TipTap (+ tiptap-markdown) for the
markdown editors, marked + DOMPurify for rendered replies, zustand for
editor state, lucide-react for icons. `src/core/` (types, store, runner,
prompt, validate) has no client dependencies and is what the CLI uses.
