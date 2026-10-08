import { test, expect, describe, beforeEach } from "bun:test";
import {
  WorkingIntentSchema,
  messageHasApproval,
  isGreenLightOnSummary,
  tagFromMessage,
  lastUserMessageHasApproval,
  RecorderPlugin,
} from "../plugins/recorder.ts";

describe("recorder pure functions (Phase 4)", () => {
  describe("messageHasApproval (V2 — strict approval gate)", () => {
    test("matches the four approved keywords exactly", () => {
      expect(messageHasApproval("approve")).toBe(true);
      expect(messageHasApproval("go")).toBe(true);
      expect(messageHasApproval("proceed")).toBe(true);
      expect(messageHasApproval("ship it")).toBe(true);
    });

    test("matches the four keywords as prefixes", () => {
      expect(messageHasApproval("approve this")).toBe(true);
      expect(messageHasApproval("go ahead")).toBe(true);
      expect(messageHasApproval("proceed with the next step")).toBe(true);
      expect(messageHasApproval("ship it now")).toBe(true);
    });

    test("rejects bare yes/ok (per V2 explicit rule)", () => {
      expect(messageHasApproval("yes")).toBe(false);
      expect(messageHasApproval("ok")).toBe(false);
      expect(messageHasApproval("yeah")).toBe(false);
      expect(messageHasApproval("thanks")).toBe(false);
      expect(messageHasApproval("looks good")).toBe(false);
    });

    test("is case-insensitive", () => {
      expect(messageHasApproval("APPROVE")).toBe(true);
      expect(messageHasApproval("Ship It")).toBe(true);
    });

    test("rejects empty / whitespace", () => {
      expect(messageHasApproval("")).toBe(false);
      expect(messageHasApproval("   ")).toBe(false);
    });

    test("rejects partial matches that aren't real approvals", () => {
      expect(messageHasApproval("approved by the team")).toBe(false);
      expect(messageHasApproval("I will go to the store")).toBe(false);
    });
  });

  describe("isGreenLightOnSummary (V2 green-light path)", () => {
    const intent = {
      goal: "x",
      constraints: [],
      context: "",
      success_criteria: [],
      out_of_scope: [],
      open_questions: [],
    };

    test("returns false when there are still open questions", () => {
      expect(isGreenLightOnSummary("ship it", { ...intent, open_questions: ["which API?"] })).toBe(false);
    });

    test("returns true on 'looks good' when questions are empty", () => {
      expect(isGreenLightOnSummary("looks good", intent)).toBe(true);
    });

    test("returns true on 'ship it' when questions are empty", () => {
      expect(isGreenLightOnSummary("ship it", intent)).toBe(true);
    });

    test("returns true on bare 'go' when questions are empty", () => {
      expect(isGreenLightOnSummary("go", intent)).toBe(true);
    });

    test("returns false when intent is undefined", () => {
      expect(isGreenLightOnSummary("ship it", undefined)).toBe(false);
    });
  });

  describe("tagFromMessage (pattern library inference)", () => {
    test("flags approval-class messages", () => {
      expect(tagFromMessage("approve")).toBe("missed_approval_keyword");
      expect(tagFromMessage("ship it now")).toBe("missed_approval_keyword");
    });

    test("flags vague 'ok/sure/yeah' as silence-treated-as-approval", () => {
      expect(tagFromMessage("ok")).toBe("silence_treated_as_approval");
      expect(tagFromMessage("sure")).toBe("silence_treated_as_approval");
      expect(tagFromMessage("yeah do it")).toBe("silence_treated_as_approval");
      expect(tagFromMessage("yep")).toBe("silence_treated_as_approval");
    });

    test("flags short messages as vague_constraint", () => {
      expect(tagFromMessage("do it")).toBe("vague_constraint");
    });

    test("flags brief messages as ambiguous_pronoun", () => {
      expect(tagFromMessage("make it really better")).toBe("ambiguous_pronoun");
    });

    test("defaults to out_of_scope_assumption", () => {
      expect(tagFromMessage("Please set up a comprehensive testing strategy with full coverage")).toBe("out_of_scope_assumption");
    });
  });

  describe("lastUserMessageHasApproval", () => {
    test("walks back through the chain to find the last non-empty user message", () => {
      const chain = [
        { userMessage: "what is X?", mediatorResponse: "", patternTag: "x", sectionsActive: [], emittedAt: 0, recordWritten: false },
        { userMessage: "", mediatorResponse: "", patternTag: "y", sectionsActive: [], emittedAt: 0, recordWritten: false },
        { userMessage: "go", mediatorResponse: "", patternTag: "z", sectionsActive: [], emittedAt: 0, recordWritten: false },
      ];
      expect(lastUserMessageHasApproval(chain as never)).toBe(true);
    });

    test("returns false when no approval in the chain", () => {
      const chain = [
        { userMessage: "ok", mediatorResponse: "", patternTag: "x", sectionsActive: [], emittedAt: 0, recordWritten: false },
      ];
      expect(lastUserMessageHasApproval(chain as never)).toBe(false);
    });

    test("returns false on empty chain", () => {
      expect(lastUserMessageHasApproval([])).toBe(false);
    });
  });

  describe("WorkingIntentSchema (Zod)", () => {
    test("accepts a complete payload", () => {
      const result = WorkingIntentSchema.safeParse({
        goal: "ship a feature",
        constraints: ["no breaking changes"],
        context: "we use bun",
        success_criteria: ["tests pass"],
        out_of_scope: ["v2"],
        open_questions: [],
      });
      expect(result.success).toBe(true);
    });

    test("accepts minimal payload (defaults applied)", () => {
      const result = WorkingIntentSchema.safeParse({ goal: "ship" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.constraints).toEqual([]);
        expect(result.data.context).toBe("");
      }
    });

    test("rejects payload missing required goal", () => {
      const result = WorkingIntentSchema.safeParse({ constraints: [] });
      expect(result.success).toBe(false);
    });
  });

  describe("RecorderPlugin factory (Phase 4 hook registration)", () => {
    let hooks: Awaited<ReturnType<typeof RecorderPlugin>>;

    beforeEach(async () => {
      hooks = await RecorderPlugin({} as never, {});
    });

    test("registers the event hook (generic dispatcher)", () => {
      expect(typeof hooks.event).toBe("function");
    });

    test("registers the tool.execute.before hook", () => {
      expect(typeof hooks["tool.execute.before"]).toBe("function");
    });

    test("registers the tool.execute.after hook", () => {
      expect(typeof hooks["tool.execute.after"]).toBe("function");
    });

    test("registers the experimental.session.compacting hook", () => {
      expect(typeof hooks["experimental.session.compacting"]).toBe("function");
    });

    test("tool.execute.before ignores non-mediator_emit_intent tools", async () => {
      const out = { args: { goal: "x" } };
      await expect(
        hooks["tool.execute.before"]!({ tool: "read", sessionID: "s1", callID: "c1" } as never, out as never),
      ).resolves.toBeUndefined();
    });

    test("tool.execute.after ignores non-mediator_emit_intent tools", async () => {
      await expect(
        hooks["tool.execute.after"]!({ tool: "read", sessionID: "s1", callID: "c1", args: {} } as never, { title: "", output: "", metadata: {} } as never),
      ).resolves.toBeUndefined();
    });

    test("event hook ignores unknown event types", async () => {
      await expect(
        hooks.event!({ event: { type: "unknown.event" } } as never),
      ).resolves.toBeUndefined();
    });
  });
});
