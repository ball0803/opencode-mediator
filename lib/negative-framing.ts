/**
 * negative-framing.ts — ratio check (D15, V11, V12)
 *
 * Plugin enforces a 0.5 cap on negative markers per section. Hard-never
 * rules (URL hallucination, sycophancy) are preserved in negative framing
 * but count toward the same cap.
 */

const NEGATIVE_MARKERS = [
  "don't", "do not", "never", "no\\.", "forbidden", "must not", "should not", "avoid",
] as const;

const CLAUSE_DELIMITERS = /[.;\n]+/;

export function splitClauses(text: string): string[] {
  return text.split(CLAUSE_DELIMITERS).map((c) => c.trim()).filter((c) => c.length > 0);
}

export function countNegativeMarkers(clause: string): number {
  const lower = clause.toLowerCase();
  let n = 0;
  for (const marker of NEGATIVE_MARKERS) {
    if (lower.includes(marker)) n += 1;
  }
  return n;
}

export function negativeFramingRatio(text: string): number {
  const clauses = splitClauses(text);
  if (clauses.length === 0) return 0;
  const negativeClauses = clauses.filter((c) => countNegativeMarkers(c) > 0).length;
  return negativeClauses / clauses.length;
}

export const NEGATIVE_FRAMING_THRESHOLD = 0.5;

export function exceedsThreshold(text: string): boolean {
  return negativeFramingRatio(text) > NEGATIVE_FRAMING_THRESHOLD;
}
