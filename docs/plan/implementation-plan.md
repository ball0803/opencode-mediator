# Mediator + Refiner — Implementation Plan

> **Plan version:** 1.1 (locked 2026-10-08, post-review)
> **Status:** Momus (plan critic) + Oracle (high-IQ reviewer) feedback applied. All 3 Momus findings (M1-M3), 5 Oracle open-question responses (Q1, Q3, Q4, Q6, Q7), 1 Oracle critical (S1), and 11 Oracle risk mitigations (S3-S12) incorporated.

---

## 1. Meta

### 1.1 Sources of truth

| Source | Use |
|---|---|
| `/home/camel/.config/opencode/intent/mediator-and-refiner.md` | Intent doc (351 lines). Source of truth for design. **All 12 vague items locked 2026-10-08.** |
| `/home/camel/Desktop/Project/snowrabbit/` | Reference (READ-ONLY). Used for lat.md setup pattern, hook pattern, authoring guide, enforce plugin. |
| https://arxiv.org/abs/2602.07338 | Liu et al. 2026 — Mediator-Assistant + Refiner framework theory. |
| https://www.synscribe.com/blog/how-anthropic-builds-claudes-system-prompts-ai-harnesses-engineering | Synscribe article — prompt-craft style source (positive framing, value framing, named sections). |
| https://opencode.ai/docs/ | Opencode docs (config, plugins, agents, server, rules, skills, custom-tools, MCP). |
| https://github.com/vercel-labs/lat.md | lat.md CLI tool (version pinned: `0.12.2`). |

### 1.2 Target

- **Repo:** `git@github.com:ball0803/opencode-mediator.git` (currently EMPTY)
- **Local install:** `~/.config/opencode/` (opencode config dir)
- **Runtime data:** `~/.local/share/opencode/mediator/`
- **Lat.md knowledge graph:** 22 pages, mirroring snowrabbit's symlink + authoring-guide-fork pattern.

### 1.3 Communication contract

- All implementation work follows the **quote-then-interpret gate** from `snowrabbit/AGENTS.md` (load-bearing).
- No code is written without explicit "go" from the user.
- The plan below is broken into phases; each phase is gated by its own "go" unless the user explicitly pre-authorizes.

---

## 2. Locked decisions

These are NOT defaults — they are committed values. Every implementation step that touches a decision must reference its row.

### 2.1 Core decisions (intent doc §4 + review-driven additions)

| # | Decision | Brief |
|---|---|---|
| D1 | Recorder is a plugin | Trust boundary; agent never self-records. |
| D2 | Refiner's patch applies via 2 channels (file + `output.context.push`) | Persistent + real-time, atomic. |
| D3 | Refiner returns JSON patch, plugin applies | Plugin validates (Zod), writes, updates provenance, commits. |
| D4 | Mediator is primary agent, `permission: { edit: deny, bash: deny }` | Cannot execute the task by accident. |
| D5 | Refiner is `mode: subagent, hidden: true` | Programmatic-only invocation. |
| D6 | Mediator prompt is markdown with named sections, stable `section_id` | Plugin finds sections by header. |
| D7 | Approval gate is STRICT ("approve / go / proceed / ship it" or green light on summary) | Plugin throws on `tool.execute.before` if violated. |
| D8 | Recording fires on `session.idle` and on `mediator_emit_intent` tool call | Two triggers, neither trusts agent self-report. |
| D9 | Refiner grounded in record, validated by empirical evidence (next record) | Self-check forces deferral. |
| D10 | Patches validated by Zod, applied atomically | Validation failure → no write. Write failure → no provenance update. |
| D11 | Removed sections go to archive, not deleted | `/mediator-restore <section_id>` recovery. |
| D12 | Git is user-facing version control | Commit format: `refiner: <op> <section_id> for record rcr_xxx — <rationale>`. |
| D13 | Refiner has tool access (`read`, `grep`, `glob`, `webfetch`, `websearch`) | Gated by cost-discipline rule. |
| D14 | Refiner prompt uses synscribe positive-framing style, not Snowrabbit negative-framing | Snowrabbit = failure-mode data source. Synscribe = style source. |
| D15 | Negative-framing ratio < 0.5 per section | Plugin checks; re-frame or escalate. |
| D16 | Section granularity is surgical, with Refiner-driven merge on growth | Token count > 8000 triggers merge pass. |
| D17 | Adversarial evaluator uses `oracle` and `momus` when detected, else built-in critic | `client.agent.list()` to detect (lazy-init, Q1). Built-in critic prompt from synscribe. |
| D18 | High-risk op user confirmation uses opencode permission ask flow | Tool `apply_refiner_patch` registered programmatically on plugin boot (Q3). |
| **D19** | **Per-section branches for Refiner commits (S1)** | Each Refiner commit lands on `refiner/<section_id>` branch. Merge to `main` requires empirical-evaluation pass. On invalidation, write marker commit on `main` referencing the failed SHA. |
| **D20** | **Provenance status field (S1)** | `provenance.json` entries carry `status: { pending \| resolved \| invalidated }` per record_id. On invalidation, plugin writes `manual: revert P1 <sha> after empirical-eval fail at rcr_xxx`. |
| **D21** | **Single-writer mutex for JSONL append (S5)** | All JSONL writes serialize through one in-process Promise queue (per-file mutex). Each record has `emit_intent_id: ulid` for idempotency on read. Test: 50 concurrent emits → file parses cleanly. |
| **D22** | **Handler ordering serialization (S6)** | All chain-mutating handlers go through a single async mutex (`p-mutex` or hand-rolled). Test: concurrent event fire → chain order is deterministic. |
| **D23** | **Compaction as single serialization point for patch application (S4)** | `experimental.session.compacting` is the ONLY event where patches apply. Snapshot `prompts/mediator.md` hash before/after; abort + queue for next compaction on hash change. Multi-session caveat documented in README. |
| **D24** | **Refiner `hidden:true` is not enforced by opencode — explicit allowlist (S3)** | `lib/refiner-allowlist.ts` maintains a runtime capability token set by the plugin at Refiner spawn. Refiner's prompt instructs it to refuse if caller's session_id is not in the allowlist. |
| **D25** | **Records directory `chmod 600` on first write (S9)** | Plugin `chmod 600`s `~/.local/share/opencode/mediator/records/` on first write. README privacy warning. `mediator.record_redaction: string[]` config reserved for v2. |
| **D26** | **install.sh race protection + atomic write (S10)** | `pgrep -f opencode` and refuse to run while opencode is live. Atomic write to `~/.config/opencode/opencode.json` via `opencode.json.tmp` + `mv`. |
| **D27** | **`client.agent.list()` semantics verification (S11, Q1)** | Phase 12.1 includes a smoke test that calls the real API against an opencode instance with `oracle` registered. Verifies that `hidden:true` agents are returned (silent-fallback risk). Marked `@ci-skip` if oh-my-opencode is not in CI. |
| **D28** | **Section ID slug normalization + reorder op (S12)** | `section_id` = lowercase, ASCII-only, hyphens. Collision dedup: append `-2`, `-3`. Add `op: "reorder"` with explicit `before_section_id` / `after_section_id`. Documented in `patch-schema.md`. |
| **D29** | **Single canonical record writer per event (S8)** | `tool.execute.after` is the canonical writer for `mediator_emit_intent`. `session.idle` invokes Refiner (or vice versa). Iteration chain entries carry `record_written: boolean` so the second event skips. |
| **D30** | **Parent-child session lifecycle tracking (S7)** | `~/.local/share/opencode/mediator/sessions/<parent_id>.json` tracks `child_sessions: parent_id → child_id[]`. On `session.deleted`, clean up children and pending evaluations. **v1: exactly one child per parent; multiple children fails with a clear error.** |

