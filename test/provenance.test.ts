import { test, expect, describe } from "bun:test";
import {
  addRecordId,
  markResolved,
  markInvalidated,
  MAX_PROVENANCE_PER_SECTION,
} from "../lib/provenance.ts";

describe("provenance (V5, D19, D20)", () => {
  describe("addRecordId", () => {
    test("appends a new record to the section", () => {
      const p = addRecordId({}, "approval_gate", "rcr_001", "pending");
      expect(p.approval_gate!.recordIds).toEqual(["rcr_001"]);
      expect(p.approval_gate!.status.rcr_001).toBe("pending");
    });

    test("caps at MAX_PROVENANCE_PER_SECTION, demoting older entries (D19/D20)", () => {
      let p: ReturnType<typeof addRecordId> = {};
      for (let i = 1; i <= 8; i++) {
        p = addRecordId(p, "loop", `rcr_${i.toString().padStart(3, "0")}`, "pending");
      }
      expect(p.loop!.recordIds.length).toBe(MAX_PROVENANCE_PER_SECTION);
      expect(p.loop!.recordIds).toEqual(["rcr_004", "rcr_005", "rcr_006", "rcr_007", "rcr_008"]);
    });

    test("is idempotent on duplicate record_id", () => {
      const p1 = addRecordId({}, "x", "rcr_001");
      const p2 = addRecordId(p1, "x", "rcr_001");
      expect(p2.x!.recordIds).toEqual(["rcr_001"]);
    });
  });

  describe("markResolved / markInvalidated", () => {
    test("markResolved updates the status for a record_id", () => {
      const p = addRecordId({}, "x", "rcr_001");
      const updated = markResolved(p, "rcr_001");
      expect(updated.x!.status.rcr_001).toBe("resolved");
    });

    test("markInvalidated updates the status for a record_id", () => {
      const p = addRecordId({}, "x", "rcr_001");
      const updated = markInvalidated(p, "rcr_001");
      expect(updated.x!.status.rcr_001).toBe("invalidated");
    });

    test("markResolved is a no-op for unknown record_id", () => {
      const p = addRecordId({}, "x", "rcr_001");
      const updated = markResolved(p, "rcr_999");
      expect(updated.x!.status.rcr_001).toBe("pending");
    });
  });
});
