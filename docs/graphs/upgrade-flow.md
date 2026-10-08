# upgrade-flow

`upgrade.sh` brings an existing install up to the latest opencode-mediator release. Diffs the current `install.sh` against the new one, applies only deltas, preserves user state.

## Strategy

Diff current vs new install, apply deltas only.

1. Read the user's `~/.local/share/opencode/mediator/VERSION` (or the last-installed version from a sidecar file).
2. Fetch the new version's `install.sh` (git pull, or a release tarball).
3. Diff: identify which symlinks are new vs which already exist, which config keys are new vs which already present.
4. Apply only the deltas: new symlinks are created, existing ones are left alone, config keys are merged (new keys added, existing keys preserved).
5. Update the version sidecar.

## User state preservation

Records, provenance, user-edited config, hand-added sections are all preserved.

- Records, provenance, patterns: untouched.
- Custom user edits to `~/.config/opencode/opencode.json` (e.g., user-added permission rules): preserved.
- Custom Mediator prompt sections the user added by hand: preserved (the upgrade is a Refiner patch, not a rewrite).

## Failure mode

If the upgrade conflicts with the user's `opencode.json` keys, the upgrade writes a `.merge-conflict.json` and stops. The user resolves manually.
