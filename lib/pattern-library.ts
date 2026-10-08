/**
 * pattern-library.ts — pattern_tag → known good section template (D17, V11)
 *
 * 9 seed tags. New tags emerge as the system encounters new patterns.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const SEED_TAGS = [
  "out_of_scope_assumption",
  "ambiguous_pronoun",
  "vague_constraint",
  "missed_approval_keyword",
  "premature_action",
  "silence_treated_as_approval",
  "paraphrasing_user",
  "twisting_user_words",
  "success_pattern",
] as const;

export type SeedTag = (typeof SEED_TAGS)[number];

export interface PatternEntry {
  refined_count: number;
  last_refined_record: string | null;
  known_good_section: string | null;
}

export type PatternLibrary = Record<string, PatternEntry>;

export function defaultLibrary(): PatternLibrary {
  const lib: PatternLibrary = {};
  for (const tag of SEED_TAGS) {
    lib[tag] = { refined_count: 0, last_refined_record: null, known_good_section: null };
  }
  return lib;
}

export function patternLibraryPath(): string {
  return join(homedir(), ".local", "share", "opencode", "mediator", "patterns.json");
}

export async function loadPatternLibrary(path: string = patternLibraryPath()): Promise<PatternLibrary> {
  try {
    const text = await readFile(path, "utf-8");
    return JSON.parse(text) as PatternLibrary;
  } catch {
    return defaultLibrary();
  }
}

export async function savePatternLibrary(lib: PatternLibrary, path: string = patternLibraryPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(lib, null, 2) + "\n");
}

export function bumpRefinedCount(lib: PatternLibrary, tag: string, recordId: string): PatternLibrary {
  const existing = lib[tag] ?? { refined_count: 0, last_refined_record: null, known_good_section: null };
  return {
    ...lib,
    [tag]: {
      refined_count: existing.refined_count + 1,
      last_refined_record: recordId,
      known_good_section: existing.known_good_section,
    },
  };
}
