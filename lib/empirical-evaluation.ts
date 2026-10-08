/**
 * Empirical evaluation — pure functions for tracking whether a Refiner patch
 * actually worked in subsequent sessions.
 *
 * This module is PURE: no I/O, no global state, no side effects. The recorder
 * plugin owns persistence (load/save the EvaluationState to disk) and calls
 * these functions to mutate state.
 *
 * State machine (per V9 + Q6 + D20):
 *   markPending()       -> record becomes "pending"
 *   tick() per record   -> if pattern persists 3 times -> "invalidated"
 *                         if pattern gone 3 times     -> "resolved"
 *   resolved() / escalate() -> manual terminal
 *
 * Pure functions, so tests don't need I/O.
 */

export type SectionId = string;
export type RecordId = string;
export type PatternTag = string;

export type EvaluationStatus = "pending" | "resolved" | "invalidated";

export interface PendingRecord {
  readonly recordId: RecordId;
  readonly patternTag: PatternTag;
  readonly writtenAt: number; // unix ms
}

/**
 * MAX_PENDING_PER_SECTION: the number of consecutive same-pattern records
 * that triggers either resolved (pattern gone) or invalidated (pattern
 * persists). Matches V9: 1 record flags, 3 records confirm.
 */
export const MAX_PENDING_PER_SECTION = 3;

export interface EvaluationState {
  /** Live: section_id -> pending records (capped at MAX_PENDING_PER_SECTION). */
  readonly pending: ReadonlyMap<SectionId, readonly PendingRecord[]>;
  /** Per-record terminal status. */
  readonly recordStatus: ReadonlyMap<RecordId, EvaluationStatus>;
  /** Per-record consecutive-match count used by tick(). */
  readonly consecutiveCount: ReadonlyMap<RecordId, number>;
}

/** Create a fresh empty state. */
export function createState(): EvaluationState {
  return {
    pending: new Map(),
    recordStatus: new Map(),
    consecutiveCount: new Map(),
  };
}

/**
 * Register a record as pending for a section. The list is capped at
 * MAX_PENDING_PER_SECTION; older entries are dropped (their status
 * remains whatever it was).
 */
export function markPending(
  state: EvaluationState,
  sectionId: SectionId,
  recordId: RecordId,
  patternTag: PatternTag,
  writtenAt: number = Date.now(),
): EvaluationState {
  const current = state.pending.get(sectionId) ?? [];
  const appended = [...current, { recordId, patternTag, writtenAt }];
  const capped = appended.slice(-MAX_PENDING_PER_SECTION);
  return {
    ...state,
    pending: new Map(state.pending).set(sectionId, capped),
  };
}

/**
 * Process a new record's pattern_tag. Walks pending records:
 *   - matching patternTag: increment consecutiveCount; if reaches MAX, mark invalidated
 *   - different patternTag: reset consecutiveCount; if reaches MAX, mark resolved
 *
 * Returns the new state and the record_ids that transitioned to a terminal state.
 */
export function tick(
  state: EvaluationState,
  observedPatternTag: PatternTag,
): { state: EvaluationState; resolved: readonly RecordId[]; invalidated: readonly RecordId[] } {
  const pending = new Map(state.pending);
  const recordStatus = new Map(state.recordStatus);
  const consecutiveCount = new Map(state.consecutiveCount);
  const resolved: RecordId[] = [];
  const invalidated: RecordId[] = [];

  for (const [sectionId, list] of state.pending) {
    const remaining: PendingRecord[] = [];
    for (const rec of list) {
      const currentCount = consecutiveCount.get(rec.recordId) ?? 0;
      const isMatch = rec.patternTag === observedPatternTag;
      // For "match" branch we count consecutive matches (invalidates if pattern persists).
      // For "no match" branch we count consecutive non-matches (resolves if pattern is gone).
      const nextCount = currentCount + 1;

      if (isMatch) {
        if (nextCount >= MAX_PENDING_PER_SECTION) {
          recordStatus.set(rec.recordId, "invalidated");
          invalidated.push(rec.recordId);
        } else {
          consecutiveCount.set(rec.recordId, nextCount);
          remaining.push(rec);
        }
      } else {
        if (nextCount >= MAX_PENDING_PER_SECTION) {
          recordStatus.set(rec.recordId, "resolved");
          resolved.push(rec.recordId);
        } else {
          consecutiveCount.set(rec.recordId, nextCount);
          remaining.push(rec);
        }
      }
    }
    if (remaining.length === 0) {
      pending.delete(sectionId);
    } else {
      pending.set(sectionId, remaining);
    }
  }

  return {
    state: { pending, recordStatus, consecutiveCount },
    resolved,
    invalidated,
  };
}

/** Manually mark all pending records for a section as resolved. */
export function resolved(state: EvaluationState, sectionId: SectionId): EvaluationState {
  const list = state.pending.get(sectionId);
  if (!list || list.length === 0) return state;
  const recordStatus = new Map(state.recordStatus);
  for (const rec of list) {
    recordStatus.set(rec.recordId, "resolved");
  }
  const pending = new Map(state.pending);
  pending.delete(sectionId);
  return { ...state, pending, recordStatus };
}

/** Manually mark all pending records for a section as invalidated. */
export function escalate(state: EvaluationState, sectionId: SectionId): EvaluationState {
  const list = state.pending.get(sectionId);
  if (!list || list.length === 0) return state;
  const recordStatus = new Map(state.recordStatus);
  for (const rec of list) {
    recordStatus.set(rec.recordId, "invalidated");
  }
  const pending = new Map(state.pending);
  pending.delete(sectionId);
  return { ...state, pending, recordStatus };
}

/** Read-only accessor. */
export function getStatus(
  state: EvaluationState,
  recordId: RecordId,
): EvaluationStatus | undefined {
  return state.recordStatus.get(recordId);
}

/** Read-only accessor. */
export function getPending(
  state: EvaluationState,
  sectionId: SectionId,
): readonly PendingRecord[] {
  return state.pending.get(sectionId) ?? [];
}
