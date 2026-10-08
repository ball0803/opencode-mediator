# momus

The plan critic agent from [oh-my-opencode](https://github.com/anomalyco/oh-my-opencode). Used by the opencode-mediator's `momus` subagent for adversarial review of Refiner patches.

## When used

When `client.agent.list()` returns `momus` in the registered agents. The recorder plugin sends the Refiner's patch + the empirical evidence to `momus` for review.

## Return shape

`momus` returns a structured plan-critique verdict: `{ verdict, issues, patch_revision? }`. Same shape as [[oracle]] (both are review agents with a consistent contract).

## See also

Related reviewers and the layer that uses them.

- [[oracle]] — high-IQ reviewer (also from oh-my-opencode)
- [[critic-fallback]] — built-in critic when neither is detected
- [[adversarial-evaluator]] — the layer that uses these
