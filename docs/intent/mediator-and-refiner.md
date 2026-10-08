# Mediator Agent + Refiner Subagent

> **Status: Intent.** Design phase complete 2026-10-08 (12 vague items resolved; see §12). Awaiting your "go" before any implementation. Use as the seed for `spec-driven-development` when ready.

> **Companion docs:** none yet. This is the parent intent. Sub-intents (Record schema, Patch schema, Plugin contract, Failure-mode taxonomy) will split off from here once the spec phase begins.

---

## 1. Status

Intent — user-locked through design conversation, awaiting spec-driven-development.

---

## 2. Problem

Two related problems the system exists to solve.

**The Mediator problem (paper: Liu et al. 2026, "Intent Mismatch Causes LLMs to Get Lost in Multi-Turn Conversation").** When the user gives a vague, multi-turn request, the agent (LLM) defaults to the population-mean interpretation of intent. It makes an early assumption, locks it in, and drifts. The paper shows ~60% relative performance drop from single-turn full-spec to multi-turn sharded, and this is constant across model sizes — scaling does not fix it. The fix is a layer between the user and the execution agent: a **Mediator** that explicates the user's intent iteratively, only via user-locked approval, and emits a fully-specified record for the Assistant to execute.

**The prompt-engineering problem (Synscribe article: "How Anthropic Builds Claude's System Prompts").** The system's Mediator prompt is itself produced by an LLM and is the kind of thing that needs to be refined over time. The synscribe article shows the right shape: a *program* made of named, surgical, value-anchored sections, with provenance and per-model variants. The user wants this approach — distilled into a **Refiner** subagent that observes the Mediator's behavior, distills the observed records into prompt patches, and applies them.

**The Snowrabbit AGENTS.md pattern (reference, not target).** The user's own `~/.config/opencode/AGENTS.md` and the `snowrabbit/AGENTS.md` are forensic records of agent failures, each rule anchored to a trigger quote. The system in this doc is the *automated* version of that pattern: instead of the user hand-distilling rules after every failure, the Refiner distills them in-process.

---

## 3. Target

A system composed of:

- **Mediator agent** — opencode primary agent that performs iterative intent discovery with the user. Stops only on explicit user approval. Emits a `WorkingIntent` JSON record.
- **Refiner subagent** — opencode hidden subagent that reads Mediator records, reads the current Mediator prompt, and emits JSON patches (`add` / `revise` / `remove` operations) against named prompt sections.
- **Recorder plugin** — opencode plugin at `~/.config/opencode/plugins/mediator.ts` that subscribes to events, builds the iteration chain in memory, writes the record, invokes the Refiner, validates the patch, applies the file write (persistent channel), AND pushes the new content to the active session via `output.context.push(...)` (real-time channel). **This is the trust boundary.** The agent never self-records.
- **Mediator prompt store** — markdown at `~/.config/opencode/agents/mediator.md` (or split: `~/.config/opencode/prompts/mediator.md` referenced via `{file:...}`).
- **Refiner prompt store** — markdown at `~/.config/opencode/agents/refiner.md` with `mode: subagent, hidden: true`.
- **Record log** — JSONL at `~/.local/share/opencode/mediator/records/<session_id>.jsonl`.
- **Provenance index** — JSON at `~/.local/share/opencode/mediator/provenance.json`. Maps `section_id → [record_id, record_id, ...]`.
- **Provenance archive** — markdown files at `~/.local/share/opencode/mediator/archive/<section_id>_<unix_timestamp>.md` + sidecar JSON. Removed sections live here, not deleted.
- **Pattern library** — JSON at `~/.local/share/opencode/mediator/patterns.json`. Maps `pattern_tag → known good section template` with `refined_count` and `last_refined_record`.
- **Custom tool** — `~/.config/opencode/tools/mediator-emit-intent.ts`. Called by the Mediator when the user approves. The plugin observes the call; the call is **untrusted input** to the plugin, not a record.
- **Slash command** — `/mediator-restore <section_id>` for user-driven recovery of a removed section.
- **Plugin dependencies** — `~/.config/opencode/package.json` (Bun auto-installs at startup).

