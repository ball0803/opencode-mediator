// Originally from https://github.com/anomalyco/snowrabbit/blob/dev/.opencode/plugins/lat-md-enforce.ts
// Forked into opencode-mediator 2026-10-08 per plan v1.1 Phase 2.2.
// Attribution required by the source project's opencode-mediator integration plan.

// .opencode/plugins/lat-md-enforce.ts
//
// Hard-enforcement plugin for the `lat.md/` knowledge graph consultation rule.
//
// Why this exists:
//   The `AGENTS.md` MUST callout for `lat.md/` is followed only ~70% of the time
//   (per amux.io's published "soft vs hard" framing). This plugin pushes that to
//   hard 100% by:
//     1. Re-injecting the MUST reminder into the system prompt on every build
//        (`experimental.chat.system.transform`).
//     2. Blocking Edit / Write / MultiEdit / apply_patch when the agent has
//        not called any lat.md tool at any of FOUR orthogonal boundaries:
//          a) NEW USER TURN      — first tool call after `session.idle` since
//             last consult. A user turn is a decision point: "now do X".
//          b) PENDING -> IN_PROGRESS — when `todowrite` / `todo_write` /
//             `TodoWrite` moves a todo from `pending` to `in_progress`. The
//             agent has just claimed it is working on a new design context and
//             must re-consult before mutating in response.
//          c) NEW ACTIVE TASK   — when `todowrite` / `todo_write` / `TodoWrite`
//             changes the task-list signature since the last consult. Switching
//             tasks = switching design contexts.
//          d) TIME WINDOW        — > 30 min since the last consult, even within
//             a single long-running turn. Safety net against context drift.
//
// Why a count-based gate (e.g. "block every 5 tool calls") was wrong:
//   Long-running tasks legitimately do many reads/greps between edits, and many
//   edits within a single design step. Counting tool calls punishes doing the
//   work. The unit of "consult" is a *decision* (turn / task / drift), not an
//   edit. This plugin uses decision-boundary detection, not call counting.
//
// Important:
//   - Fails open: if the plugin throws, the edit is allowed. The consult gate
//     itself does not depend on the MCP server being up.
//   - Per-session state with TTL cleanup to bound memory.
//   - Session-level events are delivered through the generic `event` hook
//     (the only documented surface in `@opencode-ai/plugin`). Named hooks like
//     `"session.idle"` are NOT in the Hooks interface and are silently ignored
//     at runtime — every other plugin listens via `event.type === "session.idle"`.
import type { Plugin } from "@opencode-ai/plugin"

const MUTATING_TOOLS = new Set([
  "edit", "write", "multiedit", "apply_patch",
])

const LAT_MD_TOOL_PREFIX = "mcp__lat-md__"
const LAT_MD_TOOL_ALIASES = new Set([
  "lat_search", "lat_section", "lat_locate",
  "lat_check", "lat_expand", "lat_refs",
])
const LAT_MD_HARNESS_PREFIX = "lat-md_"

const TASK_LIST_TOOLS = new Set([
  "todowrite", "todo_write", "TodoWrite",
])

const TURN_STALE_MS = 30 * 60 * 1000
const SESSION_TTL_MS = 60 * 60 * 1000
const MAX_TRACKED_SESSIONS = 200

type SessionState = {
  lastConsultAt: number
  lastConsultIdleAt: number
  lastConsultTaskSig: string | null
  currentTaskSig: string | null
  lastIdleAt: number
  lastTouchedAt: number
  // pending -> in_progress transition tracking (boundary b)
  previousTodoStatuses: Map<string, string>
  pendingInProgressAt: number
}

const sessionState = new Map<string, SessionState>()

function getState(sessionID: string): SessionState {
  const now = Date.now()
  const existing = sessionState.get(sessionID)
  if (existing) {
    existing.lastTouchedAt = now
    return existing
  }
  const fresh: SessionState = {
    lastConsultAt: 0,
    lastConsultIdleAt: -1,
    lastConsultTaskSig: null,
    currentTaskSig: null,
    lastIdleAt: -1,
    lastTouchedAt: now,
    previousTodoStatuses: new Map(),
    pendingInProgressAt: 0,
  }
  sessionState.set(sessionID, fresh)
  return fresh
}

function evictIfStale(now: number): void {
  if (sessionState.size <= MAX_TRACKED_SESSIONS) return
  for (const [id, s] of sessionState) {
    if (now - s.lastTouchedAt > SESSION_TTL_MS) sessionState.delete(id)
  }
  if (sessionState.size > MAX_TRACKED_SESSIONS) {
    const entries = [...sessionState.entries()].sort(
      (a, b) => a[1].lastTouchedAt - b[1].lastTouchedAt,
    )
    const toDrop = sessionState.size - MAX_TRACKED_SESSIONS
    for (let i = 0; i < toDrop; i++) sessionState.delete(entries[i][0])
  }
}

function isLatMdConsult(tool: string): boolean {
  if (!tool) return false
  if (tool.startsWith(LAT_MD_TOOL_PREFIX)) return true
  if (LAT_MD_TOOL_ALIASES.has(tool)) return true
  if (tool.startsWith(LAT_MD_HARNESS_PREFIX)) return true
  return false
}

function isTaskListTool(tool: string): boolean {
  return TASK_LIST_TOOLS.has(tool)
}

function hashArgs(args: unknown): string {
  try { return JSON.stringify(args ?? null) } catch { return String(Math.random()) }
}

