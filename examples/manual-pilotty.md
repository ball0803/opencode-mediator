# Manual pilotty end-to-end run

> **Dev-only.** This file is **not** run in CI. It exists to let a human
> operator run the full Mediator → Refiner loop against a real opencode
> session, using [pilotty](https://github.com/sst/pilotty) to drive a
> tmux session and observe the agent in real time.
>
> Tagged `@skip-ci` so the CI gate (lat.md) ignores it. If you copy-paste
> commands from this file, set `OPENCODE_MEDIATOR_SKIP_LAT_CHECK=1` first.

## Prerequisites

- A working `opencode-mediator` install (`./install.sh` from the repo).
- `pilotty` on PATH (`cargo install pilotty` or `brew install pilotty`).
- A clean git working tree (the run will create `refiner/<section_id>` branches).
- The lat.md skip envs set:
  ```sh
  export OPENCODE_MEDIATOR_SKIP_LAT_CHECK=1
  export OPENCODE_MEDIATOR_SKIP_LAT_ENFORCE=1
  ```

## Step 1 — Start a pilotty session

```sh
pilotty new --name mediator-e2e
pilotty attach mediator-e2e
```

In the tmux pane, start opencode with the Mediator agent:

```
> opencode --agent mediator
```

You should see the Mediator's first message: "What are we trying to achieve?"

## Step 2 — Drive a full iteration

Type the following user turn, then watch the Mediator's response:

```
I want to add dark mode to my blog. I use Astro. I want it to respect the
system preference but also have a manual toggle in the header. I want the
toggle to be persistent across visits.
```

The Mediator should iterate: ask one clarifying question, then present a
summary. Type `approve` (not `yes`, not `ok`) to advance. The strict
approval gate (V2) is enforced; bare `yes` is rejected by the recorder.

## Step 3 — Complete the work

Switch to the `build` agent:

```
> opencode --agent build
```

Implement the dark-mode toggle. When done, return to the Mediator session:

```
> opencode --agent mediator --resume <session-id>
```

## Step 4 — Spawn the Refiner

The Mediator spawns a Refiner child session when it has 3+ records with a
consistent pattern. To trigger manually, type:

```
refine
```

The Refiner reads `~/.local/share/opencode/mediator/records/<session>.jsonl`,
extracts the pattern, and emits a patch. The `apply_refiner_patch` tool
fires opencode's permission dialog — click **Allow**.

## Step 5 — Verify the empirical-eval loop

After the patch lands, observe:

```sh
git log --oneline -5
# expect: a commit on the refiner/<section_id> branch
cat ~/.local/share/opencode/mediator/prompts/mediator.md | head -40
# expect: the revised section body
```

Run three more iterations of the same scenario. The recorder marks the
patch `resolved` after 3 records show the pattern is gone, or
`invalidated` (and reverts) if the pattern persists.

## Cleanup

```sh
pilotty kill mediator-e2e
unset OPENCODE_MEDIATOR_SKIP_LAT_CHECK
unset OPENCODE_MEDIATOR_SKIP_LAT_ENFORCE
```

## What to record

If you hit a bug, save the full pilotty log and the records JSONL:

```sh
pilotty log mediator-e2e > /tmp/mediator-e2e.log
cp ~/.local/share/opencode/mediator/records/<session>.jsonl /tmp/
```

Open an issue with both files attached.
