# opencode-mediator

A Mediator agent + Refiner subagent for [opencode](https://opencode.ai). Iteratively clarifies user intent with strict approval gates; a Refiner subagent distills the observed records into prompt patches against the Mediator's prompt. A recorder plugin is the trust boundary; dual-channel prompt modification keeps the active session live.

## What is Mediator/Refiner

The Mediator is a primary opencode agent that runs **before** the work begins. It enforces a strict approval gate — only `approve`, `go`, `proceed`, or `ship it` counts, never bare `yes`/`ok`/`thanks`/`looks good` (V2, D6). The Mediator iterates: parse a `WorkingIntent`, ask the next clarifying question or present a summary, record the iteration, and end when the user explicitly approves. A working intent has six fields:

- **goal** — what we're trying to achieve
- **constraints** — non-negotiables
- **context** — background the user has shared
- **success_criteria** — what "done" looks like
- **out_of_scope** — what we are *not* doing
- **open_questions** — what still needs answers

The Refiner is a hidden subagent (D24) that runs **after** the work lands. It reads the recorded JSONL record chain from `~/.local/share/opencode/mediator/records/`, extracts the success/failure patterns, and emits a structured *patch* against `prompts/mediator.md`. The patch goes through a permission dialog (`apply_refiner_patch`, D18) and lands on a per-section branch `refiner/<section_id>` (D19). After three records confirm the pattern is gone, the patch is marked `resolved`; after three confirm the pattern persists, it is `invalidated` and the section is reverted (V9, D20).

The recorder plugin is the **trust boundary** (D1). The agent never self-records; every event is observed from outside the LLM context. Chain mutation is serialized through a `KeyedMutex` (D22), and record writes go through a `JsonlWriter` single-writer Promise queue (D21).

## Install

```sh
# from the repo root
./install.sh
```

This copies:
- `plugins/` to `~/.config/opencode/plugin/opencode-mediator/`
- `agents/`, `prompts/`, `commands/` to `~/.config/opencode/agent/mediator/`, etc.
- Registers the plugin and agents in `~/.config/opencode/opencode.json` (additive — your existing config is preserved).
- Installs `lat.md` (v0.12.2) for the knowledge-graph enforcement gate.
- `chmod 600`'s the records directory (D25).

After install, the Mediator agent is available via `agent=mediator` in opencode. The Refiner is not directly invokable — the Mediator spawns it as a child session (D30, 1-child-per-parent).

## Uninstall

```sh
./uninstall.sh
```

Removes the plugin and agents from your opencode config, deletes the installed files, and (optionally, with `--purge-records`) wipes the records directory. The repo directory itself is left in place.

## Upgrade

```sh
./upgrade.sh
```

Pulls the latest, re-runs the install, and preserves your records directory. The upgrade is idempotent: running it twice is safe.

## Troubleshooting

**`lat.md` is not on PATH** — `install.sh` installs it via `npm i -g lat.md@0.12.2`. If you use a Node version manager, ensure your `npm` global bin is on PATH. You can skip the install with `OPENCODE_MEDIATOR_SKIP_LAT_INSTALL=1` and install manually.

**Plugin fails to load** — check `~/.config/opencode/opencode.json` for the entry under `plugin`. The plugin path must be absolute. Use `OPENCODE_MEDIATOR_SKIP_LAT_ENFORCE=1` to bypass the lat gate during debugging.

**`mediator_emit_intent` rejected with "requires explicit approval"** — your last message was a bare `yes`/`ok`/`thanks`/`looks good`. The Mediator is correct to reject (V2). Say one of: `approve`, `go`, `proceed`, `ship it`. The summary itself is approved if the last message is `looks good` / `ship it` / `that works` and there are zero open questions (V3).

**Patch rejected for "negative-framing ratio > 0.5"** — the Refiner emitted a section whose negative-clause density exceeds the threshold (V12). Re-run the Refiner with the same records; the adversarial evaluator (D17) should catch this. If it persists, edit the prompt manually.

**Session won't spawn a Refiner child** — v1 limits each parent session to exactly one child (D30). Wait for the existing child to complete, or end the parent session first.

**CI fails on the `lat.md` gate** — the gate is a blocking quality check. If you need to bypass it for an emergency merge, set `OPENCODE_MEDIATOR_SKIP_LAT_CHECK=1` in the workflow environment. The skip-env is auditable in the workflow log.

## Privacy

Records persist locally at `~/.local/share/opencode/mediator/records/`. The records directory is `chmod 600`'d on first write (D25). Do not symlink this directory into a shared location — records contain the full user-message / mediator-response chain and may include sensitive context. The Refiner reads only the local records file; it does not contact any network endpoint.

The plugin does not call any external service. It writes to local files only. The `apply_refiner_patch` tool is permission-`ask` (D18): every patch requires a human click in opencode's permission dialog. The `mediator_emit_intent` tool is invoked by the agent under the same permission model.

## Skip-env vars

| Env | Effect |
|---|---|
| `OPENCODE_MEDIATOR_SKIP_LAT_CHECK=1` | Bypasses pre-commit/pre-push lat check. |
| `OPENCODE_MEDIATOR_SKIP_LAT_ENFORCE=1` | Bypasses the plugin's lat enforcement. |
| `OPENCODE_MEDIATOR_SKIP_LAT_INSTALL=1` | Bypasses the install.sh lat.md install. |
| `OPENCODE_MEDIATOR_PROMPT_PATH` | Override the mediator prompt file path. Defaults to `~/.local/share/opencode/mediator/prompts/mediator.md`. |

## For the full picture

- **Intent doc** (source of truth for design): `docs/intent/mediator-and-refiner.md`
- **Implementation plan** (14 phases, ~70 steps): `docs/plan/implementation-plan.md`
- **Knowledge graph** (22 pages): `docs/graphs/`
- **Examples** (dev-only pilotty manual run): `examples/manual-pilotty.md`

## Status

Pre-release. Implementation in progress. See the implementation plan for the 14-phase rollout.