### 2.2 Twelve vague items (intent doc §12, all locked)

| # | Item | Locked value |
|---|---|---|
| V1 | Mediator lifetime | Per-session for v1. Long-lived per-user alternative documented in intent §16, opt-in via `mediator.long_lived: true`. |
| V2 | Approval threshold | Strict. Bare `yes/ok/thanks/looks good` is NOT approval. Surfaced in 4 places. |
| V3 | Section granularity | Surgical + merge on growth at 8000 tokens. |
| V4 | Mediator ↔ Assistant handoff | Out-of-band via `client.session.create({ parentID, agent: "assistant" })` + `client.session.message(...)`. |
| V5 | Provenance retention | Cap at 5 record_ids per section in `provenance.json`. Older demoted to `provenance.archive.json` (append-only, unbounded). `MAX_PROVENANCE_PER_SECTION = 5`. |
| V6 | Adversarial evaluator cost | Only on `op: "remove"` and `refined_count >= 2`. |
| V7 | User checkpoint policy | Permission ask flow, not typing. |
| V8 | Research budget | 3 tool calls typical, 5 for novel. Over-budget requires critic review. **Enforced (D31): recorder counts tool calls per Refiner session and passes count into next Refiner's empirical evidence block.** |
| V9 | Empirical evaluation lag | 1 record flags "no change", 3 records confirm "resolved". |
| V10 | Plugin dependencies | `zod` + `ulid`. No other v1 deps. |
| V11 | Hard-never rules preserved in negative-framing | Yes. URL hallucination + sycophancy. Subject to 0.5 cap. |
| V12 | Negative-framing ratio threshold | 0.5 default. |

---

## 3. Repository layout (updated)

```
git@github.com:ball0803/opencode-mediator.git
├── README.md                                # install/uninstall/upgrade/troubleshooting/privacy/overview
├── CHANGELOG.md
├── VERSION
├── package.json                             # Bun-managed deps: zod, ulid, p-mutex
├── install.sh                               # pgrep + atomic write (D26)
├── uninstall.sh
├── upgrade.sh
├── opencode-mediator.json                   # user-facing config (lat.md path, etc.)
├── .opencode/
│   └── plugins/
│       └── lat-md-enforce.ts                # forked from snowrabbit, attribution line
├── .githooks/
│   ├── pre-commit                           # warn-only lat.md check
│   └── pre-push                             # warn-only lat.md check
├── .github/
│   └── workflows/
│       ├── ci.yml                           # blocking gate via vercel-labs/lat.md@action-v1
│       └── pilotty.yml                      # gated by PR label 'run-pilotty' (Q7)
├── .agents/
│   └── skills/
│       └── lat-md/
│           └── SKILL.md                     # SYMLINK → ../../docs/agents/lat-md-authoring.md
├── docs/
│   ├── lat.md                               # SYMLINK → ./lat.md (or rather: ./lat.md → docs/)
│   ├── agents/
│   │   └── lat-md-authoring.md              # copied from snowrabbit with attribution
│   ├── intent/
│   │   ├── mediator-and-refiner.md          # the intent doc (local copy)
│   │   └── sub-intents/                     # record, patch, plugin-contract, etc.
│   ├── plan/
│   │   └── implementation-plan.md           # this file (local copy)
│   ├── reference/
│   │   ├── snowrabbit.md                    # attribution + pointer
│   │   └── sources.md
│   └── graphs/
│       └── (22 graph pages, each .md)
├── lat.md                                   # SYMLINK → docs/
├── agents/
│   ├── mediator.md                          # Mediator primary agent markdown
│   └── refiner.md                           # Refiner hidden subagent markdown
├── prompts/
│   └── mediator.md                          # Mediator prompt (referenced via {file:...})
├── tools/
│   ├── mediator-emit-intent.ts              # custom tool, Zod schema
│   └── apply-refiner-patch.ts               # hidden tool, permission: "ask", registered programmatically (D18, Q3)
├── plugins/
│   ├── recorder.ts                          # the trust boundary
│   └── patch-apply.ts                       # file-write + commit code, called by apply_refiner_patch tool
├── schemas/
│   ├── record.ts                            # JSONL record schema (with emit_intent_id, status)
│   ├── patch.ts                             # patch schema (with op: "reorder")
│   └── working-intent.ts                    # WorkingIntent schema
├── lib/
│   ├── mutex.ts                             # single async mutex for chain mutation (D22)
│   ├── jsonl-writer.ts                      # single-writer Promise queue + ulid idempotency (D21)
│   ├── provenance.ts                        # cap-at-5 + archive + status field (D20)
│   ├── pattern-library.ts                   # 9 seed tags + growth
│   ├── negative-framing.ts                  # ratio check
│   ├── adversarial-evaluator.ts             # lazy-init detection + critic fallback (Q1, D27)
│   ├── empirical-evaluation.ts              # pending_evaluation, resolved, escalate (D32, Q6)
│   ├── refiner-allowlist.ts                 # capability tokens for Refiner spawn (D24, S3)
│   ├── section-id.ts                        # slug normalization + collision dedup (D28)
│   ├── section-merge.ts                     # Refiner-driven merge at 8000 tokens (D16)
│   ├── session-lifecycle.ts                 # parent-child tracking + cleanup (D30)
│   ├── chmod-records.ts                     # chmod 600 on first write (D25)
│   └── tool-registration.ts                 # programmatic tool registration (D18, Q3)
├── scripts/
│   ├── install.sh                           # symlink orchestration
│   ├── restore-section.sh                   # /mediator-restore handler
│   └── verify-lat-md.sh                     # skip-env aware
├── test/
│   ├── fixtures/
│   │   ├── records.jsonl
│   │   ├── patches.json
│   │   └── events.json
│   ├── plugin.test.ts
│   ├── provenance.test.ts
│   ├── negative-framing.test.ts
│   ├── jsonl-writer.test.ts                 # 50-concurrent-emit test (D21)
│   ├── mutex.test.ts                        # handler ordering test (D22)
│   ├── refiner-allowlist.test.ts            # hidden:true enforcement test (D24)
│   ├── adversarial-evaluator.test.ts        # mocked client.agent.list test
│   ├── adversarial-evaluator.smoke.test.ts  # real client.agent.list smoke (D27, @ci-skip)
│   ├── empirical-evaluation.test.ts
│   ├── section-id.test.ts                   # slug normalization + collision (D28)
│   ├── integration.test.ts                  # direct-API end-to-end (D31, Q4)
│   └── examples/
│       └── manual-pilotty.md                # @skip-ci, dev-machine only (Q4, Q7)
└── examples/
    ├── happy-path.md
    ├── pattern-resolution.md
    ├── permission-ask.md
    ├── invalidation-flow.md                 # S1 scenario walkthrough
    └── manual-pilotty.md                    # dev-machine only
```

