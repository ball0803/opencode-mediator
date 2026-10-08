# Contributing

Every change to opencode-mediator is a **Refiner patch** (preferred) or a **manual fix** (rare). Both go through git.

## Commit format

Refiner-driven:
```
refiner: <op> <section_id> for record rcr_xxx — <rationale>
```

Manual fix:
```
manual: <summary>
```

Invalidation marker (per D19/D20, on `op: "remove"` later invalidated by empirical-evaluation):
```
manual: revert P1 <sha> after empirical-eval fail at rcr_xxx — <rationale>
```

Restore from archive (per recovery-flow):
```
manual: restore <section_id> from archive — rcr_restore_<ulid>
```

## PR requirements

- `bun test` passes (local + CI).
- `lat check md` and `lat check sections` pass.
- The lat.md knowledge graph is updated when adding new concepts, flows, or components.
- PRs require momus (plan critic) review for architectural changes; for typos, no review needed.

## Code style

- TypeScript via `bun`. No `npm`/`pnpm`/`yarn`.
- Pure functions where possible (the recorder plugin owns I/O).
- Tests next to source: `test/foo.test.ts` for `lib/foo.ts`.
- Public API: JSDoc comments at the function/class level.
- No defensive `as any` or `@ts-ignore`.

## Skip-env vars (use sparingly)

| Var | Effect |
|---|---|
| `OPENCODE_MEDIATOR_SKIP_LAT_CHECK=1` | Bypasses pre-commit/pre-push lat check |
| `OPENCODE_MEDIATOR_SKIP_LAT_ENFORCE=1` | Bypasses the lat-md-enforce plugin |
| `OPENCODE_MEDIATOR_SKIP_LAT_INSTALL=1` | Bypasses the lat.md install in install.sh |

CI never sets these.

## Versioning

Semver: `MAJOR.MINOR.PATCH`. `VERSION` is the source; `CHANGELOG.md` is human-readable.

- Breaking change → MAJOR
- New section / decision → MINOR
- Bug fix / typo → PATCH