function recordConsult(sessionID: string): void {
  const s = getState(sessionID)
  const now = Date.now()
  s.lastConsultAt = now
  s.lastConsultIdleAt = s.lastIdleAt
  s.lastConsultTaskSig = s.currentTaskSig
}

function recordTaskSig(sessionID: string, args: unknown): void {
  getState(sessionID).currentTaskSig = hashArgs(args)
}

function recordIdle(sessionID: string): void {
  getState(sessionID).lastIdleAt = Date.now()
}

type GateDecision =
  | { require: false }
  | { require: true; reason: string }

// @lat: [[lat.md/agents/lat-md-gate]]
function detectInProgressTransition(s: SessionState, args: unknown): void {
  const todos = (args && typeof args === "object" && Array.isArray((args as { todos?: unknown }).todos))
    ? (args as { todos: Array<{ content?: unknown; status?: unknown }> }).todos
    : null
  if (!todos) return

  let transitioned = false
  for (const todo of todos) {
    if (!todo || typeof todo.content !== "string" || typeof todo.status !== "string") continue
    const prev = s.previousTodoStatuses.get(todo.content)
    if (prev === "pending" && todo.status === "in_progress") {
      transitioned = true
    }
    s.previousTodoStatuses.set(todo.content, todo.status)
  }
  if (transitioned) {
    s.pendingInProgressAt = Date.now()
  }
}

function shouldRequireConsult(s: SessionState, now: number): GateDecision {
  if (s.lastConsultAt === 0) {
    return { require: true, reason: "no lat.md/ consultation has happened yet in this session" }
  }
  if (s.lastIdleAt > s.lastConsultIdleAt) {
    return { require: true, reason: "new user turn detected (activity resumed after the session went idle)" }
  }
  if (s.pendingInProgressAt > s.lastConsultAt) {
    return { require: true, reason: "a todo just transitioned pending -> in_progress; lat.md/ consult required before edits" }
  }
  if (s.lastConsultTaskSig !== null && s.currentTaskSig !== s.lastConsultTaskSig) {
    return { require: true, reason: "active task list changed since the last lat.md/ consultation" }
  }
  if (now - s.lastConsultAt > TURN_STALE_MS) {
    const minutes = Math.round((now - s.lastConsultAt) / 60000)
    return { require: true, reason: `${minutes} min since last lat.md/ consultation (threshold: ${TURN_STALE_MS / 60000} min)` }
  }
  return { require: false }
}

const SYSTEM_REMINDER = [
  "## lat.md/ knowledge graph consultation (HARD RULE)",
  "",
  "Before designing, refactoring, naming a symbol, planning a feature, or making any non-trivial change in this codebase, you MUST query the `lat.md/` knowledge graph first.",
  "",
  "Consultation is required at each of these boundaries:",
  "- A new user turn begins (activity resumes after the session went idle)",
  "- A todo transitions from `pending` to `in_progress` (via todowrite / todo_write / TodoWrite)",
  "- The active task list changes (via todowrite / todo_write / TodoWrite)",
  "- More than 30 minutes have passed since your last consult",
  "",
  "After ONE consult, you can edit freely within the same turn and task.",
  "",
  "How to consult:",
  "- `lat-md_lat_search(\"query\")` for semantic search",
  "- `lat-md_lat_locate(\"section name\")` for direct lookup",
  "- `lat-md_lat_section(\"section id\")` for full content",
  "- `lat-md_lat_refs(\"section id\")` for incoming / outgoing references",
  "- `lat-md_lat_expand(\"[[refs]]\")` to expand wiki links",
  "",
  "Enforcement: Edit / Write / MultiEdit / apply_patch are BLOCKED at any unmet boundary. You will see a `tool_execution_error`. To proceed, call any lat-md_* tool first, then retry.",
  "",
  "If `lat.md/` itself needs updating (architecture, decisions, behavior changes), call `lat-md_lat_check` after editing and update the affected sections.",
].join("\n")

export const LatMdEnforcePlugin: Plugin = async () => {
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(SYSTEM_REMINDER)
    },

    "tool.execute.before": async (input, _output) => {
      const { tool: toolName, sessionID } = input
      if (!sessionID || !toolName) return

      if (isLatMdConsult(toolName)) {
        recordConsult(sessionID)
        return
      }

      if (!MUTATING_TOOLS.has(toolName)) return

      const s = getState(sessionID)
      const decision = shouldRequireConsult(s, Date.now())
      if (decision.require) {
        throw new Error(
          `[lat-md-enforce] ${toolName} blocked — ${decision.reason}. ` +
            `Call any lat-md_* tool (e.g. lat-md_lat_search, lat-md_lat_locate, lat-md_lat_section) first, ` +
            `then retry. See AGENTS.md §"Use the lat.md/ knowledge graph before designing anything non-trivial."`,
        )
      }
    },

    "tool.execute.after": async (input, _output) => {
      const { tool: toolName, sessionID, args } = input
      if (!sessionID || !toolName) return

      if (isLatMdConsult(toolName)) {
        recordConsult(sessionID)
      } else if (isTaskListTool(toolName)) {
        recordTaskSig(sessionID, args)
        detectInProgressTransition(getState(sessionID), args)
      }
    },

    event: async (input) => {
      const event = input.event as { type?: string; properties?: { sessionID?: string } }
      const sessionID = event?.properties?.sessionID
      if (!sessionID) return

      if (event.type === "session.idle") {
        recordIdle(sessionID)
        evictIfStale(Date.now())
      } else if (event.type === "session.deleted") {
        sessionState.delete(sessionID)
      }
    },
  }
}

export default LatMdEnforcePlugin