---

## 4. Phases (14 phases, ~70 steps)

Each phase is gated by the user's "go" unless explicitly pre-authorized.

### Phase 0 — Pre-flight + repo bootstrap + empirical-evaluation skeleton

**Goal:** empty repo becomes a working directory with CI tooling, lat.md installed (M1), and the empirical-evaluation lib hoisted (Q6).

| Step | Action | Proof mechanism |
|---|---|---|
| 0.1 | Verify intent doc at `/home/camel/.config/opencode/intent/mediator-and-refiner.md` exists, 351 lines, 12 items locked | `wc -l`, `grep -c "^## "` |
| 0.2 | Clone `git@github.com:ball0803/opencode-mediator.git` (empty) | `git clone` + `git log` (empty) + `git status` |
| 0.3 | `bun init` to create `package.json`, install `zod@^3.4`, `ulid@^2.3`, `p-mutex@^0.5` | `cat package.json` + `bun pm ls` |
| 0.4 | Install lat.md globally: `npm install -g lat.md@0.12.2` (M1: install before any lat.md usage); create symlink `lat.md → docs/` | `lat.md --version` outputs `0.12.2`; `ls -la lat.md` shows symlink |
| 0.5 | Run `lat.md init` in the repo | `ls .git/` unchanged + `lat.md locate` returns repo path |
| 0.6 | Pre-authorize skip-envs: `OPENCODE_MEDIATOR_SKIP_LAT_CHECK=1`, `OPENCODE_MEDIATOR_SKIP_LAT_ENFORCE=1`, `OPENCODE_MEDIATOR_SKIP_LAT_INSTALL=1` (M3: copy from §5.4 for consistency) | `grep SKIP_LAT README.md` |
| 0.7 | `lib/empirical-evaluation.ts` skeleton (Q6, hoisted from Phase 14): `pending_evaluation: Record<section_id, record_id[]>`, `resolved(section_id)`, `escalate(section_id)`, `markPending(section_id, record_id)` as pure functions | `bun check lib/empirical-evaluation.ts` exits 0; write unit test |
| 0.8 | `lib/mutex.ts` — single async mutex using `p-mutex` (D22) | `bun check` exits 0; write concurrency test |
| 0.9 | `lib/jsonl-writer.ts` — single-writer Promise queue + `emit_intent_id: ulid` idempotency (D21) | `bun check` exits 0; write 50-concurrent-emit test |

**Exit criteria:** clone exists, `lat.md locate` works from inside the repo, all 3 skip-envs documented, empirical-evaluation + mutex + jsonl-writer libs exist with passing tests.

### Phase 1 — lat.md knowledge graph (22 pages)

**Goal:** 22 graph pages exist in `docs/graphs/`, each discoverable via `lat.md search`.

| Step | Action | Proof mechanism |
|---|---|---|
| 1.1 | Create `docs/agents/lat-md-authoring.md` — copy from snowrabbit with attribution | `diff` against snowrabbit's, `grep attribution` |
| 1.2 | Create `docs/graphs/overview.md` (the root node) | `lat.md refs overview.md` returns expected nodes |
| 1.3 | Create the 21 other graph pages (med-flow, refiner-flow, dual-channel, provenance, archive, pattern-library, negative-framing, hard-never, adversarial-evaluator, momus, oracle, critic-fallback, empirical-evaluation, permission-ask-flow, section-merge-pass, install-flow, uninstall-flow, upgrade-flow, hook-skip-env, recording-triggers, recovery-flow) | `lat.md check` exits 0 |
| 1.4 | Create `.agents/skills/lat-md/SKILL.md` as symlink to `../../docs/agents/lat-md-authoring.md` | `ls -la .agents/skills/lat-md/SKILL.md` shows symlink target |
| 1.5 | Verify all 22 pages are referenced from at least one other page (the graph must be connected) | `lat.md check` exits 0 with `--strict-references` |

