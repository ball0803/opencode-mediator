# pattern-library

`pattern_tag → known good section template` mapping. Seeded with 9 failure-mode tags; new tags emerge as the system encounters new patterns.

## Seed tags

`out_of_scope_assumption`, `ambiguous_pronoun`, `vague_constraint`, `missed_approval_keyword`, `premature_action`, `silence_treated_as_approval`, `paraphrasing_user`, `twisting_user_words`, `success_pattern`.

## Schema

`pattern_tag → { refined_count, last_refined_record, known_good_section }`.

```json
{
  "missed_approval_keyword": {
    "refined_count": 0,
    "last_refined_record": null,
    "known_good_section": null
  }
}
```

## Growth

When a new `pattern_tag` appears in a record (the Mediator tags each iteration), the plugin appends it to the library with `refined_count: 0`. The Refiner's library maps new tags to existing sections by similarity.

## success_pattern

`success_pattern` is special: it marks a section that empirically resolved a pattern. Used to bias future Refiner decisions (don't touch what works).
