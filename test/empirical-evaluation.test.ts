import { test, expect, describe } from "bun:test";
import {
  createState,
  markPending,
  tick,
  resolved,
  escalate,
  getStatus,
  getPending,
  MAX_PENDING_PER_SECTION,
} from "../lib/empirical-evaluation.ts";

describe("empirical-evaluation", () => {
  describe("createState", () => {
    test("returns empty state with all maps empty", () => {
      const s = createState();
      expect(s.pending.size).toBe(0);
      expect(s.recordStatus.size).toBe(0);
      expect(s.consecutiveCount.size).toBe(0);
    });
  });

  describe("markPending", () => {
    test("registers a record as pending for a section", () => {
      const s = markPending(createState(), "approval_gate", "rcr_001", "missed_approval_keyword");
      const pending = getPending(s, "approval_gate");
      expect(pending.length).toBe(1);
      expect(pending[0]!.recordId).toBe("rcr_001");
      expect(pending[0]!.patternTag).toBe("missed_approval_keyword");
    });

    test("appends multiple records for the same section", () => {
      let s = createState();
      s = markPending(s, "approval_gate", "rcr_001", "missed_approval_keyword");
      s = markPending(s, "approval_gate", "rcr_002", "missed_approval_keyword");
      expect(getPending(s, "approval_gate").length).toBe(2);
    });

    test("caps pending list at MAX_PENDING_PER_SECTION", () => {
      let s = createState();
      // Add 5 records; the oldest 2 should be dropped
      for (let i = 1; i <= 5; i++) {
        s = markPending(s, "loop", `rcr_${i.toString().padStart(3, "0")}`, "premature_action");
      }
      const list = getPending(s, "loop");
      expect(list.length).toBe(MAX_PENDING_PER_SECTION);
      expect(list[0]!.recordId).toBe("rcr_003");
      expect(list[MAX_PENDING_PER_SECTION - 1]!.recordId).toBe("rcr_005");
    });

    test("isolates pending records per section", () => {
      let s = createState();
      s = markPending(s, "a", "rcr_001", "tag_a");
      s = markPending(s, "b", "rcr_002", "tag_b");
      expect(getPending(s, "a").length).toBe(1);
      expect(getPending(s, "b").length).toBe(1);
    });
  });

  describe("tick (V9 — 1 record flags, 3 records confirm)", () => {
    test("1 same-pattern observation: still pending", () => {
      let s = markPending(createState(), "loop", "rcr_001", "premature_action");
      const result = tick(s, "premature_action");
      expect(result.resolved).toHaveLength(0);
      expect(result.invalidated).toHaveLength(0);
      expect(getStatus(result.state, "rcr_001")).toBeUndefined();
    });

    test("3 same-pattern observations: invalidated (S1 critical scenario)", () => {
      let s = markPending(createState(), "loop", "rcr_001", "premature_action");
      // tick 3 times with the SAME pattern tag
      s = tick(s, "premature_action").state;
      s = tick(s, "premature_action").state;
      const result = tick(s, "premature_action");
      expect(result.invalidated).toContain("rcr_001");
      expect(getStatus(result.state, "rcr_001")).toBe("invalidated");
      // Section's pending list is cleared on terminal transition
      expect(getPending(result.state, "loop").length).toBe(0);
    });

    test("3 different-pattern observations: resolved", () => {
      let s = markPending(createState(), "loop", "rcr_001", "premature_action");
      s = tick(s, "different_tag").state;
      s = tick(s, "different_tag").state;
      const result = tick(s, "different_tag");
      expect(result.resolved).toContain("rcr_001");
      expect(getStatus(result.state, "rcr_001")).toBe("resolved");
    });

    test("mixed observations: count from latest pattern", () => {
      let s = markPending(createState(), "loop", "rcr_001", "premature_action");
      s = tick(s, "premature_action").state;
      s = tick(s, "different").state;
      const result = tick(s, "different");
      expect(result.resolved).toContain("rcr_001");
      expect(result.invalidated).toHaveLength(0);
    });

    test("does not mutate input state (pure)", () => {
      const original = markPending(createState(), "loop", "rcr_001", "premature_action");
      const snapshot = {
        pendingSize: original.pending.size,
        statusSize: original.recordStatus.size,
      };
      tick(original, "premature_action");
      expect(original.pending.size).toBe(snapshot.pendingSize);
      expect(original.recordStatus.size).toBe(snapshot.statusSize);
    });
  });

  describe("resolved (manual)", () => {
    test("marks all pending records for a section as resolved", () => {
      let s = createState();
      s = markPending(s, "loop", "rcr_001", "tag_a");
      s = markPending(s, "loop", "rcr_002", "tag_b");
      s = resolved(s, "loop");
      expect(getStatus(s, "rcr_001")).toBe("resolved");
      expect(getStatus(s, "rcr_002")).toBe("resolved");
      expect(getPending(s, "loop").length).toBe(0);
    });

    test("is a no-op on empty section", () => {
      const s = createState();
      const result = resolved(s, "loop");
      expect(result).toBe(s);
    });
  });

  describe("escalate (manual)", () => {
    test("marks all pending records for a section as invalidated", () => {
      let s = createState();
      s = markPending(s, "loop", "rcr_001", "tag_a");
      s = markPending(s, "loop", "rcr_002", "tag_b");
      s = escalate(s, "loop");
      expect(getStatus(s, "rcr_001")).toBe("invalidated");
      expect(getStatus(s, "rcr_002")).toBe("invalidated");
      expect(getPending(s, "loop").length).toBe(0);
    });
  });

  describe("MAX_PENDING_PER_SECTION", () => {
    test("is 3, matching V9 (1 flags, 3 confirm)", () => {
      expect(MAX_PENDING_PER_SECTION).toBe(3);
    });
  });
});
