# provenance

`section_id → record_ids` tracking. The Mediator's prompt sections each carry a list of record_ids that motivated them. Updated by the plugin on every successful patch application.

## Live cap

`provenance.json` carries at most 5 record_ids per section (`MAX_PROVENANCE_PER_SECTION = 5`). Older record_ids are demoted to [[archive|the archive]] on every `op: "revise"` or `op: "remove"`.

## Status field

Each record_id carries a `status: { pending | resolved | invalidated }` field. The status is set by [[empirical-evaluation]]. On `invalidated`, the plugin writes a marker commit on `main` referencing the failed patch's SHA.

## Schema

`section_id → { record_ids: [...], status: { record_id: pending|resolved|invalidated } }`.

```json
{
  "approval_gate": {
    "record_ids": ["rcr_001", "rcr_002", "rcr_003", "rcr_004", "rcr_005"],
    "status": {
      "rcr_001": "resolved",
      "rcr_002": "invalidated",
      "rcr_003": "pending",
      "rcr_004": "resolved",
      "rcr_005": "pending"
    }
  }
}
```

## Why cap at 5

Live list fits in the Refiner's prompt context. Full lineage queryable on demand from the archive.
