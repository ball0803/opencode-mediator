# dual-channel

The Refiner's patch is applied to the Mediator's prompt via two channels atomically. The persistent channel is git-tracked; the real-time channel is the active session.

## Persistent channel

File write to `~/.config/opencode/prompts/mediator.md` (or wherever the Mediator's prompt is stored). Survives session restart. Visible in git. This is the audit trail.

## Real-time channel

`output.context.push(...)` or `output.prompt` set on `experimental.session.compacting`. The active session sees the refined prompt immediately, without waiting for the next session.

## Atomicity

Both writes happen in the same plugin sequence on `experimental.session.compacting`. If `output.context.push` fails, the file write is rolled back. The session cannot observe a half-applied patch.

## Compaction as serialization point

All patch applications go through `experimental.session.compacting`. Hash check aborts on conflict.

All patch applications go through the compaction event. No patch application outside `experimental.session.compacting`. A `prompts/mediator.md` hash is snapshotted before/after; if the hash changes mid-flight (concurrent edit), the patch application is aborted and queued for the next compaction.
