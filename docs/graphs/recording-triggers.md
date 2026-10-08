# recording-triggers

The recorder plugin subscribes to 7 opencode events. Each event is the trust boundary's view of the session — the agent never self-records.

## Events

The plugin subscribes to 7 opencode events; each is the trust boundary's view of the session.

- `message.updated` — append iteration entry to in-memory chain (via [[dual-channel|KeyedMutex]]), tag with `pattern_tag`.
- `tool.execute.before` — for `mediator_emit_intent`, verify approval keyword; throw if missing.
- `tool.execute.after` — CANONICAL record writer (D29); writes the record via [[empirical-evaluation|JsonlWriter]].
- `session.idle` — finalize record; if not yet written, write it; always invoke [[refiner-flow]].
- `command.executed` — handle `/mediator-restore`.
- `permission.replied` — log denial to `permissions/<denial_id>.json`.
- `experimental.session.compacting` — apply the patch via [[dual-channel]].

## Why 7

Each event covers a distinct stage of the Mediator's lifecycle. The plugin never trusts the agent's self-report; it observes opencode's events.
