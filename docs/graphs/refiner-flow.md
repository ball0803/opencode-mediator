# refiner-flow

The Refiner hidden subagent's patch emission flow. Invoked by the recorder plugin only; never directly by the Mediator or user.

## Invocation

Plugin calls `client.session.create({ parentID, agent: "refiner", hidden: true })` + `client.session.message(...)` with the record + current prompt + provenance + empirical evidence as input. Refiner returns a JSON patch.

## Output

Refiner's JSON patch schema — operations against named Mediator prompt sections.

```
{
  "patch_id": "<ulid>",
  "produced_from_records": ["rcr_001", "rcr_002", ...],
  "ops": [
    { "op": "add"|"revise"|"remove"|"reorder",
      "section_id": "...",
      "content": "...",
      "before_section_id": "...",
      "after_section_id": "...",
      "provenance": ["rcr_001", ...],
      "rationale": "..." }
  ]
}
```

## Self-check forcing

Refiner must defer to next records, not self-evaluate.

Refiner's prompt instructs: "If you cannot prove the patch works in this session, defer to the next 1-3 records." Refiner cannot know empirically whether the patch worked; it must emit a patch and trust [[empirical-evaluation]] to verify.

## When triggered

After a `mediator_emit_intent` is approved; never directly by an untrusted caller.

- Always: after a `mediator_emit_intent` is approved.
- Never directly by an untrusted caller. The [[recording-triggers|recorder plugin]] is the only legitimate caller. Direct programmatic invocation by a non-allowlisted session is refused by [[adversarial-evaluator|the refiner's allowlist check]] (planned for Phase 7).
