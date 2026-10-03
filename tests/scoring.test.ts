import { describe, expect, it } from "vitest";

import {
  SCORING,
  scoreAttempt,
  scoreSession,
  speedBonus,
  streakMultiplier,
} from "@/lib/training/scoring";

describe("scoreAttempt", () => {
  it("awards the base score for a correct answer", () => {
    expect(scoreAttempt({ correct: true, elapsedMs: SCORING.speedWindowMs, streakBefore: 0 })).toBe(
      SCORING.base,
    );
  });

  it("awards nothing for a wrong answer, however fast", () => {
    expect(scoreAttempt({ correct: false, elapsedMs: 1, streakBefore: 10 })).toBe(0);
  });

  it("never lets speed dominate accuracy (PRD §86)", () => {
    const fastestWrong = scoreAttempt({ correct: false, elapsedMs: 0, streakBefore: 0 });
    const slowestRight = scoreAttempt({
      correct: true,
      elapsedMs: SCORING.speedWindowMs + 1,
      streakBefore: 0,
    });
    expect(slowestRight).toBeGreaterThan(fastestWrong);
    expect(SCORING.speedMax).toBeLessThan(SCORING.base);
  });

  it("caps the streak multiplier", () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(10)).toBe(1.5);
    expect(streakMultiplier(1000)).toBe(1.5);
    expect(streakMultiplier(-5)).toBe(1);
  });

  it("caps the speed bonus and ignores nonsense clocks", () => {
    expect(speedBonus(0)).toBe(0);
    expect(speedBonus(-100)).toBe(0);
    expect(speedBonus(SCORING.speedWindowMs)).toBe(0);
    expect(speedBonus(SCORING.speedWindowMs - SCORING.speedStepMs)).toBeGreaterThan(0);
    expect(speedBonus(1)).toBeLessThanOrEqual(SCORING.speedMax);
  });
});

describe("scoreSession", () => {
  it("derives the streak from the attempt log itself", () => {
    const log = [
      { correct: true, elapsedMs: 9000 },
      { correct: true, elapsedMs: 9000 },
      { correct: true, elapsedMs: 9000 },
    ];
    const scored = scoreSession(log);
    // 100 + 105 + 110 with a growing streak.
    expect(scored.score).toBe(100 + 105 + 110);
    expect(scored.bestStreak).toBe(3);
  });

  it("resets the streak after a miss", () => {
    const scored = scoreSession([
      { correct: true, elapsedMs: 9000 },
      { correct: true, elapsedMs: 9000 },
      { correct: false, elapsedMs: 9000 },
      { correct: true, elapsedMs: 9000 },
    ]);
    expect(scored.bestStreak).toBe(2);
    expect(scored.score).toBe(100 + 105 + 0 + 100);
    expect(scored.accuracy).toBe(0.75);
  });

  it("reports learning metrics (PRD §60)", () => {
    const scored = scoreSession([
      { correct: true, elapsedMs: 1000 },
      { correct: false, elapsedMs: 2000 },
      { correct: true, elapsedMs: 3000 },
    ]);
    expect(scored.correct).toBe(2);
    expect(scored.incorrect).toBe(1);
    expect(scored.totalElapsedMs).toBe(6000);
    expect(scored.meanTimeToCorrectMs).toBe(2000);
  });

  it("counts hints", () => {
    const scored = scoreSession([
      { correct: true, elapsedMs: 100, hintUsed: true },
      { correct: true, elapsedMs: 100 },
    ]);
    expect(scored.hintsUsed).toBe(1);
  });

  it("returns zeros for an empty log rather than NaN", () => {
    const scored = scoreSession([]);
    expect(scored.score).toBe(0);
    expect(scored.accuracy).toBe(0);
    expect(scored.meanTimeToCorrectMs).toBe(0);
  });

  it("is a pure function of the log, so the server can recompute it", () => {
    const log = [
      { correct: true, elapsedMs: 500 },
      { correct: false, elapsedMs: 900 },
      { correct: true, elapsedMs: 1200 },
    ];
    expect(scoreSession(log)).toEqual(scoreSession([...log]));
  });
});
