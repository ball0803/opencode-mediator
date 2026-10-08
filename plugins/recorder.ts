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
import { ulid } from "ulid";
import { z } from "zod";
import type { Hooks, Plugin } from "@opencode-ai/plugin";
import type { Event } from "@opencode-ai/sdk";
import { KeyedMutex } from "../lib/mutex.ts";
import { JsonlWriter, type Record as JsonlRecord, type RecordIteration } from "../lib/jsonl-writer.ts";
import { globalRefinerAllowlist } from "../lib/refiner-allowlist.ts";
import { applyPatch, type PatchInput, type PatchOp } from "./patch-apply.ts";
import { createState, markPending, type EvaluationState } from "../lib/empirical-evaluation.ts";
import { PatchSchema } from "../schemas/patch.ts";

const APPROVE_KEYWORDS = ["approve", "go", "proceed", "ship it"] as const;

export const WorkingIntentSchema = z.object({
  goal: z.string(),
  constraints: z.array(z.string()).default([]),
  context: z.string().default(""),
  success_criteria: z.array(z.string()).default([]),
  out_of_scope: z.array(z.string()).default([]),
  open_questions: z.array(z.string()).default([]),
});

export type WorkingIntent = z.infer<typeof WorkingIntentSchema>;

export interface IterationEntry {
  readonly iterationIndex: number;
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

const chainMutex = new KeyedMutex();
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

export async function writeRecord(s: SessionState, intent: WorkingIntent): Promise<void> {
  await ensureRecordsDirChmod();
  const lastEntry = s.chain[s.chain.length - 1];
  if (!lastEntry) return;
  const iterations: RecordIteration[] = s.chain.map((e, i) => ({
    iterationIndex: i,
    userMessage: e.userMessage,
    mediatorResponse: e.mediatorResponse,
    patternTag: e.patternTag,
    sectionsActive: [...e.sectionsActive],
  }));
  const record: JsonlRecord = {
    sessionId: s.sessionId,
    recordId: `rcr_${ulid().toLowerCase()}`,
    patternTag: lastEntry.patternTag,
    iterationChain: iterations,
    workingIntent: intent,
    emittedAt: Date.now(),
  };
  await s.writer.append(record);
  lastEntry.recordWritten = true;
}

function extractUserText(info: unknown): string {
  const m = info as { parts?: Array<{ type: string; text?: string }> };
  const textPart = m.parts?.find((p) => p.type === "text");
  return textPart?.text ?? "";
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
  await chainMutex.withKey(sessionID, async () => {
    const s = getOrCreateSession(sessionID);
    const last = s.chain[s.chain.length - 1];
    const next: IterationEntry = {
      iterationIndex: s.chain.length,
      userMessage: userText,
      mediatorResponse: last?.mediatorResponse ?? "",
      patternTag: tagFromMessage(userText),
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
  const id = ulid();
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

function toInternalPatch(parsed: z.infer<typeof PatchSchema>): PatchInput {
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

const RecorderPlugin: Plugin = async () => {
  const hooks: Hooks = {
    event: async (input) => {
      const event = input.event;
      switch (event.type) {
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
      if (!sessionID) return;
      if (toolName === "mediator_emit_intent") {
        const parsed = WorkingIntentSchema.safeParse(output.args);
        if (!parsed.success) {
          throw new Error(`[recorder] mediator_emit_intent payload failed schema: ${parsed.error.message}`);
        }
        const intent: WorkingIntent = parsed.data;
        const approved = await chainMutex.withKey(sessionID, async () => {
          const s = getOrCreateSession(sessionID);
          const lastEntry = s.chain[s.chain.length - 1];
          if (!lastEntry) {
            throw new Error("[recorder] mediator_emit_intent with empty chain");
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
    "tool.execute.after": async (input, _output) => {
      const { tool: toolName, sessionID } = input;
      if (!sessionID) return;
      if (toolName === "mediator_emit_intent") {
        await chainMutex.withKey(sessionID, async () => {
          const s = getOrCreateSession(sessionID);
          const lastEntry = s.chain[s.chain.length - 1];
          if (!lastEntry || !lastEntry.workingIntent) return;
          if (lastEntry.recordWritten) return;
          await writeRecord(s, lastEntry.workingIntent);
        });
        return;
      }
      if (toolName === "apply_refiner_patch") {
        await handleApplyRefinerPatchAfter({
          tool: toolName,
          sessionID,
          callID: input.callID,
          args: (input as { args?: unknown }).args,
        });
        return;
      }
    },
    "experimental.session.compacting": async (input, output) => {
      await handleCompactingHook(
        { sessionID: input.sessionID },
        { context: (output as { context?: string[] }).context, prompt: (output as { prompt?: string }).prompt },
      );
    },
  };
  return hooks;
};

export default RecorderPlugin;
export { RecorderPlugin };
