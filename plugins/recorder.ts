/**
 * recorder.ts — opencode-mediator recorder plugin (the trust boundary, D1)
 *
 * Uses opencode's actual plugin API:
 *   - `event` hook (generic) for session lifecycle + message.updated + command.executed + permission.replied
 *   - `tool.execute.before` / `tool.execute.after` for tool calls
 *   - `experimental.session.compacting` for compaction-driven dual-channel modification
 *
 * Trust boundary (D1): the agent never self-records. Every event is observed
 * from outside the LLM context. Chain mutation serialized via KeyedMutex (D22).
 * Record writes go through JsonlWriter's single-writer Promise queue (D21).
 *
 * Patch apply wiring (D19, D23, D29):
 *   - `apply_refiner_patch` tool.execute.before: Zod-validate args, enforce Refiner allowlist
 *   - `apply_refiner_patch` tool.execute.after: call applyPatch, write file, mark empirical-eval pending
 *   - `experimental.session.compacting`: push latest prompt into output.context (dual-channel)
 */

import { mkdir, chmod, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir as _realHomedir } from "node:os";

function home(): string {
  return process.env.HOME ?? _realHomedir();
}
import { randomUUID } from "node:crypto";
import { tool, type Hooks, type Plugin, type ToolDefinition } from "@opencode-ai/plugin";
import type { Event, Permission } from "@opencode-ai/sdk";
import { resolve as pathResolve } from "node:path";
import { globalMutex } from "../lib/mutex.ts";
import { JsonlWriter, type Record as JsonlRecord, type RecordIteration } from "../lib/jsonl-writer.ts";
import { globalRefinerAllowlist } from "../lib/refiner-allowlist.ts";
import { applyPatch, type PatchInput, type PatchOp } from "./patch-apply.ts";
import { createState, markPending, type EvaluationState } from "../lib/empirical-evaluation.ts";
import { PatchSchema, type Patch } from "../schemas/patch.ts";
import { spawnRefinerAndApply, applyAndCommit } from "../lib/refiner-spawn.ts";

const applyRefinerPatchTool: ToolDefinition = tool({
  description:
    "Apply a Refiner patch to the Mediator's prompt file. " +
    "Validated by the recorder plugin (schema + Refiner allowlist); " +
    "persisted atomically with negative-framing ratio check and empirical-eval tracking.",
  args: {
    patch_id: tool.schema.string(),
    reason: tool.schema.string().optional(),
    ops: tool.schema.array(
      tool.schema.object({
        op: tool.schema.enum(["add", "revise", "remove", "reorder"]),
        section_id: tool.schema.string(),
        content: tool.schema.string().optional(),
        before_section_id: tool.schema.string().optional(),
        after_section_id: tool.schema.string().optional(),
        provenance: tool.schema.array(tool.schema.string()),
        rationale: tool.schema.string(),
      }),
    ),
  },
  async execute(_args, _ctx) {
    try {
      const m = await import("node:fs/promises");
      await m.appendFile("/tmp/recorder-debug.log", `[tool.execute apply_refiner_patch] ts=${Date.now()}\n`);
    } catch {}
    return "patch will be applied by recorder";
  },
});

const mediatorEmitIntentTool: ToolDefinition = tool({
  description:
    "Emit the locked WorkingIntent. The recorder plugin enforces the approval gate " +
    "(requires `approve / go / proceed / ship it` or green-light on summary) and " +
    "persists the record to JSONL. Bare 'yes/ok' is rejected.",
  args: {
    goal: tool.schema.string(),
    constraints: tool.schema.array(tool.schema.string()).default([]),
    context: tool.schema.string().default(""),
    success_criteria: tool.schema.array(tool.schema.string()).default([]),
    out_of_scope: tool.schema.array(tool.schema.string()).default([]),
    open_questions: tool.schema.array(tool.schema.string()).default([]),
  },
  async execute(_args, _ctx) {
    try {
      const m = await import("node:fs/promises");
      await m.appendFile("/tmp/recorder-debug.log", `[tool.execute mediator_emit_intent] ts=${Date.now()}\n`);
    } catch {}
    return "intent will be recorded by recorder";
  },
});

