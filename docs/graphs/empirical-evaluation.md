# empirical-evaluation

The plugin tracks whether a Refiner patch actually worked in subsequent sessions. Implements V9: 1 record flags "no change", 3 records confirm "section resolved the pattern."

## State machine

For each pending record:
- **pending**: just registered via `markPending`.
- **match-count increments** on each `tick(observedTag)` with the same tag.
- **non-match-count increments** on each `tick(observedTag)` with a different tag.
- After 3 matches: status → `invalidated` (pattern persists). Marker commit on main per D19.
- After 3 non-matches: status → `resolved` (section worked). Marked `success_pattern` in the pattern library.

## Live cap

`MAX_PENDING_PER_SECTION = 3`. The 3 records that drive the decision are the same 3 records.

## Why this exists

The Refiner's self-check forces it to defer to the next 1-3 records. The plugin empirically closes the loop by reading subsequent records and updating the [[provenance]] status.
