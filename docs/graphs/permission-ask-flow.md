# permission-ask-flow

High-risk Refiner patches use the standard opencode permission dialog instead of a custom toast. More native to opencode's UX.

## Trigger

High-risk patches use the permission ask flow.

- `op: "remove"` (always)
- Any patch against a section with `refined_count >= 2`

## Tool registration

Programmatic registration on plugin boot; user's main `opencode.json` is never mutated.

The plugin registers a hidden tool `apply_refiner_patch` with `permission: "ask"` programmatically on boot (Q3). User's main `~/.config/opencode/opencode.json` is never mutated by the plugin.

## Flow

Permission ask → approval → execute; or denial → log.

1. Plugin builds a high-risk patch.
2. Plugin invokes the `apply_refiner_patch` tool with the patch as input.
3. User sees the standard opencode permission dialog.
4. Approval: tool's execute runs (the plugin's own file-write + commit code).
5. Denial: patch is dropped, denial is logged to `~/.local/share/opencode/mediator/permissions/<denial_id>.json`.
