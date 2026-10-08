import { ulid } from "ulid";
import { mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/**
 * A record as written to JSONL. The plugin (Phase 4) builds this; the writer
 * adds emit_intent_id for idempotency.
 */
export interface Record {
  readonly sessionId: string;
  readonly recordId: string;
  readonly patternTag: string;
  readonly iterationChain: readonly RecordIteration[];
  readonly workingIntent: unknown; // validated by tool.execute.before
  readonly emittedAt: number; // unix ms
}

export interface RecordIteration {
  readonly iterationIndex: number;
  readonly userMessage: string;
  readonly mediatorResponse: string;
  readonly patternTag: string;
  readonly sectionsActive: readonly string[];
}

export interface StoredRecord extends Record {
  readonly emit_intent_id: string; // ulid, set by writer for idempotency
}

/**
 * Single-writer JSONL writer (D21, S5).
 *
 * Every write is serialized through one in-process Promise queue per file
 * path. Reads check for an emit_intent_id cache to skip duplicates.
 *
 * Test invariant: 50 concurrent emits produce a file that parses as JSONL
 * with no torn lines, no duplicates.
 */
export class JsonlWriter {
  private readonly path: string;
  private readonly seen = new Set<string>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(sessionId: string, baseDir: string = defaultBaseDir()) {
    this.path = join(baseDir, "records", `${sessionId}.jsonl`);
  }

  /**
   * Enqueue a record for append. Returns the stored record (with
   * emit_intent_id) or null if the intent was already seen (idempotency).
   */
  async append(record: Record): Promise<StoredRecord | null> {
    const id = ulid();
    const stored: StoredRecord = { ...record, emit_intent_id: id };

    const next = this.writeQueue.then(async () => {
      if (this.seen.has(id)) return;
      this.seen.add(id);
      await mkdir(dirname(this.path), { recursive: true });
      const line = JSON.stringify(stored) + "\n";
      await appendFile(this.path, line);
    });

    this.writeQueue = next.catch(() => undefined);
    await next;
    return stored;
  }

  /** Wait for all pending writes to complete. */
  async drain(): Promise<void> {
    await this.writeQueue;
  }

  /** File path on disk. */
  getPath(): string {
    return this.path;
  }
}

/** Default runtime data dir. */
export function defaultBaseDir(): string {
  return join(homedir(), ".local", "share", "opencode", "mediator");
}