**Exit criteria:** `lat.md check --strict` exits 0; `lat.md search <keyword>` returns expected pages.

### Phase 2 — lat-md-enforce plugin (fork from snowrabbit)

**Goal:** the same hard enforcement snowrabbit has, with no force-install surprise.

| Step | Action | Proof mechanism |
|---|---|---|
| 2.1 | Copy `.opencode/plugins/lat-md-enforce.ts` from snowrabbit, 266 lines | `wc -l` = 266 |
| 2.2 | Add attribution comment at line 1: `// Originally from https://github.com/anomalyco/snowrabbit/blob/dev/.opencode/plugins/lat-md-enforce.ts` | `head -1 .opencode/plugins/lat-md-enforce.ts` |
| 2.3 | Verify 4 decision boundaries are present (no-edit-without-lat-call, allowed-tools exception, skip-env gating, batch-edit detection) | `grep -c "if (.*lat.md.*)" plugin.ts` ≥ 4 |
| 2.4 | Write a test fixture that runs the plugin against a synthetic Edit call and verifies it throws | `bun test test/plugin.test.ts` exits 0 |

**Exit criteria:** plugin blocks Edit/Write/MultiEdit/apply_patch when no lat tool was called recently; skip-env bypass works.

### Phase 3 — install / uninstall / upgrade + CI infrastructure

**Goal:** the project is shippable: install.sh is race-safe (D26), uninstall.sh cleans up, upgrade.sh preserves user state, CI runs on every PR.

| Step | Action | Proof mechanism |
|---|---|---|
| 3.1 | Write `install.sh` with race protection (D26): `pgrep -f opencode` and refuse to run while opencode is live; atomic write to `~/.config/opencode/opencode.json` via `opencode.json.tmp` + `mv` | `bash install.sh --dry-run` exits 0; manual pgrep-test confirms refusal |
| 3.2 | `install.sh` orchestrates: clone, lat.md init, symlink `~/.config/opencode/agents/mediator.md` etc. into opencode config dir, `chmod 700` the install dir | dry-run exits 0; `ls -la ~/.config/opencode/agents/` shows symlinks |
| 3.3 | Write `uninstall.sh` — removes symlinks (NOT files), preserves user data | `bash uninstall.sh --dry-run` exits 0 |
| 3.4 | Write `upgrade.sh` — diffs current vs new `install.sh`, applies only deltas, preserves user state | `bash upgrade.sh --dry-run` exits 0 |
| 3.5 | Write `.githooks/pre-commit` — warn-only lat.md check, tail -20, skip-env aware | `git commit` with bad doc → see tail -20 output |
| 3.6 | Write `.githooks/pre-push` — same pattern | `git push` with bad doc → see tail -20 output |
| 3.7 | Write `.github/workflows/ci.yml` — blocking gate via `vercel-labs/lat.md@action-v1`; uses `oven-sh/setup-bun@v2` (Q7) | push to a test PR → CI runs and blocks on bad docs |
| 3.8 | Write `.github/workflows/pilotty.yml` — gated by `if: contains(github.event.pull_request.labels.*.name, 'run-pilotty')` (Q7) | label test PR → workflow runs only when labeled |
| 3.9 | Write `VERSION` (start at `0.1.0`) + `CHANGELOG.md` (initial entry) | `cat VERSION`, `head -20 CHANGELOG.md` |
| 3.10 | Write `CONTRIBUTING.md` — "every change is a Refiner patch or a manual fix, both go through git" | `grep "refiner:" CONTRIBUTING.md` |

**Exit criteria:** dry-run scripts all exit 0; install refuses to run with opencode live; CI blocks on bad docs; pilotty CI gated by label; VERSION and CHANGELOG exist.

### Phase 4 — Recorder plugin core (trust boundary)

**Goal:** the plugin subscribes to all required events, builds the iteration chain in memory through the shared mutex (D22), writes records via the single-writer JSONL queue (D21), and respects the canonical-writer rule (D29).

| Step | Action | Proof mechanism |
|---|---|---|
| 4.1 | `plugins/recorder.ts` skeleton: imports `zod`, `ulid`, `p-mutex`; registers all 7 event handlers; `lib/mutex.ts` for chain mutation; `lib/jsonl-writer.ts` for record persistence | `bun check plugins/recorder.ts` exits 0 |
| 4.2 | `message.updated` handler: append iteration entry to in-memory chain (via mutex), tag with `pattern_tag` from Mediator's last response; `record_written: false` (D29) | write concurrent-fire test (D22) |
| 4.3 | `tool.execute.before` handler for `mediator_emit_intent`: verify `approve`-class keyword in prior user message; throw if missing | write test for both branches |
| 4.4 | `tool.execute.after` handler for `mediator_emit_intent`: **CANONICAL WRITER** (D29) — write record to `~/.local/share/opencode/mediator/records/<session_id>.jsonl` via `jsonl-writer.ts` (D21); set `record_written: true` on chain entry; one Refiner invocation queued | inspect file after test; verify exactly 1 record per emit |
| 4.5 | `session.idle` handler: finalize record; if `record_written: false` on the latest chain entry, write via `jsonl-writer.ts`; always invoke Refiner | concurrent-fire test; verify no duplicate writes |
| 4.6 | `command.executed` handler for `/mediator-restore`: read archive, restore section, write to `prompts/mediator.md` | test with synthetic command |
| 4.7 | Records dir `chmod 600` on first write (D25); `lib/chmod-records.ts` exposes this as a one-shot bootstrap | test: dir is `700` after first write; subsequent writes skip the chmod |

**Exit criteria:** every event has a working handler; chain mutation serialized; record writes go through single-writer queue; canonical-writer rule holds (no double-fire); records dir is `chmod 600`.

### Phase 5 — Dual-channel prompt modification (compaction as serialization point)

**Goal:** the patch writes the file AND pushes the new content to the active session, atomically. Compaction is the single allowed application point (D23). Multi-session caveat documented.

