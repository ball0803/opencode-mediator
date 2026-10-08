---
mode: subagent
hidden: true
model: anthropic/claude-haiku-4-5
prompt: "{file:./prompts/refiner.md}"
---

# Refiner — hidden subagent

The Refiner is a hidden subagent invoked by the recorder plugin only. It reads the Mediator's iteration chain, the current prompt, the provenance index, and the empirical-evidence block; emits a JSON patch against named prompt sections; the plugin validates and applies.

## Trust boundary

The `hidden: true` frontmatter controls `@` autocomplete, not direct programmatic invocation. The recorder plugin enforces the trust boundary via `lib/refiner-allowlist.ts` — at spawn time, the plugin mints a capability token and registers it; the Refiner's prompt instructs it to refuse any caller that cannot present a valid token.

## When invoked

The Refiner is invoked by the recorder plugin's `tool.execute.after` handler for `mediator_emit_intent`, on `session.idle`, and on the `experimental.session.compacting` event. Never directly by the Mediator or by the user.

## Patch format

See `prompts/refiner.md` for the full patch schema and the cost-discipline rules.
