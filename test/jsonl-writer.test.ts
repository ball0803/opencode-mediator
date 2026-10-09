import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlWriter, type Record } from "../lib/jsonl-writer.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "jsonl-writer-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeRecord(sessionId: string, idx: number): Record {
  return {
    sessionId,
    recordId: `rcr_${idx.toString().padStart(3, "0")}`,
    patternTag: "missed_approval_keyword",
    iterationChain: [
      {
        iterationIndex: idx,
        userMessage: "ok",
        mediatorResponse: "approve?",
        patternTag: "missed_approval_keyword",
        sectionsActive: ["approval_gate"],
      },
    ],
    workingIntent: { goal: "test" },
    emittedAt: Date.now(),
  };
}

describe("JsonlWriter (D21, S5)", () => {
  test("writes a single record to a fresh file", async () => {
    const writer = new JsonlWriter("session-1", tmpDir);
    const result = await writer.append(makeRecord("session-1", 1));
    expect(result).not.toBeNull();
    expect(result!.emit_intent_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const content = readFileSync(writer.getPath(), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.recordId).toBe("rcr_001");
    expect(parsed.emit_intent_id).toBe(result!.emit_intent_id);
  });

  test("50 concurrent emits produce 50 well-formed JSONL lines (S5 stress test)", async () => {
    const writer = new JsonlWriter("session-stress", tmpDir);
    const tasks: Promise<unknown>[] = [];
    for (let i = 1; i <= 50; i++) {
      tasks.push(writer.append(makeRecord("session-stress", i)));
    }
    await Promise.all(tasks);
    await writer.drain();

    const content = readFileSync(writer.getPath(), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(50);

    const ids = new Set<string>();
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.emit_intent_id).toBeDefined();
      ids.add(parsed.emit_intent_id);
    }
    expect(ids.size).toBe(50);
  });

  test("appends to an existing file without clobbering", async () => {
    const writer = new JsonlWriter("session-append", tmpDir);
    await writer.append(makeRecord("session-append", 1));
    await writer.drain();
    const writer2 = new JsonlWriter("session-append", tmpDir);
    await writer2.append(makeRecord("session-append", 2));
    await writer2.drain();

    const content = readFileSync(writer.getPath(), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);
  });

  test("drain() waits for in-flight writes to complete", async () => {
    const writer = new JsonlWriter("session-drain", tmpDir);
    for (let i = 0; i < 10; i++) {
      void writer.append(makeRecord("session-drain", i));
    }
    await writer.drain();
    const content = readFileSync(writer.getPath(), "utf-8");
    expect(content.trim().split("\n").length).toBe(10);
  });

  test("getPath() returns the expected path under the records dir", () => {
    const writer = new JsonlWriter("abc123", tmpDir);
    expect(writer.getPath()).toBe(join(tmpDir, "records", "abc123.jsonl"));
  });
});
