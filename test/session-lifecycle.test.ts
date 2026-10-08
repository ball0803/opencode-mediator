import { test, expect, describe, beforeEach } from "bun:test";
import { loadSession, saveSession, createChild, cleanupChildren, type SessionRecord } from "../lib/session-lifecycle.ts";
import { rm, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let origHome: string | undefined;

beforeEach(async () => {
  origHome = process.env.HOME;
  const fakeHome = join(tmpdir(), `session-lifecycle-test-${Math.random().toString(36).slice(2)}`);
  await mkdir(fakeHome, { recursive: true });
  process.env.HOME = fakeHome;
});

test("session-lifecycle: load returns null when no record exists", async () => {
  const result = await loadSession("nonexistent");
  expect(result).toBeNull();
});

test("session-lifecycle: save then load round-trips", async () => {
  const rec: SessionRecord = {
    parentSessionId: "parent-1",
    childSessionIds: ["child-1"],
    createdAt: 12345,
  };
  await saveSession(rec);
  const loaded = await loadSession("parent-1");
  expect(loaded).toEqual(rec);
});

test("session-lifecycle: createChild on a fresh parent records the child", async () => {
  await createChild("parent-2", "child-1");
  const loaded = await loadSession("parent-2");
  expect(loaded?.childSessionIds).toEqual(["child-1"]);
});

test("session-lifecycle: v1 limit is 1 child per parent (D30)", async () => {
  await createChild("parent-3", "child-1");
  await expect(createChild("parent-3", "child-2")).rejects.toThrow(/exactly 1 child/);
});

test("session-lifecycle: cleanupChildren removes the session file", async () => {
  await createChild("parent-4", "child-1");
  await cleanupChildren("parent-4");
  const loaded = await loadSession("parent-4");
  expect(loaded).toBeNull();
});

test("after: restore HOME", () => {
  if (origHome !== undefined) process.env.HOME = origHome;
});
