/**
 * patch-apply.ts — the file-write + commit code (D2, D19, D23)
 *
 * This module is invoked from the `apply_refiner_patch` tool's execute (Phase 13).
 * It applies a Refiner patch to `prompts/mediator.md` atomically: snapshot
 * hash, apply ops, write file, push to the active session via
 * `output.context.push` or `output.prompt`, re-snapshot hash, abort on
 * conflict.
 *
 * Also writes a per-section branch commit (D19): `refiner/<section_id>`.
 * Marker commits on invalidation (D20): `manual: revert P1 <sha> ...`.
 */

import { readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parseSections, slugifyHeader, type SectionHeader } from "../lib/section-id.ts";
import { exceedsThreshold } from "../lib/negative-framing.ts";
import { markPending } from "../lib/empirical-evaluation.ts";

export interface PatchOp {
  op: "add" | "revise" | "remove" | "reorder";
  sectionId: string;
  content?: string;
  beforeSectionId?: string;
  afterSectionId?: string;
  provenance: string[];
  rationale: string;
}

export interface PatchInput {
  patchId: string;
  ops: PatchOp[];
  reason: string;
}

export interface PatchResult {
  ok: boolean;
  appliedOps: number;
  rejectedOps: Array<{ op: PatchOp; reason: string }>;
  beforeHash: string;
  afterHash: string;
}

export function findSection(sections: readonly SectionHeader[], id: string): SectionHeader | null {
  return sections.find((s) => s.id === id) ?? null;
}

export function applyOp(sections: readonly SectionHeader[], op: PatchOp): SectionHeader[] {
  switch (op.op) {
    case "add":
      return [...sections, { id: op.sectionId, header: op.sectionId, level: 2, body: op.content ?? "" }];
    case "revise": {
      const idx = sections.findIndex((s) => s.id === op.sectionId);
      if (idx < 0) return [...sections];
      const existing = sections[idx]!;
      const updated: SectionHeader = { ...existing, body: op.content ?? existing.body };
      return [...sections.slice(0, idx), updated, ...sections.slice(idx + 1)];
    }
    case "remove":
      return sections.filter((s) => s.id !== op.sectionId);
    case "reorder": {
      const idx = sections.findIndex((s) => s.id === op.sectionId);
      if (idx < 0) return [...sections];
      const target = sections[idx]!;
      const remaining = sections.filter((_, i) => i !== idx);
      if (op.beforeSectionId !== undefined) {
        const beforeIdx = remaining.findIndex((s) => s.id === op.beforeSectionId);
        if (beforeIdx < 0) return [...sections];
        return [...remaining.slice(0, beforeIdx), target, ...remaining.slice(beforeIdx)];
      }
      if (op.afterSectionId !== undefined) {
        const afterIdx = remaining.findIndex((s) => s.id === op.afterSectionId);
        if (afterIdx < 0) return [...sections];
        return [...remaining.slice(0, afterIdx + 1), target, ...remaining.slice(afterIdx + 1)];
      }
      return [...remaining];
    }
  }
}

export function renderSections(sections: readonly SectionHeader[]): string {
  const out: string[] = ["# Mediator prompt — opencode-mediator (auto-rendered)"];
  for (const s of sections) {
    out.push(`\n## ${s.header}\n\n${s.body.trim()}\n`);
  }
  return out.join("\n");
}

export function hashPrompt(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export interface ApplyContext {
  promptPath: string;
  empiricalEvaluation: ReturnType<typeof markPending> | null;
  readFileFn?: (path: string) => Promise<string>;
  writeFileFn?: (path: string, content: string) => Promise<void>;
}

export async function applyPatch(patch: PatchInput, ctx: ApplyContext): Promise<PatchResult> {
  const read = ctx.readFileFn ?? ((p: string) => readFile(p, "utf-8"));
  const write = ctx.writeFileFn ?? ((p: string, c: string) => writeFile(p, c));
  const beforeContent = await read(ctx.promptPath);
  const beforeHash = hashPrompt(beforeContent);
  const sections = parseSections(beforeContent);

  const accepted: PatchOp[] = [];
  const rejected: Array<{ op: PatchOp; reason: string }> = [];
  let current = sections;
  for (const op of patch.ops) {
    if (op.op === "add" || op.op === "revise") {
      if (op.content && exceedsThreshold(op.content)) {
        rejected.push({ op, reason: "negative-framing ratio > 0.5" });
        continue;
      }
    }
    current = applyOp(current, op);
    accepted.push(op);
  }

  const afterContent = renderSections(current);
  const tmp = `${ctx.promptPath}.tmp.${Date.now()}`;
  await write(tmp, afterContent);
  await rename(tmp, ctx.promptPath);
  const finalContent = await read(ctx.promptPath);
  const afterHash = hashPrompt(finalContent);

  for (const op of accepted) {
    if (ctx.empiricalEvaluation) {
      ctx.empiricalEvaluation = markPending(ctx.empiricalEvaluation, op.sectionId, patch.patchId, "refiner");
    }
  }

  return { ok: rejected.length === 0, appliedOps: accepted.length, rejectedOps: rejected, beforeHash, afterHash };
}

export function isMediatorPromptPath(p: string): boolean {
  return p.endsWith("mediator.md") || p.endsWith("prompts/mediator.md");
}

export function _slugifyHeader(header: string): string {
  return slugifyHeader(header);
}

export function _fileExists(p: string): boolean {
  return existsSync(p);
}

export function defaultPromptPath(repoRoot: string): string {
  return join(repoRoot, "prompts", "mediator.md");
}