| Step | Action | Proof mechanism |
|---|---|---|
| 5.1 | `experimental.session.compacting` handler: read `prompts/mediator.md` hash, apply patch (via D19/D20 branch-and-merge logic), write file, then `output.context.push(...)` or `output.prompt` set; re-snapshot hash; if changed, abort and queue for next compaction (D23) | integration test with synthetic compaction event |
| 5.2 | Atomicity: if `output.context.push` fails, file is rolled back | test for failure branch |
| 5.3 | Refiner writes a wire to `lib/empirical-evaluation.ts.markPending` for the patched section (Q6) | verify `pending_evaluation[section_id]` was updated |
| 5.4 | Document multi-session caveat in README: "the recorder plugin is single-session-aware; running multiple opencode sessions against the same Mediator prompt can interleave patches. v1 limitation." | `grep "single-session-aware" README.md` |

**Exit criteria:** both channels write successfully in normal path; atomicity holds in failure path; hash check aborts on conflict; empirical-evaluation gets a wire call; README caveat present.

### Phase 6 — Mediator primary agent

**Goal:** Mediator is a markdown file with surgical sections, file substitution, and the strict approval gate surfaced in 4 places.

| Step | Action | Proof mechanism |
|---|---|---|
| 6.1 | `agents/mediator.md` frontmatter: `mode: primary`, `permission: { edit: deny, bash: deny }`, `prompt: {file:./prompts/mediator.md}` | `head -10 agents/mediator.md` |
| 6.2 | `prompts/mediator.md` — write 9 surgical sections (asking_rules, approval_gate, loop, success_pattern, etc.) with positive-framing style | `grep -c "^## " prompts/mediator.md` = 9 |
| 6.3 | Surface approval gate in 4 places: prompt intro, summary's last line, Mediator's re-prompt text, Mediator's failure recovery | `grep -c "approve / go / proceed / ship it" prompts/mediator.md` = 4 |

**Exit criteria:** `opencode run --agent mediator` starts a session, Mediator asks clarifying questions, never executes.

### Phase 7 — Refiner hidden subagent + allowlist enforcement

**Goal:** Refiner is a hidden subagent; `hidden:true` is **enforced** via the allowlist (D24, S3).

