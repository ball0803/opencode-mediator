> Attribution: Originally from [snowrabbit/docs/agents/lat-md-authoring.md](https://github.com/anomalyco/snowrabbit/blob/dev/docs/agents/lat-md-authoring.md) (45 lines, 2264 bytes), copied 2026-10-08 per opencode-mediator plan v1.1 Phase 1.1. See [[snowrabbit]] for the full attribution.

# lat.md Authoring Guide

Rules, syntax, and conventions for writing `lat.md/` files. Load before creating, editing, or reviewing any section in this knowledge graph.

## What belongs in lat.md

`lat.md/` describes **what** the project does and **why** — domain concepts, key design decisions, business logic, test specifications. Files do not duplicate source code; each section is an anchor that source references back to via `@lat:` comments.

Good candidates: architecture decisions with rationale, domain concepts and business rules, API contracts and protocols, test specifications, non-obvious constraints or invariants.

Bad candidates: step-by-step code walkthroughs (the code is the walkthrough), auto-generated API docs, temporary notes or TODOs.

## Section structure

Every section **must** have a leading paragraph — one sentence immediately after the heading, before any child headings. The first paragraph must be ≤250 characters (excluding `[[wiki link]]` content) and is the section's identity in search results. `lat check` enforces this.

## Section IDs

Sections are addressed by file path and heading chain. Full form: `lat.md/path/to/file#Heading#SubHeading`. Short form: `file#Heading#SubHeading` when the file stem is unique.

## Wiki links

Cross-reference other sections or source code with `[[target]]` or `[[target|alias]]`. Reference functions, classes, constants, methods with `[[src/file.ts#symbol]]`. `lat check` validates every target exists.

## Code refs

Tie source back to sections with `// @lat: [[section-id]]` (JS/TS/Rust/Go/C) or `# @lat: [[section-id]]` (Python). Place one comment per section, at the relevant code, not at the file top.

## Test specs

```markdown
---
lat:
  require-code-mention: true
---
```

Add this frontmatter to require every leaf section has a matching `@lat:` comment in test code. `lat check` flags unreferenced specs and dangling refs.

## Frontmatter

Only `lat.require-code-mention: true` is supported. Use it for test-spec files.

## Validation

After any edit, run `lat check`. It validates: all wiki links resolve; all `@lat:` code refs point to existing sections; every section has a leading paragraph ≤250 chars; all `require-code-mention` leaf sections are referenced in code.