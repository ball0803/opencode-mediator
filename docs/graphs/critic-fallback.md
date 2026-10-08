# critic-fallback

Built-in critic prompt invoked when [[oracle]] and [[momus]] are not detected. Sourced from the synscribe article's "report outcomes faithfully" + "value framing" + adversarial-thinking patterns.

## When used

When `client.agent.list()` returns neither `oracle` nor `momus`. The Refiner is invoked a second time with the critic system prompt (instead of its normal patch-emission prompt).

## Prompt source

Sourced from the synscribe article's prompt-craft patterns:
- "Report outcomes faithfully" — the critic must surface bad news, not soften.
- "Value framing" — critique the framing, not just the content.
- "Adversarial thinking" — find weaknesses; don't defend.

## Verdict

Same return shape as [[oracle]] and [[momus]]: `{ verdict, issues, patch_revision? }`.
