import { describe, expect, it } from "vitest";

import {
  EASE_FACTOR,
  LAPSE_INTERVAL_SECONDS,
  SCHEDULING_INTERVALS_SECONDS,
  applyAttempt,
  deriveStatus,
  initialProgress,
  intervalForStreak,
  isDue,
  isRecentlyFailed,
  isWeak,
  overdueSeconds,
} from "@/lib/training/scheduler";

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;
const t0 = new Date("2026-01-01T00:00:00.000Z");
const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

function run(
  outcomes: (boolean | { correct: boolean; hintUsed?: boolean })[],
  start = initialProgress(),
) {
  let state = start;
  outcomes.forEach((outcome, i) => {
    const value = typeof outcome === "boolean" ? { correct: outcome } : outcome;
    state = applyAttempt(state, { ...value, at: at(i * MINUTE) });
  });
  return state;
}

describe("the interval ladder (PRD §22)", () => {
  it("matches the documented schedule exactly", () => {
    expect(SCHEDULING_INTERVALS_SECONDS).toEqual([
      10 * MINUTE,
      1 * DAY,
      3 * DAY,
      7 * DAY,
      14 * DAY,
      30 * DAY,
    ]);
  });

  it("schedules 10 minutes after the first correct answer", () => {
    const state = applyAttempt(initialProgress(), { correct: true, at: t0 });
    expect(state.intervalSeconds).toBe(10 * MINUTE);
    expect(state.nextReviewAt).toBe(at(10 * MINUTE).toISOString());
  });

  it("climbs the ladder on consecutive correct answers", () => {
    expect(run([true]).intervalSeconds).toBe(10 * MINUTE);
    expect(run([true, true]).intervalSeconds).toBe(1 * DAY);
    expect(run([true, true, true]).intervalSeconds).toBe(3 * DAY);
    expect(run([true, true, true, true]).intervalSeconds).toBe(7 * DAY);
    expect(run([true, true, true, true, true]).intervalSeconds).toBe(14 * DAY);
    expect(run([true, true, true, true, true, true]).intervalSeconds).toBe(30 * DAY);
  });

  it("caps at 30 days", () => {
    const state = run(Array(12).fill(true));
    expect(state.intervalSeconds).toBe(30 * DAY);
    expect(intervalForStreak(99)).toBe(30 * DAY);
  });

  it("resets to 10 minutes after a lapse and re-climbs", () => {
    const lapsed = run([true, true, true, false]);
    expect(lapsed.intervalSeconds).toBe(LAPSE_INTERVAL_SECONDS);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.streak).toBe(0);

    const recovered = applyAttempt(lapsed, { correct: true, at: at(60 * MINUTE) });
    // Back to the bottom of the ladder, not where it was before the lapse.
    expect(recovered.intervalSeconds).toBe(10 * MINUTE);
    expect(recovered.streak).toBe(1);
  });
});

describe("status transitions", () => {
  it("starts NEW", () => {
    expect(initialProgress().status).toBe("NEW");
    expect(deriveStatus({ streak: 0, correctCount: 0, incorrectCount: 0 })).toBe("NEW");
  });

  it("moves NEW -> LEARNING -> REVIEW -> MASTERED", () => {
    expect(run([true]).status).toBe("LEARNING");
    expect(run([true, true]).status).toBe("LEARNING");
    expect(run([true, true, true]).status).toBe("REVIEW");
    expect(run(Array(5).fill(true)).status).toBe("REVIEW");
    expect(run(Array(6).fill(true)).status).toBe("MASTERED");
  });

  it("drops back out of MASTERED after a lapse", () => {
    const mastered = run(Array(6).fill(true));
    expect(mastered.status).toBe("MASTERED");
    const lapsed = applyAttempt(mastered, { correct: false, at: at(DAY) });
    expect(lapsed.status).toBe("LEARNING");
  });

  it("counts a first-time miss as LEARNING, not NEW", () => {
    expect(run([false]).status).toBe("LEARNING");
  });
});

describe("hinted answers", () => {
  it("counts as correct for accuracy but does not advance the ladder", () => {
    const hinted = applyAttempt(initialProgress(), {
      correct: true,
      hintUsed: true,
      at: t0,
    });
    expect(hinted.correctCount).toBe(1);
    expect(hinted.accuracy).toBe(1);
    expect(hinted.streak).toBe(0);
    expect(hinted.intervalSeconds).toBe(LAPSE_INTERVAL_SECONDS);
    expect(hinted.status).toBe("LEARNING");
  });

  it("cannot be farmed into mastery", () => {
    const state = run(Array(20).fill({ correct: true, hintUsed: true }));
    expect(state.status).not.toBe("MASTERED");
    expect(state.intervalSeconds).toBe(LAPSE_INTERVAL_SECONDS);
  });
});

describe("derived statistics", () => {
  it("computes accuracy over all attempts", () => {
    const state = run([true, false, true, true]);
    expect(state.correctCount).toBe(3);
    expect(state.incorrectCount).toBe(1);
    expect(state.accuracy).toBe(0.75);
  });

  it("keeps lifetime repetitions across lapses", () => {
    const state = run([true, true, false, true]);
    expect(state.repetitions).toBe(3);
    expect(state.lapses).toBe(1);
    expect(state.streak).toBe(1);
  });

  it("adjusts the ease factor within bounds", () => {
    const up = run([true, true, true]);
    expect(up.easeFactor).toBeGreaterThan(EASE_FACTOR.initial);
    expect(up.easeFactor).toBeLessThanOrEqual(EASE_FACTOR.max);

    const down = run(Array(30).fill(false));
    expect(down.easeFactor).toBe(EASE_FACTOR.min);
  });

  it("is a pure function of its inputs", () => {
    const a = run([true, false, true]);
    const b = run([true, false, true]);
    expect(a).toEqual(b);
  });
});

describe("review predicates", () => {
  it("reports a line due once its interval has elapsed", () => {
    const state = applyAttempt(initialProgress(), { correct: true, at: t0 });
    expect(isDue(state, at(9 * MINUTE))).toBe(false);
    expect(isDue(state, at(10 * MINUTE))).toBe(true);
    expect(overdueSeconds(state, at(11 * MINUTE))).toBe(MINUTE);
  });

  it("never reports an untouched line due", () => {
    expect(isDue(initialProgress(), t0)).toBe(false);
  });

  it("flags weak lines only after real signal", () => {
    expect(isWeak(run([false]))).toBe(false); // one miss is not a verdict
    expect(isWeak(run([false, false]))).toBe(true);
    expect(isWeak(run([true, true, true, true]))).toBe(false);
  });

  it("flags a recent failure inside the window only", () => {
    // The window is in milliseconds; the test clock counts seconds.
    const DAY_MS = DAY * 1000;
    const state = applyAttempt(initialProgress(), { correct: false, at: t0 });
    expect(isRecentlyFailed(state, DAY_MS, at(60 * MINUTE))).toBe(true);
    expect(isRecentlyFailed(state, DAY_MS, at(2 * DAY))).toBe(false);
  });
});