| Step | Action | Proof mechanism |
|---|---|---|
| 7.1 | `agents/refiner.md` frontmatter: `mode: subagent`, `hidden: true`, `model: anthropic/claude-haiku-4-5` | `head -10 agents/refiner.md` |
| 7.2 | `prompts/refiner.md` — patch format with `op: "reorder"` (D28), 3-typical-5-novel research budget, self-check forcing deferral, **and the allowlist check** (D24): "If your caller is not in the Refiner allowlist (set by the recorder plugin at spawn), refuse and explain." | `grep "3 typical"`, `grep "next record"`, `grep "allowlist"` |
| 7.3 | `lib/refiner-allowlist.ts` — `add(sessionId)`, `has(sessionId)`, `clearExpired()` (D24) | `bun check` exits 0; write unit test |
| 7.4 | Recorder plugin (Phase 4.1's handler set) at every `client.session.create({ agent: "refiner" })` call: `allowlist.add(childSessionId)` (D24) | write test: Refiner spawned with non-allowlisted caller refuses |
| 7.5 | Negative-framing ratio check (D15) and hard-never exception (V11) explicitly in prompt | `grep "0.5"`, `grep "URL"`, `grep "sycophancy"` |
| 7.6 | `lib/section-id.ts` — slug normalization (D28): `lowercase`, `ASCII-only`, `hyphens`, collision dedup with `-2`, `-3` suffix | `bun check`; write test for collision + special chars |
| 7.7 | `lib/section-merge.ts` — Refiner-driven merge at 8000 tokens (D16) | `bun check`; write test with synthetic 9KB prompt |

**Exit criteria:** Refiner refuses when called by a non-allowlisted session; allowlist add/has/clearExpired pass tests; section_id normalization handles collisions; section-merge produces valid merged section.

### Phase 8 — Custom tool `mediator_emit_intent` + slash command `/mediator-restore` + parent-child lifecycle (D30)

**Goal:** Mediator has a tool to emit WorkingIntent; user has a slash command to restore removed sections; the parent-child session lifecycle is tracked.

| Step | Action | Proof mechanism |
|---|---|---|
| 8.1 | `tools/mediator-emit-intent.ts` — Zod schema for WorkingIntent (goal, constraints, context, success_criteria, out_of_scope, open_questions); record carries `emit_intent_id: ulid` (D21) | `bun check tools/mediator-emit-intent.ts`, write schema test |
| 8.2 | Wire `tool.execute.before` validation: verify approve-class keyword in prior user message | test for both branches |
| 8.3 | `scripts/restore-section.sh` — invoked by `/mediator-restore` handler: read archive at `~/.local/share/opencode/mediator/archive/<section_id>_<unix>.md`, write back into `prompts/mediator.md` at original section header | test with synthetic command |
| 8.4 | Slash command registration: verify `~/.config/opencode/commands/mediator-restore.md` is the correct path (opencode docs); create the file with the opencode command markdown format | `cat ~/.config/opencode/commands/mediator-restore.md` |
| 8.5 | `lib/session-lifecycle.ts` — `createChild(parentId)` (writes to `~/.local/share/opencode/mediator/sessions/<parent_id>.json` with the `child_sessions` map), `cleanupChildren(parentId)` (on `session.deleted`), `getChildCount(parentId)` (returns 1 in v1; throws on > 1) (D30) | `bun check`; write test for v1 limit |
| 8.6 | Recorder hooks `session.deleted` to call `cleanupChildren` | test: parent session deleted → children file is removed, pending_evaluation entries for those children are dropped |

**Exit criteria:** Mediator can emit, user can restore by command; child session tracking works; v1 single-child limit enforced; cleanup on parent deletion verified.

### Phase 9 — Pattern library seed (9 failure-mode tags)

**Goal:** the library has the 9 seed tags; new tags can be appended.

| Step | Action | Proof mechanism |
|---|---|---|
| 9.1 | `lib/pattern-library.ts` — load/save `~/.local/share/opencode/mediator/patterns.json` | `bun check` exits 0 |
| 9.2 | Seed file with 9 tags: `out_of_scope_assumption`, `ambiguous_pronoun`, `vague_constraint`, `missed_approval_keyword`, `premature_action`, `silence_treated_as_approval`, `paraphrasing_user`, `twisting_user_words`, `success_pattern`. Each: `{ refined_count: 0, last_refined_record: null, known_good_section: null }` | `jq '. | keys' ~/.local/share/opencode/mediator/patterns.json` returns 9 keys |

**Exit criteria:** library loads, has 9 tags, can be updated.

### Phase 10 — Provenance retention (cap at 5 + archive) + status field (D20) + per-section branches (D19)

**Goal:** live `provenance.json` capped at 5 record_ids per section; archive holds the rest; each record_id carries a status; Refiner commits land on per-section branches.

| Step | Action | Proof mechanism |
|---|---|---|
| 10.1 | `lib/provenance.ts` — `MAX_PROVENANCE_PER_SECTION = 5`; load/save `provenance.json` and `provenance.archive.json`; each entry: `{ record_id, status: "pending" \| "resolved" \| "invalidated", written_at }` (D20) | `bun check` exits 0; write test for status field |
| 10.2 | `demote()` function: on every `op: "revise"` or `op: "remove"`, older record_ids move from `provenance.json` to `provenance.archive.json` (append-only) | write test with 10 records, verify cap holds |
| 10.3 | `markResolved(recordId)` and `markInvalidated(recordId)` functions: update the status field (D20) | write test for both branches |
| 10.4 | Wire into patch application: after successful apply, demote + git commit on `refiner/<section_id>` branch (D19); merge to `main` requires empirical-evaluation pass; on invalidation, write marker commit `manual: revert P1 <sha> after empirical-eval fail at rcr_xxx` on `main` | integration test |

**Exit criteria:** cap holds; archive is unbounded; status field updates correctly; per-section branch workflow works; marker commit on invalidation appears.

### Phase 11 — Negative-framing ratio check + hard-never rules

**Goal:** the plugin enforces the 0.5 cap; hard-never rules are preserved but subject to the same cap; every patch-applying step (this one included) wires one write to `lib/empirical-evaluation.ts.markPending` (Q6).

| Step | Action | Proof mechanism |
|---|---|---|
| 11.1 | `lib/negative-framing.ts` — count negative markers (`don't`, `do not`, `never`, `no.`, `forbidden`, `must not`, `should not`, `avoid`); compute ratio | `bun check` exits 0 |
| 11.2 | Wire into patch validation: if ratio > 0.5, return error; if re-frame fails, `tui.toast.show` to user; on successful apply, `empirical-evaluation.markPending(section_id, record_id)` (Q6) | test both branches; verify pending_evaluation was updated |

**Exit criteria:** ratio check blocks over-negative sections; re-frame + escalation paths work; empirical-evaluation gets the wire.

### Phase 12 — Adversarial evaluator (lazy-init, oracle / momus, smoke test) (Q1, D27)

**Goal:** the second-LLM critic layer uses `oracle` or `momus` from oh-my-opencode when detected (lazy-init with WeakSet, Q1); otherwise falls back to a built-in critic prompt; `client.agent.list()` semantics are verified (D27).

| Step | Action | Proof mechanism |
|---|---|---|
| 12.1 | `lib/adversarial-evaluator.ts` — `detectAgents()` calls `client.agent.list()` LAZILY (no cache, but session-scoped WeakSet of resolved IDs to skip on routine add/revise) (Q1); returns `["oracle", "momus"]` or `[]` | `bun check`; write test with mocked `client.agent.list` for both branches |
| 12.2 | If agents detected: invoke via `client.session.create({ agent: "oracle", hidden: true })` + `client.session.message(...)` with the patch as input; expect `{ verdict, issues, patch_revision? }` | write test mocking verdict |
| 12.3 | If no agents: invoke Refiner again with the **built-in critic prompt** (sourced from synscribe article: "report outcomes faithfully" + "value framing" + adversarial-thinking patterns) | write test with the critic prompt |
| 12.4 | Trigger only on `op: "remove"` and `refined_count >= 2` (V6) | write test for trigger logic |
| 12.5 | `test/adversarial-evaluator.smoke.test.ts` — REAL `client.agent.list()` against an opencode instance with `oracle` registered via oh-my-opencode; verify `hidden:true` agents are returned (D27, silent-fallback risk) | `@ci-skip` if oh-my-opencode not in CI; manual run instructions in test file header |

**Exit criteria:** oracle/momus path works; critic-fallback path works; trigger logic is correct; smoke test verifies hidden:true agents are visible in real `client.agent.list()`.

### Phase 13 — User checkpoint (programmatic tool registration + permission ask flow) (D18, Q3)

**Goal:** high-risk ops use the standard opencode permission dialog; tool registered programmatically on plugin boot.

| Step | Action | Proof mechanism |
|---|---|---|
| 13.1 | `lib/tool-registration.ts` — `registerApplyRefinerPatchTool()` programmatically on plugin boot (Q3): registers a hidden tool `apply_refiner_patch` with `permission: "ask"` via opencode's plugin API | `bun check`; verify the tool is registered without modifying `~/.config/opencode/opencode.json` |
| 13.2 | `tools/apply-refiner-patch.ts` — the tool body. On `op: "remove"` or `refined_count >= 2`, plugin calls this tool with the patch as input; tool's execute IS the file-write + commit code (lives in `plugins/patch-apply.ts` to keep the trust boundary clear) | test the call sequence |
| 13.3 | `permission.replied` handler: drop patch on denial, log to `~/.local/share/opencode/mediator/permissions/<denial_id>.json` (per Oracle non-blocking suggestion 5) | test both branches; verify denial log is written |
| 13.4 | `lib/tool-registration.ts` test: programmatic registration does NOT mutate user's `~/.config/opencode/opencode.json` (Q3 atomicity claim) | test: snapshot user's `opencode.json` before + after, diff = empty |

**Exit criteria:** permission dialog appears; approval applies patch via tool; denial drops + logs to dedicated file; user's main `opencode.json` is never mutated by the plugin.

### Phase 14 — Empirical evaluation aggregation + invalidation flow (S1) + final integration + ship (D31, Q4)

**Goal:** the plugin tracks whether patches actually worked, including the invalidation path; final ship-ready state with direct-API integration test replacing pilotty.

| Step | Action | Proof mechanism |
|---|---|---|
| 14.1 | `lib/empirical-evaluation.ts` aggregation logic (Q6): `tick()` runs on each new record; checks `pending_evaluation[section_id]`; if pattern_tag persisted → `refined_count += 1`; if pattern gone for 3 records → `markResolved(recordId)` (D20) | unit test for both branches |
| 14.2 | Wire into Refiner invocation: empirical evidence (`{ resolved_count, pending_count, invalidated_count }`) sent to Refiner on next call; on `invalidated_count > 0`, Refiner is told which commit to avoid (per-section branches, D19) | test the wire |
| 14.3 | **Invalidation flow (S1):** on `markInvalidated`, the plugin writes a marker commit on `main`: `manual: revert P1 <sha> after empirical-eval fail at rcr_xxx — <rationale>`; updates `provenance.json` with `status: "invalidated"`; sets the section's `refiner/<section_id>` branch to require re-validation | integration test; verify marker commit + branch state |
| 14.4 | `examples/invalidation-flow.md` — the S1 scenario walkthrough: "patch P1 applied at session N. Sessions N+1, N+2, N+3: pattern persists. At session N+3, V9 fires invalidation. Marker commit on main. Per-section branch is held back. Refiner at session N+4 sees the empirical evidence and emits a narrower replacement (P2)." | example exists |
| 14.5 | `test/integration.test.ts` — direct-API end-to-end (D31, Q4): spawn opencode server, drive `client.session.create({ agent: "mediator" })` + `client.session.message(...)`, assert on observable side effects (record written to JSONL, patch applied, git commit created) | `bun test test/integration.test.ts` exits 0; no pilotty |
| 14.6 | `examples/manual-pilotty.md` — pilotty walkthrough for developer-machine use only, marked `@skip-ci` | example exists; `grep "@skip-ci"` finds it |
| 14.7 | `README.md` with: install, uninstall, upgrade, troubleshooting, privacy, "what is the Mediator / what is the Refiner / how they relate" (6 sections, Oracle non-blocking 1) | `grep -c "^## " README.md` ≥ 6 |
| 14.8 | `CHANGELOG.md` updated with `0.1.0` entry | `head -30 CHANGELOG.md` |

**Exit criteria:** aggregation logic correct; invalidation flow works (marker commit, per-section branch held back, Refiner sees empirical evidence); integration test passes via direct API; pilotty is manual-only; README + CHANGELOG ship-ready.

---

## 5. Cross-phase concerns

### 5.1 Test infrastructure

- Bun test runner (`bun test`).
- Test fixtures: synthetic records, synthetic patches, synthetic session events.
- Every lib file has a `.test.ts`.
- **Direct-API integration test (D31, Q4)** in Phase 14.5 covers the full happy path.
- **Pilotty moved to `examples/manual-pilotty.md` (Q4)** — developer-machine only, marked `@skip-ci`.

### 5.2 Version policy

- Semver: `MAJOR.MINOR.PATCH`.
- Breaking change → MAJOR. New section/decision → MINOR. Bug fix / typo → PATCH.
- `VERSION` file is the source; `CHANGELOG.md` is human-readable.

### 5.3 Contribution conventions

- Every change is a Refiner patch (preferred) OR a manual fix (rare).
- Both go through git.
- Commit message format: `refiner: <op> <section_id> for record rcr_xxx — <rationale>` (Refiner) OR `manual: <summary>` (manual).
- Marker commit on invalidation: `manual: revert P1 <sha> after empirical-eval fail at rcr_xxx — <rationale>` (D19/D20).
- PRs require CI pass + lat.md check pass + momus review.

### 5.4 Skip-env vars

| Env | Effect |
|---|---|
| `OPENCODE_MEDIATOR_SKIP_LAT_CHECK=1` | Bypasses pre-commit/pre-push lat check. |
| `OPENCODE_MEDIATOR_SKIP_LAT_ENFORCE=1` | Bypasses the plugin's lat enforcement. |
| `OPENCODE_MEDIATOR_SKIP_LAT_INSTALL=1` | Bypasses the install.sh lat.md install. |

### 5.5 CI strategy (Q7)

- **`bun test`**: runs on GHA via `oven-sh/setup-bun@v2` on `ubuntu-latest` and `macos-latest`. No issue.
- **`pilotty`**: does NOT run on GHA. Live in `.github/workflows/pilotty.yml`, gated by `if: contains(github.event.pull_request.labels.*.name, 'run-pilotty')`. Used by devs on their own machines via `examples/manual-pilotty.md`.

### 5.6 Documentation

| Doc | Owner | Created in |
|---|---|---|
| `intent/mediator-and-refiner.md` | user-locked, source of truth | already exists |
| `docs/sub-intents/record-schema.md` | spec phase | Phase 4 |
| `docs/sub-intents/patch-schema.md` | spec phase (must document `op: "reorder"`, D28) | Phase 7 |
| `docs/sub-intents/plugin-contract.md` | spec phase | Phase 4 |
| `docs/sub-intents/failure-mode-taxonomy.md` | spec phase | Phase 9 |
| `docs/sub-intents/recovery-flow.md` | spec phase (must include S1 invalidation) | Phase 14 |
| `docs/sub-intents/empirical-evaluation.md` | spec phase (hoisted from Phase 0) | Phase 0 + 14 |
| `docs/reference/snowrabbit.md` | attribution + pointer | Phase 0 |
| `docs/reference/sources.md` | bibliography | Phase 0 |
| `docs/reference/research-budget.md` | how V8 is enforced (tool-call counter) | Phase 7 |

---

## 6. Proof matrix

Every step above has a "proof mechanism" column. Each mechanism is a real tool call:

| Tool | Use |
|---|---|
| `wc -l`, `grep`, `head`, `tail`, `diff` | file content verification |
| `cat` | read state |
| `ls -la` | symlink verification |
| `bun check` | TypeScript type check |
| `bun test` | test runner (works on GHA) |
| `bun pm ls` | dependency verification |
| `git clone`, `git log`, `git status`, `git commit`, `git push`, `git checkout -b refiner/<id>` | repo state, including per-section branches (D19) |
| `bash <script> --dry-run` | script smoke test |
| `pgrep -f opencode` | install.sh race protection test (D26) |
| `opencode run --agent <name>` | agent smoke test |
| `client.session.create` + `client.session.message` | direct-API integration test (D31, replaces pilotty in CI) |
| `pilotty_spawn` | **manual** end-to-end only (Q4, Q7) — `@skip-ci` |
| `lat.md <command>` | knowledge graph verification |
| `jq` | JSON state inspection |
| `codegraph_explore` | cross-file symbol reachability |

**Every step has at least one proof mechanism that runs in < 5 seconds** (the only exception is `examples/manual-pilotty.md`, which is dev-machine only).

---

## 7. Reviewer findings — resolved

Both reviews have been applied. The table below records what was addressed and where.

### 7.1 Momus (plan critic) — 3 findings

| # | Finding | Where applied |
|---|---|---|
| M1 | Phase 0.4 ordering — install lat.md before usage | Phase 0.4 reordered: install is now an explicit step, not assumed. |
| M2 | Step-number typo "13.3" → "12.3" | Phase 12.3 fixed. |
| M3 | Skip-env inconsistency in Phase 0.6 vs §5.4 | Phase 0.6 now copies the canonical names from §5.4. |

### 7.2 Oracle (high-IQ reviewer) — 5 open-question responses

| # | Question | Where applied |
|---|---|---|
| Q1 | Phase 12 detect-first vs lazy-init | Phase 12.1 — lazy-init with session-scoped WeakSet; hidden:true verification added (D27). |
| Q3 | Phase 13 tool registration timing | Phase 13.1 — programmatic registration on plugin boot; `lib/tool-registration.ts` test verifies user's main `opencode.json` is never mutated. |
| Q4 | Phase 14.4 pilotty vs non-TUI | Phase 14.5 — direct-API integration test replaces pilotty in CI. Phase 14.6 — pilotty moved to `examples/manual-pilotty.md` for dev-machine use only. |
| Q6 | Hoist empirical-evaluation to Phase 0 | Phase 0.7 — `lib/empirical-evaluation.ts` skeleton hoisted; Phases 4.5, 5.3, 11.2, 13.2 each wire one write. |
| Q7 | bun test + pilotty on GHA | §5.5 — bun test via `oven-sh/setup-bun@v2`; pilotty in `.github/workflows/pilotty.yml` gated by `run-pilotty` label. |

### 7.3 Oracle — 12 risks (S1-S12)

| # | Severity | Risk | Where applied |
|---|---|---|---|
| **S1** | **Critical** | No undo semantics for empirical-evaluation invalidation | D19 (per-section branches), D20 (provenance status), Phase 10.4 (marker commit), Phase 14.3 (full invalidation flow), Phase 14.4 (example). |
| S3 | High | `hidden:true` not enforced | D24 (allowlist), Phase 7.3-7.4 (lib + test). |
| S5 | High | JSONL append atomicity | D21 (single-writer Promise queue), Phase 0.9 (50-concurrent-emit test). |
| S4 | High | Dual-channel prompt modification race | D23 (compaction as single serialization point with hash check), Phase 5.4 (README caveat). |
| S6 | High | Plugin event handler ordering | D22 (single async mutex), Phase 0.8 + 4.2 (concurrency test). |
| S7 | Medium-High | Parent-child session lifecycle leak | D30 (tracking + cleanup + v1 single-child limit), Phase 8.5-8.6. |
| S8 | Medium | `session.idle` + `tool.execute.after` double-fire | D29 (canonical writer + `record_written` flag), Phase 4.4-4.5. |
| S9 | Medium | PII in records | D25 (chmod 600), Phase 4.7, README privacy warning. |
| S10 | Medium | `install.sh` racing live opencode | D26 (pgrep + atomic write), Phase 3.1. |
| S11 | Medium | `client.agent.list()` semantics unverified | D27 (smoke test), Phase 12.5. |
| S12 | Low-Medium | Patch operation semantics gaps | D28 (slug normalization + reorder op), Phase 7.6. |

### 7.4 Oracle — non-blocking suggestions addressed

| # | Suggestion | Where applied |
|---|---|---|
| 1 | README 6 sections (not 5) | Phase 14.7 — install, uninstall, upgrade, troubleshooting, privacy, "what is the Mediator / what is the Refiner / how they relate". |
| 2 | Enforce research budget | Phase 7.2 + cross-phase 5.6 — `docs/reference/research-budget.md` documents the tool-call counter; Phases 4.5 and 14.2 pass the count into the empirical evidence block. |
| 3 | Typo 13.3 → 12.3 | See M2. |
| 4 | Hand-edit policy for `prompts/mediator.md` | D23 (compaction-as-serialization-point) plus README caveat — a hand edit between two compactions is the multi-session caveat; within a single session, the next compaction overwrites it. Documented in §5.6 (empirical-evaluation doc owner). |
| 5 | `permissions/` audit log for apply_refiner_patch | Phase 13.3 — denial logs to `~/.local/share/opencode/mediator/permissions/<denial_id>.json`. |
| 6 | Split Phase 1 (1a + 1b) | **NOT applied** — left as a single phase; 22 graph pages is a focused single PR. Can split later if review burden is high. |
| 7 | Verify `~/.config/opencode/commands/` path | Phase 8.4 — explicitly verifies the path during implementation. |
| 8 | Provenance.json comment for >50 sections | Phase 10.1 — comment: "v1: simple file. If we ever exceed 50 sections, consider per-section files." |

---

**END OF PLAN**