---

## 4. Core decisions

| Decision | Rationale |
|---|---|
| Recorder is a plugin, not the agent | Plugin runs outside the LLM context. Agent cannot lie, skip, or forge the record. Mirrors the synscribe article's rule that tool output is untrusted. |
| Refiner's patch is applied via two channels | File write (persistent — survives session restart, visible in git) AND in-session `output.context.push(...)` (real-time — visible in the active session immediately). Both happen atomically in the plugin. The "inject in realtime" requirement means the active session sees the refined prompt without waiting for the next session. |
| Refiner is a subagent, returns JSON patch, plugin applies | Same trust-boundary principle. Plugin validates the patch (Zod), writes the file, updates provenance, commits to git. |
| Mediator is a primary agent (markdown file with frontmatter) | opencode's native agent definition format. `mode: primary`, `permission: { edit: deny, bash: deny }` so the Mediator cannot execute the task by accident. |
| Refiner is `mode: subagent, hidden: true` | Only the plugin invokes it programmatically. Never appears in the `@` autocomplete. |
| Mediator prompt is a markdown file of named sections | Each section has a stable `section_id` derived from the header. The Refiner's patch operations reference sections by ID. The plugin finds them in the file by header. |
| Approval gate is strict: "approve / go / proceed / ship it" or green light on the WorkingIntent summary | A bare "yes" or "ok" without explicit approval is NOT approval. Mirrors the paper's "explicit user-locked" requirement. Plugin enforces; Mediator's prompt instructs. |
| Recording fires on `session.idle` and on the `mediator_emit_intent` tool call | Two triggers, neither trusts the agent's self-report. The plugin validates the JSON shape and verifies an `approve`-class keyword appeared in a prior user message. |
| Refiner is grounded in the record, validated by empirical evidence (next record) | The Refiner's self-check forces it to defer evaluation to the next record. The current record is the only in-session input. |
| Refiner's patches validated by Zod schema, applied atomically | If validation fails, the file is not written. If the write fails, the provenance index is not updated. |
| Removed sections go to the archive, not deleted | The user can `/mediator-restore <section_id>` to recover. The archive carries the full prior provenance. |
| Git is the user-facing version control | Every plugin-driven change is one commit. Commit message: `refiner: <op> <section_id> for record rcr_xxx / <rationale>`. The user can `git log --grep=rcr_xxx` to trace. |
| Refiner is given tool access (`read`, `grep`, `glob`, `webfetch`, `websearch`) | Per `/docs/agents/`. Research is gated by the cost-discipline rule in the Refiner's prompt. |
| Refiner prompt uses positive-framing examples from the synscribe article, not negative-framing examples from the Snowrabbit doc | The Snowrabbit AGENTS.md style produces pedantic, literal, paranoid models. The synscribe article's value-framing style generalizes better. The Refiner's prompt-craft library is split: Snowrabbit = failure-mode data source; synscribe = style source. |
| Negative-framing ratio in any section must stay under threshold (0.5 default) | The plugin checks the ratio before applying any patch. If exceeded, the Refiner is asked to re-frame. If still exceeded, the user is escalated. |
| Section granularity is surgical, with a Refiner-driven merge pass on growth | One section per failure mode so each is independently refinable. The plugin tracks total prompt token count; when it exceeds 8000 tokens, the plugin runs a merge pass via the Refiner: "find the two most-related sections, merge them into one combined section, citing both sections' provenance as the new section's provenance." The merge is itself a Refiner patch, validated and versioned. |
| Adversarial evaluator uses `oracle` and `momus` (from oh-my-opencode) when detected, otherwise a built-in critic prompt | Plugin calls `client.agent.list()` to detect registered agents. If `oracle` or `momus` is present, the patch is sent to that subagent for a verdict (`approve` / `reject` / `suggest-changes`). If neither is present, the Refiner is invoked a second time with the "critic" system prompt (sourced from the synscribe article's "report outcomes faithfully" + "value framing" + adversarial-thinking patterns). Triggered only on `op: "remove"` and on `refined_count >= 2`. |
| High-risk op user confirmation uses the opencode permission ask flow | On `op: "remove"` or on patches against a section with `refined_count >= 2`, the plugin invokes a registered hidden tool (`apply_refiner_patch`) configured with `permission: "ask"`. The user sees the **standard opencode permission dialog** (same UX as bash-permission asks) instead of a custom toast. Approval lets the tool execute (which is the plugin's own patch-write + commit code); denial drops the patch and logs it. |

---

## 5. Success criteria

A concrete walkthrough:

1. User starts an opencode session. The Mediator is the default agent (`default_agent: "mediator"` in `~/.config/opencode/opencode.json`).
2. User types a vague request. Mediator receives it, forms a `WorkingIntent`, marks unknowns as `open_questions`, asks the first clarifying question.
3. Each turn: the plugin observes `message.updated`, builds the iteration entry. Mediator tags each iteration with a `pattern_tag` from the taxonomy.
4. User answers. Mediator updates `WorkingIntent`. The plugin appends to the iteration chain.
5. When `open_questions` is empty, Mediator presents the `WorkingIntent` as a structured summary ending in "Approve, or correct."
6. User says "approve" (or "go" / "proceed" / "ship it" / green light on the summary). Mediator calls `mediator_emit_intent` with the JSON.
7. Plugin's `tool.execute.before` handler: verifies the `approve` keyword appeared in a prior user message; if not, throws and forces Mediator to keep asking.
8. Plugin's `tool.execute.after` handler: writes the record to `~/.local/share/opencode/mediator/records/<session_id>.jsonl`.
9. Plugin invokes the Refiner: `client.session.create({ parentID, agent: "refiner" })` + `client.session.message(...)` with the record + current prompt + provenance.
10. Refiner returns a JSON patch. Plugin validates (Zod), runs negative-framing ratio check, applies if clean.
11. If the patch contains `op: "remove"`, the plugin moves the section to the archive + fires `tui.toast.show` with the `section_id` to restore.
12. Plugin commits to git: `refiner: <op> <section_id> for record rcr_xxx / <rationale>`.
13. Next Mediator invocation loads the updated prompt via `{file:...}` substitution.

This is the happy path. Edge cases (user correction, repeated pattern, refused patch, empirical evaluation) are covered in §6.

---

## 6. Constraints

- **No raw agent self-reporting.** Recording is the plugin's job. The Mediator's `mediator_emit_intent` call is untrusted input to the plugin, not the record.
- **Approval vocabulary is strict.** "approve / go / proceed / ship it" or explicit green light on the WorkingIntent summary. No implicit approval.
- **Dual-channel prompt modification.** The Refiner's patch is BOTH written to the prompt file (persistent — survives session restart, visible in git) AND injected into the active session via `output.context.push(...)` (or `output.prompt` on `experimental.session.compacting`). Both happen in the same atomic sequence in the plugin. The file is the persistent store; the in-session push is the real-time channel.
- **Refiner's empirical evaluation is out-of-session.** The Refiner cannot know whether its patch worked in this session. It defers to the next 1-3 records.
- **Prompt growth is bounded.** Sections that have been revised 3+ times without resolving the pattern are replaced, not appended to. The pattern library's `refined_count` triggers the cap.
- **Snowrabbit AGENTS.md is data, not style.** The Refiner uses Snowrabbit for failure-mode extraction (trigger quotes → `pattern_tag` taxonomy). It does NOT imitate the negative-framing style.

---

## 7. Out of scope (v1)


- **Cross-user prompt sharing.** Each user's `~/.config/opencode/` is independent. No shared prompt library.
- **Mediator ↔ Assistant handoff is out-of-band.** The Mediator's `approved_intent` is a JSON output; the user (or a future orchestrator) takes that JSON as the input to a new session with the Assistant. The Mediator itself does not spawn the Assistant in v1.
- **Adversarial evaluator always-on.** It runs only for `op: "remove"` and for sections with `refined_count >= 2`. Configurable.
- **Automatic pattern library seeding from Snowrabbit.** Initial templates come from the seed failure modes in §9. The Refiner adds new tags as they emerge.
- **Per-session prompt overrides.** The Refiner rewrites the global Mediator prompt file. There is no per-session prompt in v1.
- **Per-user long-lived Mediator.** The v1 Mediator is per-session: each new opencode session starts a fresh Mediator process; records persist on disk for the Refiner, but the live Mediator has no in-memory continuity across sessions. A **long-lived alternative** is documented in §16 but not implemented in v1.

---

## 8. Reference material — split by use

| Source | Used for | NOT used for |
|---|---|---|
| Liu et al. 2026 (arxiv 2602.07338) — "Intent Mismatch Causes LLMs to Get Lost in Multi-Turn Conversation" | The Mediator framework's theoretical foundation: `C_t → Û` via distillation, contrastive pairs, training-free. The Mediator prompt's "loop" and "approval gate" sections derive from this. | Implementation specifics in any particular framework. |
| Synscribe article — "How Anthropic Builds Claude's System Prompts" | Prompt-craft library style. Named sections, surgical failure-mode rules, value framing, per-model variants, server-injection slot, "looking is not acting", "check your last paragraph", "report outcomes faithfully". | Anthropic-specific tooling. |
| `~/.config/opencode/AGENTS.md` and `~/Desktop/Project/snowrabbit/AGENTS.md` | Failure-mode data: trigger quotes → `pattern_tag` taxonomy. The Refiner's library uses these as data: "here is a failure, here is its tag, here is the section that addresses it." | Prompt style. The negative-framing style is the defect to avoid, not the template to copy. |
| Opencode docs (`opencode.ai/docs/`) | Implementation primitives. Plugin events, agent markdown config, server endpoints, custom tools, slash commands, TUI events. | — |

---

## 9. Seed failure-mode set (initial pattern library)

The Refiner's pattern library starts with these tags. Each tag is the failure mode the Mediator is most likely to exhibit first. The library grows as new tags emerge.

| Tag | Section to revise | Brief |
|---|---|---|
| `out_of_scope_assumption` | `asking_rules` | Mediator adds constraints the user never said |
| `ambiguous_pronoun` | `asking_rules` | Mediator should have asked which noun the pronoun referred to |
| `vague_constraint` | `asking_rules` | Mediator should have asked for the constraint explicitly |
| `missed_approval_keyword` | `approval_gate` | Mediator accepted "yes" instead of "approve / go / proceed / ship it" |
| `premature_action` | `loop` | Mediator tried to execute during clarification |
| `silence_treated_as_approval` | `approval_gate` | Mediator didn't re-prompt after vague response |
| `paraphrasing_user` | `loop` | Mediator paraphrased the user instead of quoting verbatim |
| `twisting_user_words` | `loop` | Mediator reframed the user's complaint as a request |
| `success_pattern` | (no specific section) | Positive reinforcement of the section that produced the success |

---

## 10. Architecture diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  Opencode process                                                  │
│                                                                    │
│  ┌──────────────┐   tool calls    ┌─────────────────────────────┐ │
│  │   Mediator   │────────────────►│   mediator_emit_intent tool │ │
│  │  (primary)   │◄────────────────│   (custom tool, untrusted)  │ │
│  └──────┬───────┘   tool result   └──────────────┬──────────────┘ │
│         │                                        │                │
│         │ (LLM context, untrusted)              │ observed by    │
│         │                                       ▼                │
│         │   ┌──────────────────────────────────────────────┐    │
│         │   │  Recorder Plugin (mediator.ts)               │    │
│         │   │  - subscribes to message.updated,           │    │
│         │   │    tool.execute.before/after, session.idle   │    │
│         │   │  - builds iteration chain in memory          │    │
│         │   │  - validates approve keyword                │    │
│         │   │  - writes record to records/<sid>.jsonl     │    │
│         │   │  - invokes Refiner via client.session.*     │    │
│         │   │  - validates patch (Zod)                     │    │
│         │   │  - negative-framing ratio check              │    │
│         │   │  - rewrites prompts/mediator.md  (persistent)│    │
│         │   │  - pushes new content via                    │    │
│         │   │    output.context.push      (real-time)      │    │
│         │   │  - updates provenance.json                   │    │
│         │   │  - moves removed sections to archive/        │    │
│         │   │  - git add + commit                          │    │
│         │   └────────────┬─────────────────────────────────┘    │
│         │                │                                      │
│         │                ▼ client.session.create({parentID,     │
│         │                  agent: "refiner"})                    │
│         │                                                          │
│         │   ┌──────────────────────────────────────┐              │
│         │   │  Refiner (subagent, hidden)          │              │
│         │   │  - reads record + prompt + provenance│              │
│         │   │  - reads pattern library              │              │
│         │   │  - may research via tools             │              │
│         │   │  - emits JSON patch                   │              │
│         │   │  - self-check (incl. no premature     │              │
│         │   │    validation, positive-framing)      │              │
│         │   └────────────┬─────────────────────────┘              │
│         │                │ patch                                   │
│         │                ▼                                         │
│         │          back to plugin (validate, apply, commit)        │
│         │                                                            │
│  ┌──────▼───────────────────────────────────────────────┐         │
│  │  ~/.config/opencode/prompts/mediator.md  (the prompt) │         │
│  │  rewritten by the plugin; loaded via {file:...}        │         │
│  └────────────────────────────────────────────────────────┘         │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘

User
  │
  │ approves WorkingIntent
  │
  ▼
Plugin validates: approve keyword present?  ──no──►  throw on tool.execute.before
  │                                                  (force Mediator to keep asking)
  yes
  │
  ▼
Plugin writes record to ~/.local/share/opencode/mediator/records/<sid>.jsonl
  │
  ▼
Plugin invokes Refiner (subagent)
  │
  ▼
Refiner returns patch
  │
  ▼
Plugin validates (Zod) + checks negative-framing ratio
  │
  ├─ fails ► reject + log
  │
  └─ passes ►
        │
        ├─ op: "remove" ──► move section to archive/, fire tui.toast.show
        │
        ├─ op: "add" / "revise" ──► write section
        │
        └─ git add + commit (refiner: <op> <section_id> for rcr_xxx)
              │
              ▼
        next Mediator session loads updated prompt
```

---

## 11. Failure-mode handling — the empirical evaluation loop

The Refiner's self-evaluation in the prompt forces it to defer to the next 1-3 records. The plugin tracks this empirically:

1. After applying a patch, the plugin adds the `record_id` to a `pending_evaluation` list keyed by `section_id`.
2. On the next N records, the plugin checks: did the same `pattern_tag` recurred with this section active? If yes, `refined_count += 1`; if not, the section resolved the pattern.
3. The plugin calls the Refiner with the empirical evidence on the next invocation:
   - Section resolved: emit a `success_pattern` provenance update; do not patch.
   - Section didn't help after 3 records: escalate — replace the section with a narrower one.

This closes the loop: the Refiner does not just emit patches, it sees whether they worked.

---

## 12. Vague items — resolved decisions (locked 2026-10-08)

All 12 vague items are now resolved. The columns below are the **locked values**, not defaults. The locked values go into the implementation; if any is later changed, this table is updated and a `refiner: revise §12 <item_id> for rcr_xxx — <rationale>` commit is made.

| # | Item | Locked value | Rationale |
|---|---|---|---|
| 1 | Mediator lifetime | **Per-session** for v1. Long-lived alternative (per-user `~/.local/share/opencode/mediator/users/<user_id>/profile.json` loaded at session start, written at session end) documented in §16, opt-in via `mediator.long_lived: true`. | Simpler, matches opencode's session model. Records persist across sessions for the Refiner; only the live Mediator is per-session. |
| 2 | Approval threshold | **Strict.** Only `approve / go / proceed / ship it` or an explicit green light on the WorkingIntent summary. Bare `yes/ok/thanks/looks good` is NOT approval. Surfaced in the Mediator's prompt, in the summary's last line ("Approve, or correct."), in Mediator's re-prompt text, and enforced by throw on `tool.execute.before` if violated. Plugin validates that an approve-class keyword appeared in a prior user message before the `mediator_emit_intent` tool call succeeds. | Tighter is safer for the lost-in-conversation failure mode. Be explicit so the user always knows what to type. |
| 3 | Refiner section granularity | **Surgical, with a Refiner-driven merge on growth.** One section per failure mode. When total prompt token count exceeds **8000 tokens**, the plugin runs a merge pass via the Refiner: "find the two most-related sections, merge them into one combined section, citing both sections' provenance as the new section's provenance." The merge is itself a Refiner patch, validated and versioned. | Surgical sections are independently refinable. Merge prevents unbounded growth. |
| 4 | Mediator ↔ Assistant handoff | **Out-of-band via opencode's parent-child session mechanism.** When the Mediator's `mediator_emit_intent` is approved, the plugin calls `client.session.create({ parentID: <mediator_session_id>, title: "assistant: <goal>", agent: "assistant" })` then `client.session.message({ sessionID, parts: [{ type: "text", text: JSON.stringify(working_intent) }] })`. The child session can be opened in the same TUI (user can navigate via `session_child_first` / `session_child_cycle`) or run headless via `opencode run --session <id>`. "Out of band" = the Mediator's LLM loop is over, the JSON is the contract, the child session has no leftover Mediator history in its LLM context. | Cleaner separation of concerns. The Mediator's job ends at intent; the Assistant's job starts at execution. |
| 5 | Provenance retention | **Live cap at 5 record_ids per section** (`provenance.json`). Older record_ids on every `op: "revise"` or `op: "remove"` are demoted to `provenance.archive.json` (append-only, unbounded, source of truth for audit). The Refiner reads the live list (≤5 entries per section) on every patch application. Constant: `MAX_PROVENANCE_PER_SECTION = 5`. | Live list fits in the Refiner's prompt context. Archive preserves the full lineage for `/mediator-restore` and post-hoc audit. |
| 6 | Adversarial evaluator cost | **Two-LLM adversarial review** (Refiner + oracle/momus when detected, else built-in critic prompt) only on `op: "remove"` and on patches against a section with `refined_count >= 2`. For routine `add` and `revise`, the Refiner alone is enough. | Routine patches don't need a second opinion; risky patches do. |
| 7 | User checkpoint policy | **Permission ask flow, not typing.** Plugin registers a hidden tool `apply_refiner_patch` with `permission: "ask"`. When a high-risk patch is ready (any `op: "remove"`, any patch against a section with `refined_count >= 2`), the plugin invokes this tool with the patch as input. The user sees the standard opencode permission dialog (same UX as bash-permission asks). Approval executes the plugin's own patch-write + commit code; denial drops the patch and logs it. | More native to opencode than a custom toast. Uses the same UX the user already knows. |
| 8 | Research budget | **3 tool calls typical, 5 for novel patterns.** Refiner's prompt enumerates this budget explicitly; over-budget requires invoking the adversarial evaluator as a "critic" reviewer to validate the spend. | Cost discipline without starving novel work. |
| 9 | Empirical evaluation lag | **1 record flags "no change in pattern"; 3 confirm "section resolved the pattern."** Section's `refined_count` is incremented when 1 record shows the pattern persisted; the section is marked `success_pattern` provenance when 3 records show the pattern gone. The empirical evidence is sent to the Refiner on its next invocation. | One record is enough to flag a problem. Three confirm the fix worked. |
| 10 | Plugin dependencies | **`zod` (validation) and `ulid` (record_ids, patch_ids).** No other deps in v1. | Standard, well-maintained, small. |
| 11 | Hard-never rules preserved in negative-framing style | **Yes.** The synscribe article's "IMPORTANT: You must NEVER generate or guess URLs..." is the hard-never exemplar. URL hallucination and sycophancy are severe failure modes; the rule's sharpness (negative framing) is required for the rule to work. The general default is positive framing; hard-nevers are the exception. They count toward the section's negative-framing ratio and are subject to the same 0.5 cap; if a section becomes too negative because of a hard-never, the hard-never gets its own section and the rest of the section is positive-framed. | Some failure modes are severe enough that negative-framing punch matters more than the general positive-framing default. |
| 12 | Negative-framing ratio threshold | **0.5 default.** Plugin counts negative markers (`don't`, `do not`, `never`, `no.`, `forbidden`, `must not`, `should not`, `avoid`) per section; ratio = negative_clause_count / total_clause_count. If ratio exceeds 0.5, plugin asks the Refiner to re-frame; if re-frame still fails, escalates to the user via `tui.toast.show`. Configurable per-section in the prompt. | 0.5 is the empirically chosen threshold: strict enough to keep the model from becoming pedantic, loose enough to permit hard-never rules. |

---

## 13. Glossary

| Term | Definition |
|---|---|
| **Mediator** | Primary opencode agent that performs iterative intent discovery. Markdown at `~/.config/opencode/agents/mediator.md`. |
| **Refiner** | Hidden subagent that emits prompt patches. Markdown at `~/.config/opencode/agents/refiner.md`. |
| **Recorder plugin** | Opencode plugin at `~/.config/opencode/plugins/mediator.ts`. The trust boundary. |
| **WorkingIntent** | JSON shape: `goal`, `constraints`, `context`, `success_criteria`, `out_of_scope`, `open_questions`. |
| **Record** | JSONL entry per approved Mediator exchange. Includes iteration chain, prompt sections active, and provenance consumed. |
| **Section** | A `## Header` in the Mediator prompt markdown. Has a stable `section_id` (slug of the header). |
| **section_id** | Stable string derived from a section's header. The Refiner's patches reference sections by this. |
| **Patch** | JSON: `{ patch_id, produced_from_records, ops: [{ op, section_id, content, provenance, rationale }] }`. |
| **Provenance** | `section_id → [record_id, ...]`. Updated by the plugin on every patch apply. |
| **Provenance archive** | Directory of removed sections + their prior provenance. Used by `/mediator-restore`. |
| **Pattern tag** | Short string the Mediator attaches to each iteration entry. The Refiner maps tags to sections via the pattern library. |
| **Pattern library** | `~/.local/share/opencode/mediator/patterns.json`. Maps `pattern_tag → known good section template` with `refined_count`. |
| **Negative-framing ratio** | `negative_clause_count / total_clause_count` per section. The plugin enforces a threshold (0.5 default). |

---

## 14. Opencode primitives used

| Mechanism | Primitive | Doc |
|---|---|---|
| Agent markdown config | `~/.config/opencode/agents/<name>.md` | `/docs/agents/` |
| Plugin events | `message.updated`, `tool.execute.before`, `tool.execute.after`, `session.idle`, `session.compacted`, `permission.replied`, `command.executed`, `tui.toast.show` | `/docs/plugins/` |
| Custom tool | `.opencode/tools/<name>.ts` with Zod schema | `/docs/custom-tools/` |
| Slash command | Plugin `command.executed` handler | `/docs/plugins/` |
| Refiner invocation | `client.session.create({ parentID, agent: "refiner" })` + `client.session.message(...)` | `/docs/plugins/` §Basic structure + `/docs/server/` |
| File substitution | `"prompt": "{file:./prompts/mediator.md}"` in agent config | `/docs/config/` §Schema → Agents |
| TUI notification | `tui.toast.show` | `/docs/plugins/` |
| Tool access for Refiner | Standard agent tools (`read`, `grep`, `glob`, `webfetch`, `websearch`) | `/docs/agents/` §Built-in |
| Real-time in-session prompt injection | `output.context.push(...)` or `output.prompt` on `experimental.session.compacting` from the plugin. Persistent-channel and real-time-channel writes happen atomically. | `/docs/plugins/` §Compaction hooks |

---

## 15. Companion docs (to be created during spec phase)

| Doc | Description |
|---|---|
| `record-schema.md` | Full JSON schema for records, with examples. |
| `patch-schema.md` | Full JSON schema for patches, with worked examples. |
| `plugin-contract.md` | The plugin's events and Zod-validated APIs. |
| `failure-mode-taxonomy.md` | The full `pattern_tag` vocabulary, derived from the Snowrabbit trigger quotes and the synscribe article's failure modes. |
| `mediator-prompt.md` | The first-cut Mediator prompt (the seed for `~/.config/opencode/agents/mediator.md`). |
| `refiner-prompt.md` | The first-cut Refiner prompt (the seed for `~/.config/opencode/agents/refiner.md`). |
| `recovery-flow.md` | The exact `/mediator-restore` flow, including git revert vs. provenance-archive restore. |
| `empirical-evaluation.md` | The `pending_evaluation` data structure and the periodic-Refiner invocation. |

---

## 16. Documented alternatives (not implemented in v1)

These are real designs that were considered and explicitly deferred. They are documented here so a future iteration of the project can pick them up without re-deriving them.

### 16.1 Long-lived per-user Mediator

**What it is.** A Mediator process that retains a small per-user profile across opencode sessions. Each new session loads the profile at start and writes it back at end.

**Why deferred.** Adds a state-management surface area (profile schema, profile version, profile migration, stale-knowledge risk, privacy concerns). The per-session Mediator is sufficient for v1; the Refiner learns from records across sessions and gets most of the benefit.

**Mechanism when implemented.**
- Storage: `~/.local/share/opencode/mediator/users/<user_id>/profile.json`.
- Loaded into the Mediator's prompt via a `{file:./users/<user_id>/profile.md}` substitution at session boot.
- Written at session end by the plugin on `session.idle`, after the record is appended.
- Opt-in via `mediator.long_lived: true` in `~/.config/opencode/opencode.json`. Default off.

**Profile contents (draft).**
- `user_id`: stable ulid, created on first use.
- `approve_vocabulary`: which approve-class keywords the user has used most often (e.g., "ship it", "go", "approve"). Used to widen the strict-vocabulary rule when the user has a consistent preference.
- `pattern_affinities`: which `pattern_tag`s the user most often triggers. Used to bias the Refiner's merge decisions toward keeping sections that address the user's hot patterns.
- `preferences`: small set of opt-in preferences (e.g., "prefer positive-framing sections", "always quote verbatim").
- `version`: profile schema version, for migrations.

**Risks when implemented (to be solved before enabling).**
- Stale-knowledge risk: a long-lived profile locks in old preferences the user has outgrown.
- Migration: changing the profile schema requires a migration that preserves user state.
- Privacy: the profile is per-user, but it lives in `~/.local/share/opencode/mediator/users/`. If `OPENCODE_MEDIATOR_SYNC` is ever added, the sync destination is the user's responsibility.
- Discoverability: the user must know `mediator.long_lived: true` exists to turn it on. Documentation in the opencode-mediator README is required.

**Trigger to implement.** When the empirical evaluation shows the per-session Mediator consistently re-asks the same clarifying questions across sessions for the same user. (Signal: ≥ 3 records per session for 5 sessions where the same `pattern_tag` recurs, with no behavioral improvement.)
