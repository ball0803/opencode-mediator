/**
 * section-merge.ts — Refiner-driven merge at 8000 tokens (D16)
 *
 * When the Mediator's prompt exceeds 8000 tokens, the plugin runs a merge pass:
 * the Refiner finds the two most-related sections and merges them into one
 * combined section, citing both sections' provenance as the new section's.
 */

import type { SectionHeader } from "./section-id.ts";

export const MERGE_THRESHOLD_TOKENS = 8000;

export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export function totalTokens(sections: readonly SectionHeader[]): number {
  return sections.reduce((acc, s) => acc + estimateTokens(s.body) + estimateTokens(s.header), 0);
}

export function findMergeCandidates(sections: readonly SectionHeader[]): [SectionHeader, SectionHeader] | null {
  if (sections.length < 2) return null;
  let best: [SectionHeader, SectionHeader] | null = null;
  let bestScore = -1;
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const a = sections[i]!;
      const b = sections[j]!;
      const score = tokenOverlap(a.body, b.body) + (a.level === b.level ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = [a, b];
      }
    }
  }
  return best;
}

function tokenOverlap(a: string, b: string): number {
  const tokA = new Set(a.toLowerCase().split(/\W+/).filter((t) => t.length > 3));
  const tokB = new Set(b.toLowerCase().split(/\W+/).filter((t) => t.length > 3));
  let overlap = 0;
  for (const t of tokA) if (tokB.has(t)) overlap += 1;
  return overlap;
}

export function shouldMerge(sections: readonly SectionHeader[]): boolean {
  return totalTokens(sections) > MERGE_THRESHOLD_TOKENS;
}
