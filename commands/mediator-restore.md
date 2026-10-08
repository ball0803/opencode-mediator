---
description: Restore a removed section from the opencode-mediator archive
---

# /mediator-restore

Restore a section that was previously removed by the Refiner. The section is read from `~/.local/share/opencode/mediator/archive/<section_id>_<unix>.md` and appended to `prompts/mediator.md`.

Usage: `/mediator-restore <section_id>`

Example: `/mediator-restore approval_gate`
