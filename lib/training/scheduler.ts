/**
 * Spaced repetition (PRD §21, §22).
 *
 * Deliberately deterministic: no randomness, no floating-point drift, and the
 * same input always produces the same schedule. That makes it unit-testable and
 * lets the server recompute a schedule from a replayed attempt log — which is
 * what the anti-cheat path in PRD §57 depends on.
 *
 * The interval ladder is indexed by *consecutive* correct answers (`streak`),
 * not by lifetime correct answers. A lapse therefore costs real ground: you
 * drop back to 10 minutes and climb the ladder again.
 */

import type { LineProgressState, LineStatus } from "@/lib/types";

/** 10 min, 1 day, 3 days, 7 days, 14 days, 30 days (PRD §22). */
export const SCHEDULING_INTERVALS_SECONDS = [
  10 * 60,
  24 * 60 * 60,
  3 * 24 * 60 * 60,
  7 * 24 * 60 * 60,
  14 * 24 * 60 * 60,
  30 * 24 * 60 * 60,
] as const;

export const LAPSE_INTERVAL_SECONDS = 10 * 60;

export const EASE_FACTOR = {
  initial: 2.5,
  min: 1.3,
  max: 3.0,
  correctDelta: 0.05,
  incorrectDelta: -0.2,
} as const;

/** Consecutive-correct thresholds for REVIEW and MASTERED. */
export const STATUS_THRESHOLDS = { review: 3, mastered: 6 } as const;

export function initialProgress(): LineProgressState {
  return {
    status: "NEW",
    repetitions: 0,
    correctCount: 0,
    incorrectCount: 0,
    lapses: 0,
    streak: 0,
    easeFactor: EASE_FACTOR.initial,
    intervalSeconds: 0,
    accuracy: 0,
    lastAttemptAt: null,
    nextReviewAt: null,
  };
}

export function deriveStatus(state: {
  streak: number;
  correctCount: number;
  incorrectCount: number;
}): LineStatus {
  if (state.correctCount === 0 && state.incorrectCount === 0) return "NEW";
  if (state.streak >= STATUS_THRESHOLDS.mastered) return "MASTERED";
  if (state.streak >= STATUS_THRESHOLDS.review) return "REVIEW";
  return "LEARNING";
}

export interface AttemptInput {
  correct: boolean;
  /** A hinted answer counts as correct for accuracy but does not advance the ladder. */
  hintUsed?: boolean;
  at: Date;
}

export function intervalForStreak(streak: number): number {
  if (streak <= 0) return LAPSE_INTERVAL_SECONDS;
  const index = Math.min(streak - 1, SCHEDULING_INTERVALS_SECONDS.length - 1);
  return SCHEDULING_INTERVALS_SECONDS[index] ?? LAPSE_INTERVAL_SECONDS;
}

/**
 * Pure transition function: previous state + one attempt -> next state.
 *
 * The same function runs in the browser (for instant UI feedback) and on the
 * server (as the source of truth), so the two can never disagree.
 */
export function applyAttempt(
  previous: LineProgressState,
  attempt: AttemptInput,
): LineProgressState {
  const now = attempt.at;
  const hinted = attempt.correct && attempt.hintUsed === true;

  let { streak, easeFactor, intervalSeconds } = previous;
  const correctCount = previous.correctCount + (attempt.correct ? 1 : 0);
  const incorrectCount = previous.incorrectCount + (attempt.correct ? 0 : 1);
  const repetitions = previous.repetitions + (attempt.correct ? 1 : 0);
  const lapses = previous.lapses + (attempt.correct ? 0 : 1);

  if (attempt.correct) {
    if (!hinted) streak = previous.streak + 1;
    easeFactor = clamp(previous.easeFactor + EASE_FACTOR.correctDelta);
    // A hinted recall proves recognition, not recall: hold the ladder where it is.
    intervalSeconds = hinted
      ? Math.max(LAPSE_INTERVAL_SECONDS, intervalForStreak(previous.streak))
      : intervalForStreak(streak);
  } else {
    streak = 0;
    easeFactor = clamp(previous.easeFactor + EASE_FACTOR.incorrectDelta);
    intervalSeconds = LAPSE_INTERVAL_SECONDS;
  }

  const total = correctCount + incorrectCount;

  return {
    status: deriveStatus({ streak, correctCount, incorrectCount }),
    repetitions,
    correctCount,
    incorrectCount,
    lapses,
    streak,
    easeFactor,
    intervalSeconds,
    accuracy: total === 0 ? 0 : round(correctCount / total, 4),
    lastAttemptAt: now.toISOString(),
    nextReviewAt: new Date(now.getTime() + intervalSeconds * 1000).toISOString(),
  };
}

export function isDue(state: LineProgressState, now: Date = new Date()): boolean {
  if (!state.nextReviewAt) return false;
  return new Date(state.nextReviewAt).getTime() <= now.getTime();
}

export function overdueSeconds(state: LineProgressState, now: Date = new Date()): number {
  if (!state.nextReviewAt) return 0;
  return Math.floor((now.getTime() - new Date(state.nextReviewAt).getTime()) / 1000);
}

/**
 * "Weak" = the learner has tried this line and keeps getting it wrong.
 * Needs at least two attempts so a single early mistake is not a life sentence.
 */
export function isWeak(
  state: LineProgressState,
  options: { minAttempts?: number; accuracyBelow?: number; lapsesAtLeast?: number } = {},
): boolean {
  const minAttempts = options.minAttempts ?? 2;
  const accuracyBelow = options.accuracyBelow ?? 0.6;
  const lapsesAtLeast = options.lapsesAtLeast ?? 2;
  const attempts = state.correctCount + state.incorrectCount;
  if (attempts < minAttempts) return false;
  return state.accuracy < accuracyBelow || state.lapses >= lapsesAtLeast;
}

/** A line that failed on its most recent attempt. */
export function isRecentlyFailed(
  state: LineProgressState,
  recentWindowMs: number = 24 * 60 * 60 * 1000,
  now: Date = new Date(),
): boolean {
  if (state.streak !== 0) return false;
  if (state.incorrectCount === 0) return false;
  if (!state.lastAttemptAt) return false;
  return now.getTime() - new Date(state.lastAttemptAt).getTime() <= recentWindowMs;
}

function clamp(value: number): number {
  return Math.max(EASE_FACTOR.min, Math.min(EASE_FACTOR.max, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
