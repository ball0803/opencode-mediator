import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyPatch, applyOp, hashPrompt, renderSections, findSection, type PatchInput } from "../plugins/patch-apply.ts";
import { parseSections } from "../lib/section-id.ts";

const initialPrompt = `# Mediator prompt — opencode-mediator (auto-rendered)

## Approval Gate

The strict approval gate. Bare 'yes/ok' is NOT approval.

## Loop

The Mediator iterates: receive a user message, parse WorkingIntent, ask the next clarifying question or present the summary. Plugin records each iteration. Loop ends when the user explicitly approves.
`;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "patch-apply-"));
  await writeFile(join(dir, "mediator.md"), initialPrompt);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("patch-apply (D2, D19, D23, D29)", () => {
  describe("findSection", () => {
    test("finds a section by id", () => {
      const sections = parseSections(initialPrompt);
      expect(findSection(sections, "approval-gate")).not.toBeNull();
      expect(findSection(sections, "nope")).toBeNull();
    });
  });

  describe("applyOp", () => {
    test("add appends a new section", () => {
      const sections = parseSections(initialPrompt);
      const result = applyOp(sections, { op: "add", sectionId: "new-section", content: "Body.", provenance: ["rcr_001"], rationale: "x" });
      expect(result.length).toBe(sections.length + 1);
    });

    test("revise replaces body of an existing section", () => {
      const sections = parseSections(initialPrompt);
      const result = applyOp(sections, { op: "revise", sectionId: "approval-gate", content: "New body.", provenance: ["rcr_001"], rationale: "x" });
      const updated = findSection(result, "approval-gate");
      expect(updated?.body.trim()).toBe("New body.");
    });

    test("remove drops a section", () => {
      const sections = parseSections(initialPrompt);
      const result = applyOp(sections, { op: "remove", sectionId: "approval-gate", provenance: ["rcr_001"], rationale: "x" });
      expect(findSection(result, "approval-gate")).toBeNull();
      expect(result.length).toBe(sections.length - 1);
    });
  });

  describe("hashPrompt", () => {
    test("is deterministic and 16 hex chars", () => {
      const h = hashPrompt("hello world");
      expect(h).toHaveLength(16);
      expect(h).toBe(hashPrompt("hello world"));
      expect(h).not.toBe(hashPrompt("world hello"));
    });
  });

  describe("applyPatch (atomic write + dual-channel serialization)", () => {
    test("rejects negative-framing-ratio > 0.5 (D15)", async () => {
      const path = join(dir, "mediator.md");
      const patch: PatchInput = {
        patchId: "pat_001",
        reason: "test",
        ops: [
          {
            op: "revise",
            sectionId: "approval-gate",
            content: "Don't do this. Never do that. Must not do those. Avoid all. Don't forget. Don't skip. Should not.",
            provenance: ["rcr_001"],
            rationale: "test",
          },
        ],
      };
      const result = await applyPatch(patch, { promptPath: path, empiricalEvaluation: null });
      expect(result.ok).toBe(false);
      expect(result.rejectedOps.length).toBe(1);
      expect(result.rejectedOps[0]!.reason).toContain("0.5");
    });

    test("applies a clean patch atomically (write tmp then rename)", async () => {
      const path = join(dir, "mediator.md");
      const patch: PatchInput = {
        patchId: "pat_002",
        reason: "test",
        ops: [
          {
            op: "revise",
            sectionId: "approval-gate",
            content: "The strict approval gate. Bare 'yes/ok' is NOT approval. Use 'approve / go / proceed / ship it'.",
            provenance: ["rcr_001"],
            rationale: "clarify",
          },
        ],
      };
      const result = await applyPatch(patch, { promptPath: path, empiricalEvaluation: null });
      expect(result.ok).toBe(true);
      expect(result.appliedOps).toBe(1);
      expect(result.beforeHash).not.toBe(result.afterHash);
    });
  });

  describe("renderSections", () => {
    test("produces markdown with H1 + H2 per section", () => {
      const sections = parseSections(initialPrompt);
      const rendered = renderSections(sections);
      expect(rendered).toContain("# Mediator prompt");
      expect(rendered).toContain("## Approval Gate");
    });
  });
});
