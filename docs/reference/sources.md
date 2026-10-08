# Sources

Bibliography for opencode-mediator. Each source is the canonical reference for a section of the design.

## Primary

Theoretical and stylistic sources for the design.

- **Liu et al. 2026, "Intent Mismatch Causes LLMs to Get Lost in Multi-Turn Conversation"** — https://arxiv.org/abs/2602.07338. The Mediator-Assistant + Refiner framework. Source of the iterative-intent-discovery loop and the approval gate.

- **Synscribe article, "How Anthropic Builds Claude's System Prompts"** — https://www.synscribe.com/blog/how-anthropic-builds-claudes-system-prompts-ai-harnesses-engineering. Prompt-craft style source: positive framing, value framing, named sections, per-model variants, server-injection slot.

## Implementation

The tools and platforms the design targets.

- **Opencode docs** — https://opencode.ai/docs/. Configuration (`/docs/config/`), plugins (`/docs/plugins/`), agents (`/docs/agents/`), server (`/docs/server/`), rules (`/docs/rules/`), skills (`/docs/skills/`), custom tools (`/docs/custom-tools/`), MCP.

- **lat.md CLI** — https://github.com/vercel-labs/lat.md. Knowledge graph tool. Version pinned: `0.12.2`.

## Reference (read-only)

Read-only references the design borrows patterns from.

- **snowrabbit** — https://github.com/anomalyco/snowrabbit. Used for the lat.md setup pattern. See [[snowrabbit]] for attribution.

## Project docs

Local docs that are part of this repo.

- **Intent doc** — `docs/intent/mediator-and-refiner.md`. Source of truth for design. All 12 vague items locked 2026-10-08.
- **Implementation plan** — `docs/plan/implementation-plan.md`. 14 phases, ~70 steps. v1.1.
