# oracle

The high-IQ reasoning agent from [oh-my-opencode](https://github.com/anomalyco/oh-my-opencode). Used by opencode-mediator for adversarial review of Refiner patches and architecture review of plan changes.

## When used

When `client.agent.list()` returns `oracle` in the registered agents. The recorder plugin sends the Refiner's patch + the empirical evidence to `oracle` for review.

## Return shape

`oracle` returns a structured verdict: `{ verdict, issues, patch_revision? }`. Same shape as [[momus]] (both are review agents with a consistent contract).

## See also

Related reviewers and the layer that uses them.

- [[momus]] — plan critic (also from oh-my-opencode)
- [[critic-fallback]] — built-in critic when neither is detected
- [[adversarial-evaluator]] — the layer that uses these
