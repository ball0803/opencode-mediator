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
 */

import { mkdir, chmod, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ulid } from "ulid";
import { z } from "zod";
import type { Hooks, Plugin } from "@opencode-ai/plugin";
import type { Event } from "@opencode-ai/sdk";
import { KeyedMutex } from "../lib/mutex.ts";
import { JsonlWriter, type Record as JsonlRecord, type RecordIteration } from "../lib/jsonl-writer.ts";

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
  const dir = join(homedir(), ".local", "share", "opencode", "mediator", "records");
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await chmod(dir, 0o600);
  recordsDirChmodDone = true;
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
  const archiveBase = join(homedir(), ".local", "share", "opencode", "mediator", "archive");
  console.log(`[recorder] /mediator-restore ${sectionId} — Phase 8 wiring (archive dir: ${archiveBase})`);
}

async function handlePermissionReplied(event: Event): Promise<void> {
  if (event.type !== "permission.replied") return;
  const props = event.properties as { sessionID?: string; response?: string };
  if (!props.sessionID) return;
  if (props.response !== "deny" && props.response !== "no") return;
  const dir = join(homedir(), ".local", "share", "opencode", "mediator", "permissions");
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
      if (!sessionID || toolName !== "mediator_emit_intent") return;
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
    },
    "tool.execute.after": async (input, _output) => {
      const { tool: toolName, sessionID } = input;
      if (!sessionID || toolName !== "mediator_emit_intent") return;
      await chainMutex.withKey(sessionID, async () => {
        const s = getOrCreateSession(sessionID);
        const lastEntry = s.chain[s.chain.length - 1];
        if (!lastEntry || !lastEntry.workingIntent) return;
        if (lastEntry.recordWritten) return;
        await writeRecord(s, lastEntry.workingIntent);
      });
    },
    "experimental.session.compacting": async (input, _output) => {
      const { sessionID } = input;
      if (!sessionID) return;
      console.log(`[recorder] session.compacting ${sessionID} — Phase 5 dual-channel wiring (D23)`);
    },
  };
  return hooks;
};

export default RecorderPlugin;
export { RecorderPlugin };
