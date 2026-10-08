# recovery-flow

`/mediator-restore <section_id>` is the user's escape hatch for a bad patch. Two recovery modes: archive-based (default) and git-revert (when the archive is missing).

## Archive-based (default)

Reads the most recent archive copy, writes back into `prompts/mediator.md`, commits.

1. User types `/mediator-restore approval_gate`.
2. Plugin's `command.executed` handler reads `~/.local/share/opencode/mediator/archive/approval_gate_<unix>.md` (most recent).
3. Sidecar JSON has the prior provenance.
4. Plugin writes the section back into `prompts/mediator.md` at the original header.
5. Plugin updates the [[provenance]] entry: `status: "restored"`, append a new `rcr_restore_<ulid>` record.
6. Plugin commits to git: `manual: restore approval_gate from archive — rcr_restore_<ulid>`.

## Git-revert (when archive missing)

`git revert <sha>` undoes the removal commit; the revert is a new commit.

1. Plugin reads `git log --grep=refiner: remove approval_gate` to find the SHA.
2. Plugin runs `git revert <sha>` to create a new commit that undoes the removal.
3. Plugin logs the revert record.

## v1 limit

Only the most recent archive copy is restored. Future versions may offer a list (Phase 15+).
