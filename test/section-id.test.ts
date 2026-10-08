import { test, expect, describe } from "bun:test";
import {
  slugifyHeader,
  SectionIdAllocator,
  parseSections,
  applyReorder,
} from "../lib/section-id.ts";

describe("section-id (D28, S12)", () => {
  describe("slugifyHeader", () => {
    test("lowercases and replaces whitespace with hyphens", () => {
      expect(slugifyHeader("Approval Gate")).toBe("approval-gate");
    });

    test("strips markdown special characters", () => {
      expect(slugifyHeader("Loop: the `mediator` flow")).toBe("loop-the-mediator-flow");
    });

    test("collapses multiple hyphens", () => {
      expect(slugifyHeader("foo   ---   bar")).toBe("foo-bar");
    });

    test("strips leading/trailing hyphens", () => {
      expect(slugifyHeader("---foo---")).toBe("foo");
    });

    test("returns 'section' for empty input after stripping", () => {
      expect(slugifyHeader("!!!")).toBe("section");
    });
  });

  describe("SectionIdAllocator (collision dedup)", () => {
    test("returns the same slug for the same header", () => {
      const alloc = new SectionIdAllocator();
      expect(alloc.allocate("Approval Gate")).toBe("approval-gate");
      expect(alloc.allocate("approval gate")).toBe("approval-gate-2");
    });

    test("sequential duplicates get -2, -3 suffixes", () => {
      const alloc = new SectionIdAllocator();
      expect(alloc.allocate("Foo")).toBe("foo");
      expect(alloc.allocate("Foo")).toBe("foo-2");
      expect(alloc.allocate("Foo")).toBe("foo-3");
    });
  });

  describe("parseSections", () => {
    test("parses a markdown doc into SectionHeader array", () => {
      const md = "# Title\n\nIntro text.\n\n## Approval Gate\n\nThe gate.\n\n## Loop\n\nThe loop.\n";
      const sections = parseSections(md);
      expect(sections.length).toBe(3);
      expect(sections[0]!.id).toBe("title");
      expect(sections[0]!.level).toBe(1);
      expect(sections[1]!.id).toBe("approval-gate");
      expect(sections[1]!.body).toBe("\nThe gate.\n");
    });
  });

  describe("applyReorder", () => {
    test("reorders sections by before-section-id", () => {
      const sections = [
        { id: "a", header: "A", level: 2, body: "" },
        { id: "b", header: "B", level: 2, body: "" },
        { id: "c", header: "C", level: 2, body: "" },
      ];
      const reordered = applyReorder(sections, { op: "reorder", sectionId: "c", before: "a", after: null });
      expect(reordered.map((s) => s.id)).toEqual(["c", "a", "b"]);
    });

    test("reorders by after-section-id", () => {
      const sections = [
        { id: "a", header: "A", level: 2, body: "" },
        { id: "b", header: "B", level: 2, body: "" },
        { id: "c", header: "C", level: 2, body: "" },
      ];
      const reordered = applyReorder(sections, { op: "reorder", sectionId: "a", before: null, after: "c" });
      expect(reordered.map((s) => s.id)).toEqual(["b", "c", "a"]);
    });
  });
});