let opencodeClient: unknown = null;
let capturedSessionDirectory = "";
let capturedSessionWorktree = "";
let capturedServerUrl: string = "";
const textAccumulator = new Map<string, string>();

export function setOpencodeClient(client: unknown): void {
  opencodeClient = client;
}

export async function getLastUserMessageText(sessionID: string): Promise<string | null> {
  if (!capturedServerUrl) {
    await import("node:fs/promises").then((m) => m.appendFile("/tmp/recorder-debug.log", `[rec] fetchLastUserMessageText: no serverUrl captured yet\n`));
    return null;
  }
  try {
    const url = new URL(`/session/${sessionID}/message`, capturedServerUrl);
    const res = await fetch(url.toString(), {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      await import("node:fs/promises").then((m) => m.appendFile("/tmp/recorder-debug.log", `[rec] fetchLastUserMessageText: HTTP ${res.status} ${res.statusText}\n`));
      return null;
    }
    const msgs = (await res.json()) as Array<Record<string, unknown>>;
    await import("node:fs/promises").then((m) => m.appendFile("/tmp/recorder-debug.log", `[rec] fetchLastUserMessageText: got ${msgs.length} messages for sId=${sessionID}\n`));
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i] as Record<string, unknown> | undefined;
      const info = m?.["info"] as Record<string, unknown> | undefined;
      if (info?.["role"] === "user") {
        const parts = m["parts"] as Array<Record<string, unknown>> | undefined;
        const textPart = parts?.find((p) => p["type"] === "text");
        if (textPart?.["text"]) return String(textPart["text"]);
      }
    }
    await import("node:fs/promises").then((m) => m.appendFile("/tmp/recorder-debug.log", `[rec] fetchLastUserMessageText: no user message with text found in ${msgs.length} messages\n`));
  } catch (err) {
    await import("node:fs/promises").then((m) => m.appendFile("/tmp/recorder-debug.log", `[rec] fetchLastUserMessageText ERROR: ${err instanceof Error ? err.message : String(err)}\n`));
    return null;
  }
  return null;
}

const APPROVE_KEYWORDS = ["approve", "go", "proceed", "ship it"] as const;

export interface WorkingIntent {
  goal: string;
  constraints: string[];
  context: string;
  success_criteria: string[];
  out_of_scope: string[];
  open_questions: string[];
}

function parseWorkingIntent(value: unknown, path: string): WorkingIntent {
  if (typeof value !== "object" || value === null) {
    throw new Error(`[recorder] ${path}: expected object`);
  }
  const v = value as Record<string, unknown>;
  if (typeof v["goal"] !== "string") {
    throw new Error(`[recorder] ${path}.goal: must be string`);
  }
  const stringArray = (x: unknown, p: string): string[] => {
    if (!Array.isArray(x) || !x.every((s) => typeof s === "string")) {
      throw new Error(`[recorder] ${p}: must be array of strings`);
    }
    return x as string[];
  };
  return {
    goal: v["goal"],
    constraints: v["constraints"] === undefined ? [] : stringArray(v["constraints"], `${path}.constraints`),
    context: typeof v["context"] === "string" ? v["context"] : "",
    success_criteria: v["success_criteria"] === undefined ? [] : stringArray(v["success_criteria"], `${path}.success_criteria`),
    out_of_scope: v["out_of_scope"] === undefined ? [] : stringArray(v["out_of_scope"], `${path}.out_of_scope`),
    open_questions: v["open_questions"] === undefined ? [] : stringArray(v["open_questions"], `${path}.open_questions`),
  };
}

