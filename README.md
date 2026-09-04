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
- A coding-agent CLI. dots ships two harnesses: `claude`
  ([Claude Code](https://claude.ai/code)) and `pi`
  ([@mariozechner/pi-coding-agent](https://github.com/badlogic/pi-mono)).
  Install the one you run nodes in. See [Harnesses](#harnesses).

## Run

1. Install the dependencies: `bun install`.
2. Start the server: `bun dev`.
3. Open `http://localhost:4517` and select or create a graph.
4. Run a graph: `./dots run hello --target "some input"`.
5. Watch the run at `http://localhost:4517/runs`.

## Harnesses

A harness is the coding-agent CLI one node's agent runs in. dots spawns one
process per node, writes the node's prompt to its stdin, and reads the
reply, the session id, and the cost back off its stdout.

| Harness | CLI | Models |
|---|---|---|
| `claude` | `claude` | the Claude models |
| `pi` | `pi` | Vercel AI Gateway, OpenRouter, and the model providers direct |

Pi is the way to run a node on a model Anthropic does not make. Install it
with `npm i -g @mariozechner/pi-coding-agent`.

A node's own choice wins, then the graph's, then `--harness` on the run,
then `DOTS_HARNESS`, then `claude`. Pick a node's harness and model in the
editor's inspector, or write them into `graph.json`:

```json
{
  "harness": "pi",
  "nodes": {
    "correctness": {
      "kind": "agent",
      "title": "Correctness",
      "children": [],
      "harness": "pi",
      "model": "vercel-ai-gateway/meta/muse-spark-1.1",
      "effort": "high"
    }
  }
}
```

A model name goes to the harness verbatim, so it is spelled the harness's
way: a claude alias or id (`opus`, `claude-opus-5`) for claude,
`<provider>/<model id>` for pi (`vercel-ai-gateway/meta/muse-spark-1.1`).

The inspector does not keep a list of models. It asks the server, which
runs `pi --list-models`, so the models offered are the ones pi really
reaches on this machine today. The provider dropdown is the first segment
of the pi model name; picking one filters the model list. `Reload the
model list` throws away the server's cached answer, which is what to press
after upgrading pi or adding a key.

### Effort

`effort` is how hard the model thinks before it answers. The two harnesses
disagree on both the flag and the levels, and dots never translates between
them:

| Harness | Flag | Levels |
|---|---|---|
| `claude` | `--effort` | low, medium, high, xhigh, max |
| `pi` | `--thinking` | off, minimal, low, medium, high, xhigh |

So an effort only means something beside the harness it was chosen for, and
changing a node's harness starts its model and its effort again from the new
harness's values. Not every model
thinks: `pi --list-models` says which do, and the inspector greys the effort
out on a model that does not.

Two differences to know before you move a node to pi:

- A time budget cannot warn a pi node. Claude reads stdin while it works,
  so dots sends it "5 minutes left" notices; `pi -p` reads the prompt and
  closes stdin. A pi node under a budget is still killed on expiry, it just
  gets no warning first.
- A pi node's margin comments carry no session pointer. Claude takes its
  session id up front, so `$CLAUDE_SESSION_ID` is set before the agent
  runs; pi names its own session and reports it afterwards. The run file
  records that id either way, so `dots debug` and `dots ask` work on both.

### Vercel AI Gateway

One key reaches every vendor. Get it from
[vercel.com/dashboard/ai-gateway](https://vercel.com/dashboard/ai-gateway).

Put it in pi's own auth file, not in your shell:

```json
// ~/.pi/agent/auth.json
{ "vercel-ai-gateway": "vck_..." }
```

A key exported in a shell reaches a `dots run` you type yourself and nothing
else. The dots server normally runs under launchd, whose environment carries
`PATH` and nothing more, so a run started from the board or by `dots start`
spawns a pi that cannot see it. Every process running as you reads
`auth.json`, which is why the key belongs there.

Pi ships its model list with each release, so the newest gateway models are
missing from a pi that is a few weeks old. `~/.pi/agent/models.json` fills
them in; see [pi's models doc](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md).
`pi --list-models` prints what a key reaches.

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
                                   --harness claude|pi sets the run default
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
