# Changelog

All notable changes to opencode-mediator are documented here.

## [0.1.0] - 2026-10-08

### Added

- **Mediator primary agent** (agents/mediator.md) — iterative intent discovery with strict approval gate (V2: only `approve / go / proceed / ship it` or explicit green light).
- **Refiner hidden subagent** (agents/refiner.md) — emits JSON patches against the Mediator's prompt.
- **Recorder plugin** (lib/ + plugins/) — the trust boundary; subscribes to 7 opencode events, writes JSONL records via the single-writer queue (D21), updates provenance.
- **Dual-channel prompt modification** (D2) — file write + in-session `output.context.push` on `experimental.session.compacting`, atomic.
- **Empirical evaluation** (V9) — 1 record flags, 3 records confirm. Status: `pending | resolved | invalidated`. Per-section branches (D19) with marker commits on invalidation.
- **Provenance retention** (V5) — live cap at 5 record_ids per section, archive for the rest. Status field (D20).
- **Adversarial evaluator** (D17, V6) — second-LLM critic on `op: "remove"` and `refined_count >= 2`. Uses `oracle`/`momus` from oh-my-opencode when detected, built-in critic fallback otherwise.
- **User checkpoint** (V7) — high-risk ops use opencode's permission ask flow via a registered hidden tool `apply_refiner_patch` (Q3 programmatic registration).
- **Negative-framing ratio** (V12, D15) — 0.5 cap per section; re-frame or escalate.
- **Hard-never rules** (V11) — URL hallucination, sycophancy preserved in negative framing.
- **Pattern library** — 9 seed failure-mode tags.
- **Parent-child session lifecycle** (V4, D30) — out-of-band handoff via `client.session.create({ parentID, agent: "assistant" })`.
- **Per-section branches** (D19) — Refiner commits land on `refiner/<section_id>`, merge to `main` requires empirical-evaluation pass.
- **Section merge pass** (D16) — Refiner-driven merge at 8000 tokens.
- **lat.md knowledge graph** — 22 graph pages in `docs/graphs/`; symlink entry at `lat.md`; skill symlink at `.agents/skills/lat-md/SKILL.md`.
- **lat-md-enforce plugin** (forked from snowrabbit with attribution) — hard enforcement of lat.md consultation rule.
- **CI** — bun test on ubuntu-latest + macos-latest; lat.md check as blocking gate; pilotty CI gated by `run-pilotty` label.
- **install.sh / uninstall.sh / upgrade.sh** — race-safe (pgrep), atomic writes, user-data preservation.
- **Skip-env vars** — `OPENCODE_MEDIATOR_SKIP_LAT_CHECK` (hooks), `_SKIP_LAT_ENFORCE` (plugin), `_SKIP_LAT_INSTALL` (install).
- **Privacy** — records directory `chmod 600` on first write (D25).

### Notes

- 12 vague items (V1-V12) and 30 core decisions (D1-D30) locked from intent doc.
- Plan v1.1 (post-momus + post-oracle review) is the source of truth.
- Snowrabbit attribution: docs/agents/lat-md-authoring.md and .opencode/plugins/lat-md-enforce.ts are forked with attribution.
