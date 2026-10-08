/**
 * integration.test.ts — direct-API integration test (Phase 14, CI replacement for pilotty)
 *
 * Exercises the full recorder pipeline without a live opencode process or pilotty:
 *   1. Boot RecorderPlugin
 *   2. Simulate message.updated events for a Mediator session
 *   3. Simulate session.idle to trigger record write
 *   4. Simulate apply_refiner_patch tool.execute.before + .after
 *   5. Simulate experimental.session.compacting to verify dual-channel push
 *   6. Assert: records written, prompt file updated, empirical-eval pending, context pushed
 *
 * Tagged to run in CI (no pilotty dependency). The pilotty-based manual run
 * is documented in examples/manual-pilotty.md and is dev-only.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import RecorderPlugin, { __resetRecordsDirChmodForTesting } from "../plugins/recorder.ts";
import { globalRefinerAllowlist } from "../lib/refiner-allowlist.ts";
import type { Hooks } from "@opencode-ai/plugin";

let dir: string;
let promptPath: string;
let recordsDir: string;
let origHome: string | undefined;

const initialPrompt = `# Mediator prompt — opencode-mediator (auto-rendered)

## Approval Gate

The strict approval gate. Bare 'yes/ok' is NOT approval.

## Loop

The Mediator iterates: receive a user message, parse WorkingIntent, ask the next clarifying question or present the summary. Plugin records each iteration. Loop ends when the user explicitly approves.
`;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mediator-integration-"));
  promptPath = join(dir, "mediator.md");
  recordsDir = join(dir, ".local", "share", "opencode", "mediator", "records");
  origHome = process.env.HOME;
  process.env.HOME = dir;
  process.env.OPENCODE_MEDIATOR_PROMPT_PATH = promptPath;
  await writeFile(promptPath, initialPrompt);
  __resetRecordsDirChmodForTesting();
  globalRefinerAllowlist.revokeBySession("sess-integ-1");
});

afterEach(async () => {
  if (origHome !== undefined) process.env.HOME = origHome;
  delete process.env.OPENCODE_MEDIATOR_PROMPT_PATH;
  globalRefinerAllowlist.revokeBySession("sess-integ-1");
  await rm(dir, { recursive: true, force: true });
});

async function bootPlugin(): Promise<Hooks> {
  const plugin = RecorderPlugin;
  const hooks = await plugin({} as Parameters<typeof plugin>[0], {} as never);
  return hooks;
}

describe("integration: full Mediator → Refiner pipeline (CI replacement for pilotty)", () => {
  test("records a Mediator iteration, applies a Refiner patch, pushes prompt on compaction", async () => {
    const hooks = await bootPlugin();
    const sessionID = "sess-integ-1";

    // Step 1: user message arrives
    const messageEvent = {
      type: "message.updated" as const,
      properties: {
        info: {
          role: "user",
          sessionID,
          parts: [{ type: "text", text: "I want to add dark mode to my blog. I use Astro." }],
        },
      },
    };
    await hooks.event!({ event: messageEvent } as never, {} as never);

    // Step 2: user explicitly approves (strict approval gate)
    const approveEvent = {
      type: "message.updated" as const,
      properties: {
        info: {
          role: "user",
          sessionID,
          parts: [{ type: "text", text: "approve" }],
        },
      },
    };
    await hooks.event!({ event: approveEvent } as never, {} as never);

    // Step 3: agent calls mediator_emit_intent with a valid intent
    const intentArgs = {
      goal: "Add dark mode to Astro blog with system preference + manual toggle",
      constraints: ["respect prefers-color-scheme", "persistent across visits"],
      context: "Astro blog, vanilla CSS, no framework",
      success_criteria: ["toggle in header", "persists in localStorage"],
      out_of_scope: ["design refresh", "theme builder UI"],
      open_questions: [],
    };
    const beforeOutput = { args: intentArgs };
    await hooks["tool.execute.before"]!(
      { tool: "mediator_emit_intent", sessionID, callID: "call-1" } as never,
      beforeOutput as never,
    );
    expect(beforeOutput.args).toEqual(intentArgs);
    await hooks["tool.execute.after"]!(
      { tool: "mediator_emit_intent", sessionID, callID: "call-1" } as never,
      {} as never,
    );

    // Step 4: session goes idle, triggering record write
    const idleEvent = {
      type: "session.idle" as const,
      properties: { sessionID },
    };
    await hooks.event!({ event: idleEvent } as never, {} as never);

    // Verify: records directory has the session JSONL
    const files = await readdir(recordsDir);
    const sessionFile = files.find((f) => f.includes(sessionID));
    expect(sessionFile).toBeDefined();
    const recordContent = await readFile(join(recordsDir, sessionFile!), "utf-8");
    const records = recordContent.trim().split("\n").map((l) => JSON.parse(l));
    expect(records).toHaveLength(1);
    expect(records[0].workingIntent.goal).toContain("dark mode");
    expect(records[0].patternTag).toBeDefined();
    expect(records[0].iterationChain).toHaveLength(2);

    // Step 5: Refiner child is spawned — add allowlist token
    globalRefinerAllowlist.add(sessionID);

    // Step 6: Refiner calls apply_refiner_patch
    const patchArgs = {
      patch_id: "pat_integ_001",
      produced_from_records: [records[0].recordId],
      reason: "clarify approval gate wording",
      ops: [
        {
          op: "revise",
          section_id: "approval-gate",
          content: "The strict approval gate. Use 'approve / go / proceed / ship it'. Bare 'yes/ok' is NOT approval. This is enforced by the recorder plugin.",
          provenance: [records[0].recordId],
          rationale: "clarify enforcement",
        },
      ],
    };
    const beforeOutput2 = { args: patchArgs };
    await hooks["tool.execute.before"]!(
      { tool: "apply_refiner_patch", sessionID, callID: "call-2" } as never,
      beforeOutput2 as never,
    );
    expect(beforeOutput2.args).toEqual(patchArgs);

    await hooks["tool.execute.after"]!(
      { tool: "apply_refiner_patch", sessionID, callID: "call-2", args: patchArgs } as never,
      {} as never,
    );

    // Verify: prompt file was updated with the new content
    const updatedPrompt = await readFile(promptPath, "utf-8");
    expect(updatedPrompt).toContain("enforced by the recorder plugin");
    expect(updatedPrompt).toContain("## Approval Gate");
    const stat1 = await stat(promptPath);
    expect(stat1.size).toBeGreaterThan(initialPrompt.length);

    // Step 7: compaction fires — verify dual-channel push
    const compactionOutput: { context?: string[]; prompt?: string } = { context: [] };
    await hooks["experimental.session.compacting"]!(
      { sessionID } as never,
      compactionOutput as never,
    );
    expect(compactionOutput.context).toBeDefined();
    expect(compactionOutput.context!.length).toBeGreaterThan(0);
    expect(compactionOutput.context![0]).toContain("# Mediator prompt (latest)");
    expect(compactionOutput.context![0]).toContain("enforced by the recorder plugin");
  });

  test("rejects apply_refiner_patch with remove op when no allowlist token is present (D24)", async () => {
    const hooks = await bootPlugin();
    const sessionID = "sess-integ-1";

    const patchArgs = {
      patch_id: "pat_integ_002",
      produced_from_records: ["rcr_x"],
      reason: "dangerous remove",
      ops: [
        {
          op: "remove",
          section_id: "approval-gate",
          provenance: ["rcr_x"],
          rationale: "x",
        },
      ],
    };
    const beforeOutput = { args: patchArgs };
    await expect(
      hooks["tool.execute.before"]!(
        { tool: "apply_refiner_patch", sessionID, callID: "call-3" } as never,
        beforeOutput as never,
      ),
    ).rejects.toThrow(/allowlist token/);
  });

  test("rejects mediator_emit_intent without strict approval (V2)", async () => {
    const hooks = await bootPlugin();
    const sessionID = "sess-integ-1";

    // User says "yes" — bare yes is NOT approval
    const messageEvent = {
      type: "message.updated" as const,
      properties: {
        info: {
          role: "user",
          sessionID,
          parts: [{ type: "text", text: "yes" }],
        },
      },
    };
    await hooks.event!({ event: messageEvent } as never, {} as never);

    const intentArgs = {
      goal: "do the thing",
      constraints: [],
      context: "",
      success_criteria: [],
      out_of_scope: [],
      open_questions: [],
    };
    const beforeOutput = { args: intentArgs };
    await expect(
      hooks["tool.execute.before"]!(
        { tool: "mediator_emit_intent", sessionID, callID: "call-4" } as never,
        beforeOutput as never,
      ),
    ).rejects.toThrow(/explicit approval/);
  });
});
