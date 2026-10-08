/**
 * record-schema.ts — Zod schema for JSONL records
 */

import { z } from "zod";

export const RecordIterationSchema = z.object({
  iterationIndex: z.number().int().nonnegative(),
  userMessage: z.string(),
  mediatorResponse: z.string(),
  patternTag: z.string(),
  sectionsActive: z.array(z.string()),
});

export const WorkingIntentRecordSchema = z.object({
  goal: z.string(),
  constraints: z.array(z.string()),
  context: z.string(),
  success_criteria: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  open_questions: z.array(z.string()),
});

export const RecordSchema = z.object({
  sessionId: z.string(),
  recordId: z.string(),
  patternTag: z.string(),
  iterationChain: z.array(RecordIterationSchema),
  workingIntent: WorkingIntentRecordSchema,
  emittedAt: z.number().int(),
  emit_intent_id: z.string().optional(),
});

export type StoredRecord = z.infer<typeof RecordSchema>;
