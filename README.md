# opencode-mediator

A Mediator agent + Refiner subagent for [opencode](https://opencode.ai). Iteratively clarifies user intent with strict approval gates; a Refiner subagent distills the observed records into prompt patches against the Mediator's prompt.

## Status

Pre-release. Implementation in progress. See `docs/plan/implementation-plan.md` (or the repo's `.omo/plans/`) for the 14-phase rollout.

## Skip-env vars

These bypass lat.md checks when set. The canonical names (Phase 0.6):

| Env | Effect |
|---|---|
| `OPENCODE_MEDIATOR_SKIP_LAT_CHECK=1` | Bypasses pre-commit/pre-push lat check. |
| `OPENCODE_MEDIATOR_SKIP_LAT_ENFORCE=1` | Bypasses the plugin's lat enforcement. |
| `OPENCODE_MEDIATOR_SKIP_LAT_INSTALL=1` | Bypasses the install.sh lat.md install. |

## For the full picture

- **Intent doc** (source of truth for design): `docs/intent/mediator-and-refiner.md`
- **Implementation plan** (14 phases, ~70 steps): `docs/plan/implementation-plan.md`
- **Knowledge graph** (22 pages): `docs/graphs/`

## Privacy

Records persist locally at `~/.local/share/opencode/mediator/records/`. The records directory is `chmod 600`'d on first write (D25). Do not symlink this directory into a shared location.
