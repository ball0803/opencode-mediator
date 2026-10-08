# section-merge-pass

Refiner-driven merge of related sections when total prompt token count exceeds 8000. Surgical sections grow independently until they need consolidation.

## Trigger

`prompts/mediator.md` token count > 8000.

## Algorithm

The plugin runs a merge pass via the Refiner:

```
"Find the two most-related sections. Merge them into one combined section,
citing both sections' provenance as the new section's provenance.
Emit a patch that replaces both with one combined section."
```

## Output

A `op: "revise"` (or `add` + `remove` pair) that produces one combined section. The new section's `section_id` is the slugified version of the merged header. The provenance carries the union of both source sections' record_ids.

## Why

Surgical sections are independently refinable, but unbounded growth is unsustainable. The merge pass is the Refiner's own work — it knows which sections are related.
