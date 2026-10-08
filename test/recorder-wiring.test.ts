import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  handleCompactingHook,
  handleApplyRefinerPatchBefore,
  handleApplyRefinerPatchAfter,
} from "../plugins/recorder.ts";
import { createState, markPending } from "../lib/empirical-evaluation.ts";
import { applyPatch, type PatchInput } from "../plugins/patch-apply.ts";
import { RefinerAllowlist } from "../lib/refiner-allowlist.ts";

const initialPrompt = `# Mediator prompt — opencode-mediator (auto-rendered)

## Approval Gate

The strict approval gate. Bare 'yes/ok' is NOT approval.

## Loop

The Mediator iterates: receive a user message, parse WorkingIntent, ask the next clarifying question or present the summary. Plugin records each iteration. Loop ends when the user explicitly approves.
`;

let dir: string;
let promptPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "recorder-wiring-"));
  promptPath = join(dir, "mediator.md");
  await writeFile(promptPath, initialPrompt);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("handleCompactingHook (D23 dual-channel)", () => {
  test("pushes the latest prompt content into output.context", async () => {
    const ctx: string[] = [];
    await handleCompactingHook(
      { sessionID: "sess-1" },
      { context: ctx },
      {
        promptPath,
        readFileFn: async (p) => (await readFile(p, "utf-8")),
      },
    );
    expect(ctx).toHaveLength(1);
    expect(ctx[0]).toContain("# Mediator prompt (latest)");
    expect(ctx[0]).toContain("## Approval Gate");
    expect(ctx[0]).toContain("## Loop");
  });

  test("pushes a placeholder when the prompt file is missing", async () => {
    const ctx: string[] = [];
    await handleCompactingHook(
      { sessionID: "sess-1" },
      { context: ctx },
      {
        promptPath: join(dir, "nonexistent.md"),
        readFileFn: async () => null,
      },
    );
    expect(ctx).toHaveLength(1);
    expect(ctx[0]).toContain("[unavailable:");
  });

  test("no-op when sessionID is empty", async () => {
    const ctx: string[] = [];
    await handleCompactingHook(
      { sessionID: "" },
      { context: ctx },
      { promptPath },
    );
    expect(ctx).toHaveLength(0);
  });
});

describe("handleApplyRefinerPatchBefore (D24, Zod validation)", () => {
  test("accepts a valid patch without an allowlist token (additive op)", () => {
    const args = {
      patch_id: "pat_001",
      produced_from_records: ["rcr_001"],
      ops: [{ op: "add", section_id: "new-section", content: "Body.", provenance: ["rcr_001"], rationale: "x" }],
      reason: "test",
    };
    expect(() =>
      handleApplyRefinerPatchBefore(
        { tool: "apply_refiner_patch", sessionID: "sess-1", callID: "call-1" },
        { args },
        { allowlist: new RefinerAllowlist() },
      ),
    ).not.toThrow();
  });

  test("rejects a remove op without an allowlist token (D24)", () => {
    const args = {
      patch_id: "pat_002",
      produced_from_records: ["rcr_001"],
      ops: [{ op: "remove", section_id: "approval-gate", provenance: ["rcr_001"], rationale: "x" }],
      reason: "test",
    };
    expect(() =>
      handleApplyRefinerPatchBefore(
        { tool: "apply_refiner_patch", sessionID: "sess-1", callID: "call-1" },
        { args },
        { allowlist: new RefinerAllowlist() },
      ),
    ).toThrow(/allowlist token/);
  });

  test("accepts a remove op when an allowlist token is present", () => {
    const allowlist = new RefinerAllowlist();
    allowlist.add("sess-1");
    const args = {
      patch_id: "pat_003",
      produced_from_records: ["rcr_001"],
      ops: [{ op: "remove", section_id: "approval-gate", provenance: ["rcr_001"], rationale: "x" }],
      reason: "test",
    };
    expect(() =>
      handleApplyRefinerPatchBefore(
        { tool: "apply_refiner_patch", sessionID: "sess-1", callID: "call-1" },
        { args },
        { allowlist },
      ),
    ).not.toThrow();
  });

  test("rejects a payload that fails Zod validation", () => {
    const args = { patch_id: "", ops: [], reason: "test" };
    expect(() =>
      handleApplyRefinerPatchBefore(
        { tool: "apply_refiner_patch", sessionID: "sess-1", callID: "call-1" },
        { args },
      ),
    ).toThrow(/failed schema/);
  });

  test("no-op when tool is not apply_refiner_patch", () => {
    const args = { patch_id: "", ops: [], reason: "test" };
    expect(() =>
      handleApplyRefinerPatchBefore(
        { tool: "mediator_emit_intent", sessionID: "sess-1", callID: "call-1" },
        { args },
      ),
    ).not.toThrow();
  });
});

describe("handleApplyRefinerPatchAfter (D29: empirical-eval markPending)", () => {
  test("calls applyPatch and marks each section pending (V9 1-flags-3-confirms)", async () => {
    const wireArgs = {
      patch_id: "pat_004",
      produced_from_records: ["rcr_001"],
      reason: "clarify approval gate",
      ops: [
        {
          op: "revise",
          section_id: "approval-gate",
          content: "The strict approval gate. Use 'approve / go / proceed / ship it'. Bare 'yes/ok' is NOT approval.",
          provenance: ["rcr_001"],
          rationale: "clarify",
        },
      ],
    };

    let applyCalled = false;
    let applyArgs: PatchInput | null = null;
    const fakeApply = async (patch: PatchInput) => {
      applyCalled = true;
      applyArgs = patch;
      return {
        ok: true,
        appliedOps: 1,
        rejectedOps: [],
        beforeHash: "before",
        afterHash: "after",
      };
    };

    let stateAfter = createState();
    const fakeMarkPending = (
      state: ReturnType<typeof createState>,
      sectionId: string,
      recordId: string,
      patternTag: string,
    ) => {
      stateAfter = markPending(state, sectionId, recordId, patternTag);
      return stateAfter;
    };

    await handleApplyRefinerPatchAfter(
      { tool: "apply_refiner_patch", sessionID: "sess-1", callID: "call-1", args: wireArgs },
      {
        applyPatchFn: fakeApply as unknown as typeof applyPatch,
        markPendingFn: fakeMarkPending as unknown as typeof markPending,
        loadStateFn: () => createState(),
        promptPath,
      },
    );

    expect(applyCalled).toBe(true);
    expect(applyArgs?.patchId).toBe("pat_004");
    expect(stateAfter.pending.get("approval-gate")).toHaveLength(1);
    expect(stateAfter.pending.get("approval-gate")![0]!.recordId).toBe("pat_004");
  });

  test("no-op when tool is not apply_refiner_patch", async () => {
    let applyCalled = false;
    const fakeApply = async () => {
      applyCalled = true;
      return { ok: true, appliedOps: 0, rejectedOps: [], beforeHash: "", afterHash: "" };
    };
    await handleApplyRefinerPatchAfter(
      { tool: "mediator_emit_intent", sessionID: "sess-1", callID: "call-1", args: { patch_id: "x", ops: [], reason: "x" } },
      { applyPatchFn: fakeApply as unknown as typeof applyPatch, promptPath },
    );
    expect(applyCalled).toBe(false);
  });
});
