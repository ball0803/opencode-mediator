/**
 * session-lifecycle.ts — parent-child session tracking (D30, V4, S7)
 *
 * Plugin tracks `child_sessions: parent_id → child_id[]`. On `session.deleted`,
 * clean up children and pending evaluations. v1: exactly one child per parent.
 */

import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const V1_MAX_CHILDREN_PER_PARENT = 1;

export interface SessionRecord {
  parentSessionId: string;
  childSessionIds: string[];
  createdAt: number;
}

function home(): string {
  return process.env.HOME ?? "/tmp";
}

export function sessionsDir(): string {
  return join(home(), ".local", "share", "opencode", "mediator", "sessions");
}

export function sessionFilePath(parentSessionId: string): string {
  return join(sessionsDir(), `${parentSessionId}.json`);
}

export async function loadSession(parentSessionId: string): Promise<SessionRecord | null> {
  const path = sessionFilePath(parentSessionId);
  if (!existsSync(path)) return null;
  try {
    const text = await readFile(path, "utf-8");
    return JSON.parse(text) as SessionRecord;
  } catch {
    return null;
  }
}

export async function saveSession(rec: SessionRecord): Promise<void> {
  await mkdir(sessionsDir(), { recursive: true });
  await writeFile(sessionFilePath(rec.parentSessionId), JSON.stringify(rec, null, 2) + "\n");
}

export async function createChild(parentSessionId: string, childSessionId: string): Promise<void> {
  const existing = (await loadSession(parentSessionId)) ?? { parentSessionId, childSessionIds: [], createdAt: Date.now() };
  if (existing.childSessionIds.length >= V1_MAX_CHILDREN_PER_PARENT) {
    throw new Error(
      `[session-lifecycle] v1 allows exactly ${V1_MAX_CHILDREN_PER_PARENT} child per parent. ` +
        `Parent ${parentSessionId} already has ${existing.childSessionIds.length} children.`,
    );
  }
  existing.childSessionIds.push(childSessionId);
  await saveSession(existing);
}

export async function cleanupChildren(parentSessionId: string): Promise<void> {
  const path = sessionFilePath(parentSessionId);
  if (existsSync(path)) {
    await unlink(path);
  }
}

export function getChildCount(rec: SessionRecord): number {
  return rec.childSessionIds.length;
}
