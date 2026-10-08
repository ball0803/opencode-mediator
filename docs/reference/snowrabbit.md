# snowrabbit

Attribution to the [snowrabbit](https://github.com/anomalyco/snowrabbit) project, which the opencode-mediator design references for the lat.md knowledge graph setup pattern.

## Borrowed

Authoring guide, enforce plugin, symlink pattern, hook pattern — all from snowrabbit with attribution.

- **Authoring guide** (`docs/agents/lat-md-authoring.md`): copied from `snowrabbit/docs/agents/lat-md-authoring.md` (45 lines, 2264 bytes) with attribution.
- **lat.md-enforce plugin** (planned for Phase 2): forked from `snowrabbit/.opencode/plugins/lat-md-enforce.ts` (266 lines) with attribution comment at line 1.
- **Symlink pattern** (`lat.md -> docs/`): mirrors snowrabbit's structure for the knowledge-graph entry point.
- **Pre-commit / pre-push hooks** (planned for Phase 3.4-3.5): warn-only, gated, tail -20, skip-env aware — same pattern as snowrabbit.

## NOT borrowed

Snowrabbit's negative-framing style, project structure, and snowrabbit-specific tooling.

- **Negative-framing style** in AGENTS.md: snowrabbit's trigger-quote style is the failure-mode data source, not the style template. The Refiner's prompt uses synscribe's positive-framing style.
- **Project structure** (Hexagonal, services, etc.): snowrabbit is a full application; opencode-mediator is a thin plugin/agent system.
- **CI / worktree stack / worktree-quick-instance-popu**: snowrabbit-specific tooling, not relevant.

## License

snowrabbit is the user's own project; attribution is for provenance only.
