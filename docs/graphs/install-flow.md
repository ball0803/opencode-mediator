# install-flow

`install.sh` orchestrates: clone (or use existing repo), lat.md init, symlink agent + tool files into `~/.config/opencode/`, register the recorder plugin. Race-safe: refuses to run if opencode is live.

## Steps

`install.sh` orchestration: clone, init, symlink, atomic config write. Race-safe.

1. `pgrep -f opencode` — refuse if running.
2. `bun install` in the repo (deps: zod, ulid, p-mutex).
3. `lat init` (idempotent).
4. Symlink `agents/mediator.md`, `agents/refiner.md`, `tools/mediator-emit-intent.ts`, `tools/apply-refiner-patch.ts`, `plugins/recorder.ts`, `plugins/patch-apply.ts` into `~/.config/opencode/`.
5. Atomic write to `~/.config/opencode/opencode.json` (via `.tmp` + `mv`).

## Race protection

`pgrep -f opencode && { echo "opencode is running; stop it first" >&2; exit 1; }` at the top of the script. Atomic write via `opencode.json.tmp` + `mv` to prevent partial-write corruption of the user's config.

## Idempotency

Re-running `install.sh` on an existing install is safe: symlinks are recreated, `opencode.json` is patched in place. v1 does not offer an `--uninstall` flag in install.sh; use `uninstall.sh` instead.
