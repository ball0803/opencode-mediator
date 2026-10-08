# archive

Removed sections are preserved (not deleted) so the user can `/mediator-restore <section_id>` to recover. Storage is append-only; the live [[provenance]] demotes older record_ids here.

## Storage

`~/.local/share/opencode/mediator/archive/<section_id>_<unix_timestamp>.md` — the section content at the time of removal. Plus a sidecar JSON with the section's full prior provenance.

## Recovery

The `/mediator-restore` slash command (handler at `command.executed`) reads the archive, restores the section into `prompts/mediator.md` at the original section header. v1 prefers the most recent archive copy; future versions may offer a list.

## Idempotency

Restoring a section that already exists in the prompt: v1 overwrites; v2 should warn. Restoring a section with no archive copy: error message via `tui.toast.show`.

## Why preserve, not delete

A bad patch (later invalidated by [[empirical-evaluation]]) must be recoverable. The git revert is one option; the archive is a faster local recovery.
