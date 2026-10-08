# med-flow

The Mediator primary agent's iterative intent discovery flow. Loops until the user explicitly approves a `WorkingIntent` with one of the approval keywords.

## Loop

The Mediator iterates: receive a user message, parse `WorkingIntent`, ask the next clarifying question or present the summary. Plugin records each iteration. Loop ends when the user explicitly approves.

1. User sends a message.
2. Mediator parses the current `WorkingIntent` and the open questions.
3. Mediator asks the next clarifying question OR presents the summary if all questions are resolved.
4. User replies (clarification or approval).
5. Plugin records the iteration entry via `message.updated`.
6. Repeat until user types `approve / go / proceed / ship it` or green-lights the summary.
7. Mediator calls `mediator_emit_intent` with the JSON.
8. Plugin validates approval, writes the record, invokes the [[refiner-flow]].

## Approval gate

The strict vocabulary gate. Bare `yes/ok/thanks/looks good` is NOT approval.

Strict vocabulary: `approve / go / proceed / ship it` OR an explicit green light on the WorkingIntent summary. Bare `yes/ok/thanks/looks good` is NOT approval. Surfaced in 4 places: prompt intro, summary's last line, re-prompt text, failure recovery.

## Out-of-band handoff

When `mediator_emit_intent` is approved, the plugin spawns the Assistant as a child session.

When `mediator_emit_intent` is approved, the plugin calls `client.session.create({ parentID, agent: "assistant" })` + `client.session.message(...)` with the JSON intent as the first user message. The child session is the user's "executor" — see [[overview]] for the top-level architecture.
