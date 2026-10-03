/**
 * Adaptive training cohort (PRD §23, §85).
 *
 * The system never dumps 80 lines on a learner at once. It unlocks a growing
 * slice of the course and fills each session from prioritised buckets:
 *
 *   due reviews > weak lines > recently failed > still-learning > new > mastered
 *
 * Everything here is pure and deterministic — no `Math.random()` — so a session
 * can be reproduced from a stored progress snapshot.
 */

import { isDue, isRecentlyFailed, isWeak } from "@/lib/training/scheduler";
import type { LineProgressState } from "@/lib/types";

export interface LineCandidate {
  lineId: string;
  /** Authoring order: the course teaches main lines first. */
  sortOrder: number;
  difficulty: number;
  progress: LineProgressState;
}

/** Cohort growth ladder from PRD §23, capped at the course length. */
export const COHORT_STEPS = [10, 20, 30, 50, 80] as const;

/** Unlock the next slice once 60% of the current slice is mastered. */
export const UNLOCK_MASTERY_FRACTION = 0.6;

export const DEFAULT_SESSION_SIZE = 10;

export type CohortBucket = "due" | "weak" | "failed" | "learning" | "new" | "mastered";

/** Share of a session each bucket may claim. Later buckets take the leftovers. */
const BUCKET_ALLOCATION: { bucket: CohortBucket; share: number }[] = [
  { bucket: "due", share: 0.4 },
  { bucket: "weak", share: 0.25 },
  { bucket: "failed", share: 0.1 },
  { bucket: "learning", share: 0.25 },
  // "new" and "mastered" absorb whatever is left, in that order.
  { bucket: "new", share: 1 },
  { bucket: "mastered", share: 1 },
];

/**
 * How many lines the learner has unlocked.
 *
 * 10 -> 20 -> 30 -> 50 -> 80, each step earned by mastering 60% of the previous
 * slice. Courses shorter than a step are capped at their own length.
 */
export function unlockedLineCount(mastered: number, total: number): number {
  if (total <= 0) return 0;
  const steps = COHORT_STEPS.map((step) => Math.min(step, total));
  let unlocked = steps[0] ?? Math.min(COHORT_STEPS[0], total);
  for (let i = 1; i < steps.length; i += 1) {
    const previous = steps[i - 1] ?? unlocked;
    const next = steps[i] ?? previous;
    if (next === previous) continue;
    if (mastered >= Math.ceil(previous * UNLOCK_MASTERY_FRACTION)) unlocked = next;
    else break;
  }
  return Math.min(unlocked, total);
}

export interface CohortSelection {
  lineIds: string[];
  /** How many lines came from each bucket — surfaced in the session summary. */
  breakdown: Record<CohortBucket, number>;
  unlocked: number;
}

export interface SelectCohortInput {
  candidates: LineCandidate[];
  unlocked: number;
  sessionSize?: number;
  now?: Date;
}

export function selectCohort(input: SelectCohortInput): CohortSelection {
  const now = input.now ?? new Date();
  const size = Math.max(1, input.sessionSize ?? DEFAULT_SESSION_SIZE);

  // A line already in progress stays eligible even if the unlock ladder has not
  // reached it yet — otherwise unlocking would strand half-finished work.
  const eligible = input.candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(
      ({ candidate, index }) => index < input.unlocked || candidate.progress.status !== "NEW",
    )
    .map(({ candidate }) => candidate);

  const buckets = new Map<CohortBucket, LineCandidate[]>();
  for (const bucket of BUCKET_ALLOCATION) buckets.set(bucket.bucket, []);

  for (const candidate of eligible) {
    const { progress } = candidate;
    const untouched = progress.status === "NEW" && !progress.lastAttemptAt;
    if (untouched) {
      buckets.get("new")?.push(candidate);
      continue;
    }
    if (isWeak(progress)) {
      buckets.get("weak")?.push(candidate);
      continue;
    }
    if (isDue(progress, now)) {
      buckets.get("due")?.push(candidate);
      continue;
    }
    if (isRecentlyFailed(progress, 24 * 60 * 60 * 1000, now)) {
      buckets.get("failed")?.push(candidate);
      continue;
    }
    if (progress.status === "MASTERED") {
      buckets.get("mastered")?.push(candidate);
      continue;
    }
    buckets.get("learning")?.push(candidate);
  }

  for (const [bucket, list] of buckets) list.sort((a, b) => compare(bucket, a, b, now));

  const breakdown: Record<CohortBucket, number> = {
    due: 0,
    weak: 0,
    failed: 0,
    learning: 0,
    new: 0,
    mastered: 0,
  };
  const lineIds: string[] = [];
  const taken = new Map<CohortBucket, number>();
  let remaining = size;

  const takeFrom = (bucket: CohortBucket, count: number) => {
    const list = buckets.get(bucket) ?? [];
    const start = taken.get(bucket) ?? 0;
    const slice = list.slice(start, start + count);
    taken.set(bucket, start + slice.length);
    for (const candidate of slice) {
      lineIds.push(candidate.lineId);
      breakdown[bucket] += 1;
      remaining -= 1;
    }
  };

  // Pass 1: proportional shares, so a backlog in one bucket cannot crowd out
  // the others (PRD §85 mixes weak, due, learning and new in one session).
  // Priority buckets keep at least one slot: with a 1-line session a pure
  // proportional split would round every high-priority bucket down to zero and
  // hand the slot to a brand-new line.
  for (const { bucket, share } of BUCKET_ALLOCATION) {
    if (remaining <= 0) break;
    const cap = share >= 1 ? size : Math.max(1, Math.floor(size * share));
    takeFrom(bucket, Math.min(remaining, cap));
  }

  // Pass 2: overflow. Caps are a mixing rule, not a ceiling — if capacity is
  // left, the highest-priority leftovers still get in. Without this, a weak line
  // that is also overdue could be starved by the weak bucket's 25% cap.
  for (const { bucket } of BUCKET_ALLOCATION) {
    if (remaining <= 0) break;
    takeFrom(bucket, remaining);
  }

  return { lineIds, breakdown, unlocked: input.unlocked };
}

function compare(
  bucket: CohortBucket,
  a: LineCandidate,
  b: LineCandidate,
  now: Date,
): number {
  switch (bucket) {
    case "due": {
      // Most overdue first — the longest-forgotten line is the most valuable.
      const delta = overdueMs(b.progress, now) - overdueMs(a.progress, now);
      return delta !== 0 ? delta : bySortOrder(a, b);
    }
    case "weak": {
      const accuracy = a.progress.accuracy - b.progress.accuracy;
      if (accuracy !== 0) return accuracy;
      const lapses = b.progress.lapses - a.progress.lapses;
      return lapses !== 0 ? lapses : bySortOrder(a, b);
    }
    case "failed":
      // Most recent failure first.
      return timeOf(b.progress.lastAttemptAt) - timeOf(a.progress.lastAttemptAt) || bySortOrder(a, b);
    case "mastered":
      // Spread maintenance: least recently reviewed first.
      return timeOf(a.progress.lastAttemptAt) - timeOf(b.progress.lastAttemptAt) || bySortOrder(a, b);
    default:
      // learning / new follow the course order.
      return bySortOrder(a, b);
  }
}

function bySortOrder(a: LineCandidate, b: LineCandidate): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.lineId < b.lineId ? -1 : 1;
}

function overdueMs(progress: LineProgressState, now: Date): number {
  if (!progress.nextReviewAt) return 0;
  return now.getTime() - new Date(progress.nextReviewAt).getTime();
}

function timeOf(value: string | null): number {
  return value ? new Date(value).getTime() : 0;
}
