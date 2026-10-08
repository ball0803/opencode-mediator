# uninstall-flow

`uninstall.sh` removes the opencode-mediator symlinks and config patches, but preserves user data (records, provenance, patterns, empirical-evaluation state).

## What is removed

Symlinks and the opencode-mediator keys from `opencode.json`.

- Symlinks under `~/.config/opencode/agents/`, `~/.config/opencode/tools/`, `~/.config/opencode/plugins/`, `~/.config/opencode/commands/`.
- The `opencode-mediator` keys from `~/.config/opencode/opencode.json` (preserving all other user config).

## What is preserved

User data: records, provenance, patterns, sessions.

- `~/.local/share/opencode/mediator/records/` (user's iteration history).
- `~/.local/share/opencode/mediator/provenance.json` + `provenance.archive.json`.
- `~/.local/share/opencode/mediator/patterns.json`.
- `~/.local/share/opencode/mediator/sessions/`.

## Recovery

A subsequent `install.sh` re-creates the symlinks; user data is intact.

## Idempotency

Re-running `uninstall.sh` on a clean install is a no-op. Each removal step is idempotent.
