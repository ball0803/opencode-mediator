# overview

opencode-mediator is a Mediator + Refiner system for opencode. Mediator iterates with strict approval; Refiner emits prompt patches.

## What it is

A thin plugin + agent system that adds iterative-intent discovery to opencode. Three components:

- **Mediator** — primary agent that asks clarifying questions until the user explicitly approves a `WorkingIntent`. Approval vocabulary: `approve / go / proceed / ship it`. Bare `yes/ok/thanks/looks good` is NOT approval.
- **Refiner** — hidden subagent that reads the iteration chain, emits JSON patches against the Mediator's prompt, validated by the plugin. Runs only when triggered.
- **Recorder plugin** — at `plugins/recorder.ts`. Subscribes to 7 events, writes JSONL records, updates provenance, drives the dual-channel prompt modification.

## Where to read next

- [[med-flow]] — how the Mediator iterates
- [[refiner-flow]] — how the Refiner emits patches
- [[recording-triggers]] — what events the plugin watches
- [[dual-channel]] — file + in-session push, atomic
- [[provenance]] — section_id → record_ids
- [[empirical-evaluation]] — V9 1-flags-3-confirms
- [[permission-ask-flow]] — high-risk op user confirmation
- [[adversarial-evaluator]] — second LLM critic layer

Source-of-truth docs:

- [[sources]] — bibliography
- [[snowrabbit]] — attribution
- `docs/intent/mediator-and-refiner.md` — design intent (locked, 351 lines)
- `docs/plan/implementation-plan.md` — 14-phase implementation plan (v1.1, 550 lines)
