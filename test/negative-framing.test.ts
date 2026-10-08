import { test, expect, describe } from "bun:test";
import {
  splitClauses,
  countNegativeMarkers,
  negativeFramingRatio,
  exceedsThreshold,
  NEGATIVE_FRAMING_THRESHOLD,
} from "../lib/negative-framing.ts";

describe("negative-framing (D15, V12)", () => {
  test("splitClauses splits on . ; and newlines", () => {
    const clauses = splitClauses("First. Second; Third\nFourth");
    expect(clauses.length).toBe(4);
  });

  test("countNegativeMarkers detects don't, never, must not, should not, avoid, etc.", () => {
    expect(countNegativeMarkers("Don't do X")).toBeGreaterThan(0);
    expect(countNegativeMarkers("Never do X")).toBeGreaterThan(0);
    expect(countNegativeMarkers("This is forbidden")).toBeGreaterThan(0);
    expect(countNegativeMarkers("You must not do X")).toBeGreaterThan(0);
    expect(countNegativeMarkers("You should not do X")).toBeGreaterThan(0);
    expect(countNegativeMarkers("Avoid doing X")).toBeGreaterThan(0);
  });

  test("countNegativeMarkers returns 0 for positive-framed text", () => {
    expect(countNegativeMarkers("Always design what to do, with worked examples")).toBe(0);
  });

  test("negativeFramingRatio is 0 for empty text", () => {
    expect(negativeFramingRatio("")).toBe(0);
  });

  test("negativeFramingRatio at 0.5 (5/10 clauses negative, exceeds cap)", () => {
    const text = "Don't do this. Do X. Never do Y. Use Z. Must not do W. Always do V. Should not do U. Avoid A. Do B. Do C.";
    const ratio = negativeFramingRatio(text);
    expect(ratio).toBe(0.5);
  });

  test("exceedsThreshold is true when ratio > 0.5", () => {
    const text = "Don't do this. Never do Y. Must not do W. Avoid A. Do X.";
    expect(exceedsThreshold(text)).toBe(true);
  });

  test("exceedsThreshold is false when ratio <= 0.5", () => {
    const text = "Don't do this. Do X. Never do Y. Use Z. Do V. Do U. Do A. Do B.";
    expect(exceedsThreshold(text)).toBe(false);
  });

  test("NEGATIVE_FRAMING_THRESHOLD is 0.5", () => {
    expect(NEGATIVE_FRAMING_THRESHOLD).toBe(0.5);
  });
});
