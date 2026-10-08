# negative-framing

The plugin enforces a 0.5 cap on the ratio of negative markers per section. The Refiner's prompt uses positive framing by default; negative-framing is the exception, reserved for [[hard-never]] rules.

## Markers

`don't`, `do not`, `never`, `no.`, `forbidden`, `must not`, `should not`, `avoid`.

## Ratio

`negative_clause_count / total_clause_count`. Computed per section before patch application.

## Enforcement

If ratio > 0.5, plugin asks the Refiner to re-frame. If re-frame still fails, escalate to the user via `tui.toast.show`.

## Why

Negative-framed prompts make the model pedantic, literal, paranoid. The Snowrabbit AGENTS.md is a real example of this failure mode. The synscribe article's positive-framing style generalizes better.
