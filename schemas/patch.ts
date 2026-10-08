/**
 * patch-schema.ts — Zod schema for Refiner patches
 */

import { z } from "zod";

export const PatchOpSchema = z.object({
  op: z.enum(["add", "revise", "remove", "reorder"]),
  section_id: z.string(),
  content: z.string().optional(),
  before_section_id: z.string().optional(),
  after_section_id: z.string().optional(),
  provenance: z.array(z.string()),
  rationale: z.string().min(1),
});

export const PatchSchema = z.object({
  patch_id: z.string().min(1),
  produced_from_records: z.array(z.string()),
  ops: z.array(PatchOpSchema),
  reason: z.string().optional(),
});

export type Patch = z.infer<typeof PatchSchema>;
export type PatchOp = z.infer<typeof PatchOpSchema>;
