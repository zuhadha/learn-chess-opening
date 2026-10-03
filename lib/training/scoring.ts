/**
 * Scoring (PRD §86).
 *
 * Two rules drive the whole design:
 *
 *  1. Accuracy dominates. A correct answer is worth >= 100; the speed bonus is
 *     capped at 15, so a fast wrong answer can never outscore a slow right one.
 *  2. The score is a pure function of the attempt log. The server recomputes it
 *     from stored `training_attempts` rows and ignores whatever the client
 *     claims (PRD §57), so `{"score": 999999}` buys nothing.
 */

export const SCORING = {
  /** Points for a correct answer before multipliers. */
  base: 100,
  /** Streak bonus per consecutive correct answer… */
  streakStep: 0.05,
  /** …capped so a long streak cannot swamp accuracy. */
  streakCap: 10,
  /** Answers faster than this earn the full speed bonus. */
  speedWindowMs: 8000,
  speedStepMs: 500,
  speedMax: 15,
  /** Wrong answers score zero — never negative, per the anti-frustration rules. */
  incorrect: 0,
} as const;

export interface ScoreableAttempt {
  correct: boolean;
  elapsedMs: number;
  /** Streak *before* this attempt, so the multiplier rewards building a run. */
  streakBefore: number;
}

export function streakMultiplier(streakBefore: number): number {
  const effective = Math.max(0, Math.min(streakBefore, SCORING.streakCap));
  return 1 + effective * SCORING.streakStep;
}

/** Faster answers earn a small, bounded bonus. Slow answers earn nothing. */
export function speedBonus(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  if (elapsedMs >= SCORING.speedWindowMs) return 0;
  const steps = Math.floor((SCORING.speedWindowMs - elapsedMs) / SCORING.speedStepMs);
  return Math.min(SCORING.speedMax, Math.max(0, steps));
}

export function scoreAttempt(attempt: ScoreableAttempt): number {
  if (!attempt.correct) return SCORING.incorrect;
  const base = SCORING.base * streakMultiplier(attempt.streakBefore);
  return Math.round(base + speedBonus(attempt.elapsedMs));
}

export interface ScoredSession {
  score: number;
  accuracy: number;
  total: number;
  correct: number;
  incorrect: number;
  bestStreak: number;
  hintsUsed: number;
  totalElapsedMs: number;
  /** Mean time-to-correct for correct answers (PRD §60). */
  meanTimeToCorrectMs: number;
}

/**
 * Fold an ordered attempt log into a session score.
 *
 * The streak is derived from the log itself rather than supplied per attempt —
 * the streak is a property of the sequence, and deriving it here is what makes
 * the score a pure function of stored rows (PRD §57).
 *
 * Runs on the server over the persisted attempts, and on the client for the
 * live HUD. Same function, same number.
 */
export function scoreSession(
  attempts: { correct: boolean; elapsedMs: number; hintUsed?: boolean }[],
): ScoredSession {
  let score = 0;
  let streak = 0;
  let bestStreak = 0;
  let correct = 0;
  let incorrect = 0;
  let hintsUsed = 0;
  let totalElapsedMs = 0;
  let timeToCorrectSum = 0;

  for (const attempt of attempts) {
    score += scoreAttempt({
      correct: attempt.correct,
      elapsedMs: attempt.elapsedMs,
      streakBefore: streak,
    });
    totalElapsedMs += Math.max(0, attempt.elapsedMs);
    if (attempt.hintUsed) hintsUsed += 1;

    if (attempt.correct) {
      correct += 1;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
      timeToCorrectSum += Math.max(0, attempt.elapsedMs);
    } else {
      incorrect += 1;
      streak = 0;
    }
  }

  const total = correct + incorrect;
  return {
    score,
    accuracy: total === 0 ? 0 : Math.round((correct / total) * 10_000) / 10_000,
    total,
    correct,
    incorrect,
    bestStreak,
    hintsUsed,
    totalElapsedMs,
    meanTimeToCorrectMs: correct === 0 ? 0 : Math.round(timeToCorrectSum / correct),
  };
}