export const WorkingIntentSchema = {
  safeParse(value: unknown): { success: true; data: WorkingIntent } | { success: false; error: { message: string } } {
    try {
      return { success: true, data: parseWorkingIntent(value, "WorkingIntent") };
    } catch (err) {
      return { success: false, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  },
};

export interface IterationEntry {
  readonly iterationIndex: number;
  readonly messageID?: string;
  readonly userMessage: string;
  readonly mediatorResponse: string;
  patternTag: string;
  readonly sectionsActive: readonly string[];
  readonly emittedAt: number;
  recordWritten: boolean;
  workingIntent?: WorkingIntent;
  approvedAt?: number;
}

export interface SessionState {
  readonly sessionId: string;
  readonly writer: JsonlWriter;
  readonly chain: IterationEntry[];
  readonly createdAt: number;
}

const chainMutex = globalMutex;
const sessions = new Map<string, SessionState>();
let recordsDirChmodDone = false;

export async function ensureRecordsDirChmod(): Promise<void> {
  if (recordsDirChmodDone) return;
  const dir = join(home(), ".local", "share", "opencode", "mediator", "records");
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await chmod(dir, 0o700);
  recordsDirChmodDone = true;
}

export function __resetRecordsDirChmodForTesting(): void {
  recordsDirChmodDone = false;
}

export function getOrCreateSession(sessionId: string): SessionState {
  let s = sessions.get(sessionId);
  if (!s) {
    s = {
      sessionId,
      writer: new JsonlWriter(sessionId),
      chain: [],
      createdAt: Date.now(),
    };
    sessions.set(sessionId, s);
  }
  return s;
}

export function messageHasApproval(message: string): boolean {
  const lower = message.toLowerCase().trim();
  if (lower === "") return false;
  return APPROVE_KEYWORDS.some((kw) => lower === kw || lower.startsWith(kw + " ") || lower.startsWith(kw + ","));
}

export function isGreenLightOnSummary(userMessage: string, workingIntent: WorkingIntent | undefined): boolean {
  if (!workingIntent) return false;
  const lower = userMessage.toLowerCase();
  if (workingIntent.open_questions.length > 0) return false;
  if (lower.includes("looks good")) return true;
  if (lower.includes("ship it")) return true;
  if (lower.includes("that works")) return true;
  return APPROVE_KEYWORDS.some((kw) => lower === kw || lower.startsWith(kw + " "));
}

export function tagFromMessage(message: string): string {
  const lower = message.toLowerCase();
  if (APPROVE_KEYWORDS.some((kw) => lower === kw || lower.startsWith(kw + " "))) return "missed_approval_keyword";
  if (lower.includes("ok") || lower.includes("sure") || lower.includes("yeah") || lower.includes("yep")) return "silence_treated_as_approval";
  if (lower.length < 20) return "vague_constraint";
  if (lower.split(/\s+/).filter(Boolean).length < 5) return "ambiguous_pronoun";
  return "out_of_scope_assumption";
}

export function lastUserMessageHasApproval(chain: readonly IterationEntry[]): boolean {
  for (let i = chain.length - 1; i >= 0; i--) {
    const msg = chain[i]!.userMessage;
    if (msg.trim() === "") continue;
    return messageHasApproval(msg);
  }
  return false;
}

export async function writeRecord(s: SessionState, intent: WorkingIntent): Promise<string | null> {
  await ensureRecordsDirChmod();
  const lastEntry = s.chain[s.chain.length - 1];
  if (!lastEntry) return null;
  const iterations: RecordIteration[] = s.chain.map((e, i) => ({
    iterationIndex: i,
    userMessage: e.userMessage,
    mediatorResponse: e.mediatorResponse,
    patternTag: e.patternTag,
    sectionsActive: [...e.sectionsActive],
  }));
  const record: JsonlRecord = {
    sessionId: s.sessionId,
    recordId: `rcr_${randomUUID()}`,
    patternTag: lastEntry.patternTag,
    iterationChain: iterations,
    workingIntent: intent,
    emittedAt: Date.now(),
  };
  await s.writer.append(record);
  lastEntry.recordWritten = true;
  return record.recordId;
}

function extractUserText(info: unknown): string {
  const m = info as { parts?: Array<{ type: string; text?: string }> };
  const textPart = m.parts?.find((p) => p.type === "text");
  return textPart?.text ?? "";
}

function handleMessagePartDelta(event: Event): void {
  const props = (event as { properties: Record<string, unknown> }).properties;
  const keys = Object.keys(props).join(",");
  require("fs").writeFileSync("/tmp/recorder-debug.log", `[rec] PART-DELTA keys=${keys} ${JSON.stringify(props).slice(0, 300)}\n`, { flag: "a" });
  const messageID = props["messageID"] as string | undefined;
  const field = props["field"] as string | undefined;
  const delta = props["delta"] as string | undefined;
  if (!messageID || field !== "text" || typeof delta !== "string") return;
  const prev = textAccumulator.get(messageID) ?? "";
  textAccumulator.set(messageID, prev + delta);
}

function handleMessagePartCreatedOrUpdated(event: Event): void {
  const props = (event as { properties: Record<string, unknown> }).properties;
  const keys = Object.keys(props).join(",");
  const part = props["part"] as Record<string, unknown> | undefined;
  const messageID = (props["messageID"] as string | undefined) ?? (part?.["messageID"] as string | undefined);
  if (!messageID) return;
  if (part && part["type"] === "text" && typeof part["text"] === "string" && (part["text"] as string).length > 0) {
    textAccumulator.set(messageID, part["text"] as string);
    require("fs").writeFileSync("/tmp/recorder-debug.log", `[rec] part-text: stored messageID=${messageID} text="${(part["text"] as string).slice(0, 80)}"\n`, { flag: "a" });
    return;
  }
  if (typeof props["text"] === "string" && (props["text"] as string).length > 0) {
    textAccumulator.set(messageID, props["text"] as string);
    require("fs").writeFileSync("/tmp/recorder-debug.log", `[rec] props-text: stored messageID=${messageID} len=${(props["text"] as string).length}\n`, { flag: "a" });
    return;
  }
  require("fs").writeFileSync("/tmp/recorder-debug.log", `[rec] handleMessagePartCreatedOrUpdated: no text found, messageID=${messageID} props.keys=${keys} part=${part ? JSON.stringify(part).slice(0, 200) : "undefined"}\n`, { flag: "a" });
}

async function handleMessageUpdated(event: Event): Promise<void> {
  if (event.type !== "message.updated") return;
  const info = (event as { properties: { info: unknown } }).properties.info;
  if (!info || typeof info !== "object") return;
  const role = (info as { role?: string }).role;
  if (role !== "user") return;
  const sessionID = (info as { sessionID?: string }).sessionID;
  if (!sessionID) return;
  const userText = extractUserText(info);
  const messageID = (info as { id?: string }).id;
  await import("node:fs/promises").then((m) => m.appendFile("/tmp/recorder-debug.log", `[rec] handleMessageUpdated: user msg found, sessionID=${sessionID} messageID=${messageID} extractUserText.len=${userText.length} extractUserText="${userText.slice(0, 60)}"\n`));
  let resolvedText = userText;
  if (!resolvedText && messageID) {
    const accumulated = textAccumulator.get(messageID);
    if (accumulated) {
      resolvedText = accumulated;
      await import("node:fs/promises").then((m) => m.appendFile("/tmp/recorder-debug.log", `[rec] handleMessageUpdated: using accumulated text for user message ${messageID}: "${accumulated.slice(0, 80)}"\n`));
    }
  }
  await chainMutex.withKey(sessionID, async () => {
    const s = getOrCreateSession(sessionID);
    const last = s.chain[s.chain.length - 1];
    if (
      last
      && messageID
      && last.messageID === messageID
      && last.userMessage === resolvedText
    ) {
      await import("node:fs/promises").then((m) => m.appendFile("/tmp/recorder-debug.log", `[rec] handleMessageUpdated: dedup skip messageID=${messageID}\n`));
      return;
    }
    const next: IterationEntry = {
      iterationIndex: s.chain.length,
      messageID,
      userMessage: resolvedText,
      mediatorResponse: last?.mediatorResponse ?? "",
      patternTag: tagFromMessage(resolvedText),
      sectionsActive: last ? [...last.sectionsActive] : ["approval_gate"],
      emittedAt: Date.now(),
      recordWritten: false,
    };
    s.chain.push(next);
  });
}

async function handleSessionIdle(event: Event): Promise<void> {
  if (event.type !== "session.idle") return;
  const sessionID = (event.properties as { sessionID?: string }).sessionID;
  if (!sessionID) return;
  await chainMutex.withKey(sessionID, async () => {
    const s = sessions.get(sessionID);
    if (!s) return;
    const lastEntry = s.chain[s.chain.length - 1];
    if (lastEntry && lastEntry.workingIntent && !lastEntry.recordWritten) {
      await writeRecord(s, lastEntry.workingIntent);
    }
  });
}

function handleSessionDeleted(event: Event): void {
  if (event.type !== "session.deleted") return;
  const sessionID = (event.properties as { sessionID?: string }).sessionID;
  if (!sessionID) return;
  sessions.delete(sessionID);
}

function handleCommandExecuted(event: Event): void {
  if (event.type !== "command.executed") return;
  const props = event.properties as { name?: string; arguments?: string; sessionID?: string };
  if (!props.name || !props.name.startsWith("mediator-restore")) return;
  const sectionId = (props.arguments ?? "").trim().split(/\s+/)[0];
  if (!sectionId) {
    console.warn("[recorder] /mediator-restore requires a section_id");
    return;
  }
  const archiveBase = join(home(), ".local", "share", "opencode", "mediator", "archive");
  console.log(`[recorder] /mediator-restore ${sectionId} — Phase 8 wiring (archive dir: ${archiveBase})`);
}

async function handlePermissionReplied(event: Event): Promise<void> {
  if (event.type !== "permission.replied") return;
  const props = event.properties as { sessionID?: string; response?: string };
  if (!props.sessionID) return;
  if (props.response !== "deny" && props.response !== "no") return;
  const dir = join(home(), ".local", "share", "opencode", "mediator", "permissions");
  await mkdir(dir, { recursive: true });
  const id = randomUUID();
  await writeFile(join(dir, `${id}.json`), JSON.stringify({ sessionID: props.sessionID, response: props.response, at: Date.now() }, null, 2));
}

function handleCompacting(event: Event): void {
  if (event.type !== "session.compacted") return;
  const sessionID = (event.properties as { sessionID?: string }).sessionID;
  if (!sessionID) return;
  console.log(`[recorder] session.compacted ${sessionID} — Phase 5 dual-channel wiring (D23)`);
}

function mediatorPromptPath(): string {
  return process.env.OPENCODE_MEDIATOR_PROMPT_PATH ??
    join(home(), ".local", "share", "opencode", "mediator", "prompts", "mediator.md");
}

function loadEmpiricalState(): EvaluationState {
  return createState();
}

function toInternalPatch(parsed: Patch): PatchInput {
  return {
    patchId: parsed.patch_id,
    reason: parsed.reason ?? "",
    ops: parsed.ops.map(
      (op): PatchOp => ({
        op: op.op,
        sectionId: op.section_id,
        content: op.content,
        beforeSectionId: op.before_section_id,
        afterSectionId: op.after_section_id,
        provenance: op.provenance,
        rationale: op.rationale,
      }),
    ),
  };
}

export interface CompactingHookInput {
  sessionID: string;
}

export interface CompactingHookOutput {
  context?: string[];
  prompt?: string;
}

export interface CompactingDeps {
  promptPath?: string;
  readFileFn?: (path: string) => Promise<string | null>;
}

/**
 * Compaction hook (D23, dual-channel). Reads the latest mediator prompt
 * and pushes it into the output.context so the next compaction-injected
 * context includes the live prompt. If the prompt file is missing or
 * unreadable, pushes a placeholder so the agent knows the path it tried.
 */
export async function handleCompactingHook(
  input: CompactingHookInput,
  output: CompactingHookOutput,
  deps: CompactingDeps = {},
): Promise<void> {
  if (!input.sessionID) return;
  const path = deps.promptPath ?? mediatorPromptPath();
  const read = deps.readFileFn ?? (async (p: string) => existsSync(p) ? await readFile(p, "utf-8") : null);
  let promptContent: string | null = null;
  try {
    promptContent = await read(path);
  } catch (err) {
    console.warn(`[recorder] could not read mediator prompt for compaction: ${(err as Error).message}`);
  }
  const ctx = output.context;
  if (ctx && promptContent) {
    ctx.push(`# Mediator prompt (latest)\n\n${promptContent}`);
  } else if (ctx) {
    ctx.push(`# Mediator prompt (latest)\n\n[unavailable: ${path}]`);
  }
}

export interface ApplyRefinerBeforeInput {
  tool: string;
  sessionID: string;
  callID: string;
}

export interface ApplyRefinerBeforeOutput {
  args?: unknown;
}

export interface ApplyRefinerBeforeDeps {
  allowlist?: { has: (token: string) => boolean };
}

/**
 * `apply_refiner_patch` tool.execute.before: Zod-validate the args, and
 * enforce the Refiner allowlist (D24). If a `remove` op appears without
 * an allowlist token, reject. Other ops are permitted without a token
 * because they are additive (add/revise/reorder are all reversible by
 * the empirical-eval loop).
 */
export function handleApplyRefinerPatchBefore(
  input: ApplyRefinerBeforeInput,
  output: ApplyRefinerBeforeOutput,
  deps: ApplyRefinerBeforeDeps = {},
): void {
  if (input.tool !== "apply_refiner_patch") return;
  const args = output.args;
  const parsed = PatchSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(`[recorder] apply_refiner_patch payload failed schema: ${parsed.error.message}`);
  }
  const allowlist = deps.allowlist ?? globalRefinerAllowlist;
  const hasToken =
    "hasForSession" in allowlist
      ? (allowlist as { hasForSession: (s: string) => boolean }).hasForSession(input.sessionID) ||
        (allowlist as { hasForSession: (s: string) => boolean }).hasForSession(parsed.data.patch_id)
      : allowlist.has(`rfl_${input.sessionID}`);
  if (!hasToken) {
    const hasRemove = parsed.data.ops.some((op) => op.op === "remove");
    if (hasRemove) {
      throw new Error(
        "[recorder] apply_refiner_patch with `remove` op requires an active Refiner allowlist token. " +
          "Spawn a Refiner via the Mediator's patch workflow, not from a bare user turn.",
      );
    }
  }
}

export interface ApplyRefinerAfterInput {
  tool: string;
  sessionID: string;
  callID: string;
  args?: unknown;
}

export interface ApplyRefinerAfterDeps {
  applyPatchFn?: typeof applyPatch;
  markPendingFn?: typeof markPending;
  loadStateFn?: () => EvaluationState;
  promptPath?: string;
}

/**
 * `apply_refiner_patch` tool.execute.after: call applyPatch to write the
 * prompt file (atomic: tmp + rename), then mark each section's
 * empirical-eval as pending. The markPending calls are V9: 1 record
 * flags the section, 3 records confirm.
 */
export async function handleApplyRefinerPatchAfter(
  input: ApplyRefinerAfterInput,
  deps: ApplyRefinerAfterDeps = {},
): Promise<void> {
  if (input.tool !== "apply_refiner_patch") return;
  const parsed = PatchSchema.safeParse(input.args);
  if (!parsed.success) return;
  const internal = toInternalPatch(parsed.data);
  const apply = deps.applyPatchFn ?? applyPatch;
  const mark = deps.markPendingFn ?? markPending;
  const load = deps.loadStateFn ?? loadEmpiricalState;
  const path = deps.promptPath ?? mediatorPromptPath();
  let evalState: EvaluationState = load();
  await apply(internal, { promptPath: path, empiricalEvaluation: evalState });
  for (const op of internal.ops) {
    evalState = mark(evalState, op.sectionId, internal.patchId, "refiner");
  }
}

export const RecorderPlugin: Plugin = async (input) => {
  try { require("fs").writeFileSync("/tmp/recorder-debug.log", `[rec] RecorderPlugin CALLED at ${new Date().toISOString()} input.keys=${Object.keys(input||{}).join(",")} serverUrl=${input?.serverUrl}\n`, { flag: "a" }); } catch(e) { try { require("fs").writeFileSync("/tmp/recorder-debug.log", `[rec] RecorderPlugin CALLED ERROR: ${e.message}\n`, { flag: "a" }); } catch {} }
  setOpencodeClient((input as Record<string, unknown>)?.["client"] ?? null);
  capturedSessionDirectory = input.directory ?? "";
  capturedSessionWorktree = input.worktree ?? "";
  capturedServerUrl = input.serverUrl instanceof URL ? input.serverUrl.toString() : String(input.serverUrl ?? "");
  const hooks: Hooks = {
    event: async (input) => {
      const event = input.event;
      try {
        await import("node:fs/promises").then((m) => m.appendFile("/tmp/recorder-debug.log", `[event] type=${event.type} ts=${Date.now()}\n`));
      } catch {}
      switch (event.type) {
        case "message.part.created":
        case "message.part.updated":
          handleMessagePartCreatedOrUpdated(event);
          return;
        case "message.part.delta":
          handleMessagePartDelta(event);
          return;
        case "message.updated":
          await handleMessageUpdated(event);
          return;
        case "session.idle":
          await handleSessionIdle(event);
          return;
        case "session.deleted":
          handleSessionDeleted(event);
          return;
        case "command.executed":
          handleCommandExecuted(event);
          return;
        case "permission.replied":
          await handlePermissionReplied(event);
          return;
        case "session.compacted":
          handleCompacting(event);
          return;
        default:
          return;
      }
    },
    "tool.execute.before": async (input, output) => {
      const { tool: toolName, sessionID } = input;
      try {
        await import("node:fs/promises").then((m) => m.appendFile("/tmp/recorder-debug.log", `[before] tool=${toolName} session=${sessionID} ts=${Date.now()}\n`));
      } catch {}
      if (!sessionID) return;
      if (!sessionID) return;
      if (toolName === "mediator_emit_intent") {
        const parsed = WorkingIntentSchema.safeParse(output.args);
        if (!parsed.success) {
          throw new Error(`[recorder] mediator_emit_intent payload failed schema: ${parsed.error.message}`);
        }
        const intent: WorkingIntent = parsed.data;
        const approvedFromAccumulator: string | null = (() => {
          for (const [, text] of textAccumulator) {
            if (messageHasApproval(text)) return text;
          }
          return null;
        })();
        if (approvedFromAccumulator) {
          await import("node:fs/promises").then((m) => m.appendFile("/tmp/recorder-debug.log", `[rec] before-hook: pre-mutex accumulator hit "${approvedFromAccumulator.slice(0, 80)}"\n`));
        }
        const approved = await chainMutex.withKey(sessionID, async () => {
          const s = getOrCreateSession(sessionID);
          let lastEntry = s.chain[s.chain.length - 1];
          const needsFetch = !lastEntry || !lastEntry.userMessage || lastEntry.userMessage.trim() === "";
          if (needsFetch) {
            const fetchedText = approvedFromAccumulator ?? (await getLastUserMessageText(sessionID));
            if (fetchedText) {
              await import("node:fs/promises").then((m) => m.appendFile("/tmp/recorder-debug.log", `[rec] before-hook: resolved userMessage="${fetchedText.slice(0, 80)}" (was ${lastEntry ? "empty" : "no entry"}, source=${approvedFromAccumulator ? "accumulator" : "fetch"})\n`));
              if (!lastEntry) {
                const fallbackEntry: IterationEntry = {
                  iterationIndex: s.chain.length,
                  userMessage: fetchedText,
                  mediatorResponse: "",
                  patternTag: tagFromMessage(fetchedText),
                  sectionsActive: [],
                  emittedAt: Date.now(),
                  recordWritten: false,
                };
                s.chain.push(fallbackEntry);
                lastEntry = fallbackEntry;
              } else {
                lastEntry.userMessage = fetchedText;
                lastEntry.patternTag = tagFromMessage(fetchedText);
              }
            } else {
              throw new Error("[recorder] mediator_emit_intent: chain has no usable user message and client fetch returned nothing");
            }
          }
          const ok = lastUserMessageHasApproval(s.chain) || isGreenLightOnSummary(lastEntry.userMessage, intent);
          if (!ok) {
            throw new Error(
              "[recorder] mediator_emit_intent requires explicit approval. " +
                "Bare 'yes/ok' is NOT approval. Use 'approve / go / proceed / ship it' or green-light the summary.",
            );
          }
          lastEntry.workingIntent = intent;
          lastEntry.approvedAt = Date.now();
          return true;
        });
        if (!approved) return;
        return;
      }
      if (toolName === "apply_refiner_patch") {
        handleApplyRefinerPatchBefore(
          { tool: toolName, sessionID, callID: input.callID },
          { args: (output as { args?: unknown }).args },
        );
        return;
      }
    },
    "tool.execute.after": async (input, output) => {
      const { tool: toolName, sessionID } = input;
      try {
        await import("node:fs/promises").then((m) => m.appendFile("/tmp/recorder-debug.log", `[after] tool=${toolName} session=${sessionID} ts=${Date.now()}\n`));
      } catch {}
      if (!sessionID) return;
      if (!sessionID) return;
      if (toolName === "mediator_emit_intent") {
        const writtenRecord: { record: JsonlRecord | null } = { record: null };
        await chainMutex.withKey(sessionID, async () => {
          const s = getOrCreateSession(sessionID);
          const lastEntry = s.chain[s.chain.length - 1];
          if (!lastEntry || !lastEntry.workingIntent) return;
          if (lastEntry.recordWritten) return;
          const recordId = await writeRecord(s, lastEntry.workingIntent);
          writtenRecord.record = {
            sessionId: s.sessionId,
            recordId,
            patternTag: lastEntry.patternTag,
            iterationChain: s.chain.map((e, i) => ({
              iterationIndex: i,
              userMessage: e.userMessage,
              mediatorResponse: e.mediatorResponse,
              patternTag: e.patternTag,
              sectionsActive: [...e.sectionsActive],
            })),
            workingIntent: lastEntry.workingIntent,
            emittedAt: lastEntry.approvedAt ?? Date.now(),
          };
        });
        if (writtenRecord.record) {
          const spawnResult = await spawnRefinerAndApply(sessionID, writtenRecord.record, {
            opencodeClient,
            promptPath: mediatorPromptPath(),
            recordIdToTrack: writtenRecord.record.recordId,
          });
          if (spawnResult.patch) {
            const applyResult = await applyAndCommit(
              spawnResult.patch,
              {
                promptPath: mediatorPromptPath(),
                recordId: writtenRecord.record.recordId,
              },
              applyPatch,
            );
            output.output = JSON.stringify({
              childSessionId: spawnResult.childSessionId,
              patchId: spawnResult.patch.patchId,
              appliedOps: applyResult.appliedOps,
              beforeHash: applyResult.beforeHash,
              afterHash: applyResult.afterHash,
              rejected: applyResult.rejectedOps,
            });
          } else if (spawnResult.error) {
            output.output = JSON.stringify({
              childSessionId: spawnResult.childSessionId,
              error: spawnResult.error,
            });
          }
        }
        return;
      }
      if (toolName === "apply_refiner_patch") {
        const result = await handleApplyRefinerPatchAfter({
          tool: toolName,
          sessionID,
          callID: input.callID,
          args: (input as { args?: unknown }).args,
        });
        if (result && typeof result === "string") {
          output.output = result;
        }
        return;
      }
    },
    "experimental.session.compacting": async (input, output) => {
      await handleCompactingHook(
        { sessionID: input.sessionID },
        { context: (output as { context?: string[] }).context, prompt: (output as { prompt?: string }).prompt },
      );
    },
    "permission.ask": async (input: Permission, output: { status: "ask" | "deny" | "allow" }) => {
      if (input.type !== "write") return;
      const meta = (input.metadata ?? {}) as { filePath?: unknown; filepath?: unknown; path?: unknown };
      const rawPath = typeof meta.filePath === "string"
        ? meta.filePath
        : typeof meta.filepath === "string"
          ? meta.filepath
          : typeof meta.path === "string"
            ? meta.path
            : "";
      if (!rawPath) {
        output.status = "deny";
        return;
      }
      if (!rawPath.endsWith(".md")) {
        output.status = "deny";
        return;
      }
      const allowedRoot = capturedSessionDirectory || capturedSessionWorktree;
      if (!allowedRoot) {
        output.status = "deny";
        return;
      }
      const resolved = pathResolve(rawPath);
      const root = pathResolve(allowedRoot);
      if (resolved !== root && !resolved.startsWith(root + "/")) {
        output.status = "deny";
        return;
      }
      output.status = "allow";
    },
    tool: {
      apply_refiner_patch: applyRefinerPatchTool,
      mediator_emit_intent: mediatorEmitIntentTool,
    },
  };
  return hooks;
};

export default { id: "recorder", server: RecorderPlugin };
