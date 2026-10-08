# adversarial-evaluator

Second-LLM critic layer on the Refiner's patch. Triggers only on `op: "remove"` and on `refined_count >= 2`. Uses `oracle` or `momus` from oh-my-opencode when detected, otherwise a built-in critic prompt.

## When triggered

On `op: "remove"` and `refined_count >= 2`. Routine `add`/`revise` skip.

- `op: "remove"` (always)
- `refined_count >= 2` (the section has been changed a lot — higher risk)
- Routine `op: "add"` and `op: "revise"`: skip the second-LLM critic

## Detection

`client.agent.list()` called lazily on every high-risk patch. If `oracle` or `momus` is registered, the patch is sent to that subagent for `{ verdict, issues, patch_revision? }`. Otherwise, the Refiner is invoked again with the [[critic-fallback|built-in critic prompt]].

## Verdict shape

```json
{ "verdict": "approve" | "reject" | "suggest-changes",
  "issues": [{ "section_id": "...", "concern": "..." }],
  "patch_revision": { "ops": [...] } }
```

The plugin applies `approve` and `reject` directly; on `suggest-changes` it feeds the `patch_revision` back into the Refiner's main loop.
