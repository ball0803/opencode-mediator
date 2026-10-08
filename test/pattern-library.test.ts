import { test, expect, describe } from "bun:test";
import { defaultLibrary, bumpRefinedCount, SEED_TAGS, patternLibraryPath } from "../lib/pattern-library.ts";

describe("pattern-library (V1, 9 seed tags)", () => {
  test("SEED_TAGS has exactly 9 entries", () => {
    expect(SEED_TAGS.length).toBe(9);
  });

  test("defaultLibrary seeds all 9 tags with zero counts", () => {
    const lib = defaultLibrary();
    for (const tag of SEED_TAGS) {
      expect(lib[tag]).toBeDefined();
      expect(lib[tag]!.refined_count).toBe(0);
      expect(lib[tag]!.last_refined_record).toBeNull();
    }
  });

  test("bumpRefinedCount increments and records the record_id", () => {
    const lib = defaultLibrary();
    const bumped = bumpRefinedCount(lib, "missed_approval_keyword", "rcr_001");
    expect(bumped.missed_approval_keyword!.refined_count).toBe(1);
    expect(bumped.missed_approval_keyword!.last_refined_record).toBe("rcr_001");
  });

  test("bumpRefinedCount for an unknown tag creates a new entry", () => {
    const lib = defaultLibrary();
    const bumped = bumpRefinedCount(lib, "novel_pattern", "rcr_002");
    expect(bumped.novel_pattern).toBeDefined();
    expect(bumped.novel_pattern!.refined_count).toBe(1);
  });

  test("patternLibraryPath is under .local/share/opencode/mediator", () => {
    const p = patternLibraryPath();
    expect(p).toContain(".local/share/opencode/mediator");
    expect(p).toContain("patterns.json");
  });
});
