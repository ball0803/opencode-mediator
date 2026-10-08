# hook-skip-env

Three `OPENCODE_MEDIATOR_SKIP_LAT_*` env vars let the user bypass specific lat.md checks without disabling the whole system. Canonical names, used by hooks, plugin, and install.sh.

## The three vars

Three `OPENCODE_MEDIATOR_SKIP_LAT_*` env vars, used by hooks, plugin, and install.sh.

- `OPENCODE_MEDIATOR_SKIP_LAT_CHECK=1` — bypasses the pre-commit and pre-push lat checks (warn-only hooks).
- `OPENCODE_MEDIATOR_SKIP_LAT_ENFORCE=1` — bypasses the lat-md-enforce plugin (so the user can edit without lat.md calls).
- `OPENCODE_MEDIATOR_SKIP_LAT_INSTALL=1` — bypasses the lat.md install step in `install.sh`.

## When to use

Skip-env use cases; CI never sets them.

- `SKIP_LAT_CHECK`: testing a commit locally that hasn't been lat-validated yet. The CI still runs the check.
- `SKIP_LAT_ENFORCE`: writing a docs section that's genuinely out of scope for lat.md. Use sparingly; the enforcement is there to keep the graph fresh.
- `SKIP_LAT_INSTALL`: CI runners that already have lat.md pre-installed.

## CI

CI does NOT set these vars. The CI workflow always runs the full lat.md check.
