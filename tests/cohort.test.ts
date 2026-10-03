import { describe, expect, it } from "vitest";

import {
  COHORT_STEPS,
  DEFAULT_SESSION_SIZE,
  selectCohort,
  unlockedLineCount,
  type LineCandidate,
} from "@/lib/training/cohort";
import { applyAttempt, initialProgress } from "@/lib/training/scheduler";
import type { LineProgressState } from "@/lib/types";

const now = new Date("2026-03-01T12:00:00.000Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function candidate(lineId: string, sortOrder: number, progress: LineProgressState): LineCandidate {
  return { lineId, sortOrder, difficulty: 2, progress };
}

/** `correct` answers in a row, each a day apart, so nothing is currently due. */
function mastered(count = 6): LineProgressState {
  let state = initialProgress();
  for (let i = 0; i < count; i += 1) {
    state = applyAttempt(state, { correct: true, at: new Date(now.getTime() - (count - i) * DAY) });
  }
  // Push the next review far into the future so it is not "due".
  return { ...state, nextReviewAt: new Date(now.getTime() + 30 * DAY).toISOString() };
}

function learning(count: number): LineProgressState {
  let state = initialProgress();
  for (let i = 0; i < count; i += 1) {
    state = applyAttempt(state, { correct: true, at: new Date(now.getTime() - (count - i) * DAY) });
  }
  return { ...state, nextReviewAt: new Date(now.getTime() + 5 * DAY).toISOString() };
}

function dueLine(correctFirst = true): LineProgressState {
  let state = initialProgress();
  state = applyAttempt(state, { correct: correctFirst, at: new Date(now.getTime() - 2 * DAY) });
  state = applyAttempt(state, { correct: true, at: new Date(now.getTime() - DAY) });
  return { ...state, nextReviewAt: new Date(now.getTime() - 6 * 60 * MINUTE).toISOString() };
}

function weakLine(): LineProgressState {
  let state = initialProgress();
  state = applyAttempt(state, { correct: false, at: new Date(now.getTime() - 3 * DAY) });
  state = applyAttempt(state, { correct: true, at: new Date(now.getTime() - 2 * DAY) });
  state = applyAttempt(state, { correct: false, at: new Date(now.getTime() - DAY) });
  // Weak lines are almost always overdue too (a lapse schedules 10 minutes).
  return { ...state, nextReviewAt: new Date(now.getTime() - 12 * 60 * MINUTE).toISOString() };
}

describe("unlockedLineCount (PRD §23)", () => {
  it("starts at 10", () => {
    expect(unlockedLineCount(0, 80)).toBe(10);
  });

  it("climbs 10 -> 20 -> 30 -> 50 -> 80 as lines are mastered", () => {
    expect(unlockedLineCount(5, 80)).toBe(10);
    expect(unlockedLineCount(6, 80)).toBe(20);
    expect(unlockedLineCount(12, 80)).toBe(30);
    expect(unlockedLineCount(18, 80)).toBe(50);
    expect(unlockedLineCount(30, 80)).toBe(80);
  });

  it("never unlocks more lines than the course has", () => {
    expect(unlockedLineCount(0, 4)).toBe(4);
    expect(unlockedLineCount(4, 4)).toBe(4);
    expect(unlockedLineCount(99, 0)).toBe(0);
  });

  it("uses the documented ladder", () => {
    expect([...COHORT_STEPS]).toEqual([10, 20, 30, 50, 80]);
  });
});

describe("selectCohort", () => {
  it("defaults to a 10-line session", () => {
    expect(DEFAULT_SESSION_SIZE).toBe(10);
    const candidates = Array.from({ length: 20 }, (_, i) =>
      candidate(`line-${i}`, i, initialProgress()),
    );
    const result = selectCohort({ candidates, unlocked: 20, now });
    expect(result.lineIds).toHaveLength(10);
    expect(result.breakdown.new).toBe(10);
  });

  it("only offers unlocked lines, but never strands work in progress", () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      candidate(`line-${i}`, i, initialProgress()),
    );
    // Put line 15 into progress even though only 10 lines are unlocked.
    candidates[15] = candidate("line-15", 15, learning(1));

    const result = selectCohort({ candidates, unlocked: 10, sessionSize: 20, now });
    expect(result.lineIds).toContain("line-15");
    expect(result.lineIds).not.toContain("line-16");
  });

  it("picks new lines in course order", () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      candidate(`line-${i}`, i, initialProgress()),
    );
    const result = selectCohort({ candidates, unlocked: 5, sessionSize: 3, now });
    expect(result.lineIds).toEqual(["line-0", "line-1", "line-2"]);
  });

  it("puts due reviews ahead of new lines", () => {
    const candidates = [
      candidate("new-0", 0, initialProgress()),
      candidate("new-1", 1, initialProgress()),
      candidate("due-0", 2, dueLine()),
    ];
    const result = selectCohort({ candidates, unlocked: 3, sessionSize: 1, now });
    expect(result.lineIds).toEqual(["due-0"]);
    expect(result.breakdown.due).toBe(1);
  });

  it("does not starve weak lines that are also overdue", () => {
    // Six weak lines, all overdue, and nothing else available.
    const candidates = Array.from({ length: 6 }, (_, i) => candidate(`weak-${i}`, i, weakLine()));
    const result = selectCohort({ candidates, unlocked: 6, sessionSize: 5, now });
    expect(result.lineIds).toHaveLength(5);
    expect(result.breakdown.weak).toBe(5);
  });

  it("reproduces the PRD §85 mixed session", () => {
    // 40 lines: 12 mastered, 8 learning, 5 weak, 15 new; 3 of them are due.
    const candidates: LineCandidate[] = [];
    let i = 0;
    for (let n = 0; n < 12; n += 1, i += 1) candidates.push(candidate(`m${n}`, i, mastered()));
    for (let n = 0; n < 5; n += 1, i += 1) candidates.push(candidate(`w${n}`, i, weakLine()));
    for (let n = 0; n < 3; n += 1, i += 1) candidates.push(candidate(`d${n}`, i, dueLine()));
    for (let n = 0; n < 5; n += 1, i += 1) candidates.push(candidate(`l${n}`, i, learning(2)));
    for (let n = 0; n < 15; n += 1, i += 1) candidates.push(candidate(`n${n}`, i, initialProgress()));

    const result = selectCohort({ candidates, unlocked: 30, sessionSize: 10, now });

    expect(result.lineIds).toHaveLength(10);
    expect(result.breakdown.weak).toBe(2);
    expect(result.breakdown.due).toBe(3);
    expect(result.breakdown.learning).toBe(2);
    expect(result.breakdown.new).toBe(3);
    // No line appears twice.
    expect(new Set(result.lineIds).size).toBe(10);
  });

  it("tops up with mastered lines for maintenance when nothing else is available", () => {
    const candidates = Array.from({ length: 8 }, (_, i) => candidate(`m${i}`, i, mastered()));
    const result = selectCohort({ candidates, unlocked: 8, sessionSize: 5, now });
    expect(result.lineIds).toHaveLength(5);
    expect(result.breakdown.mastered).toBe(5);
  });

  it("orders due lines by how overdue they are", () => {
    const veryOverdue = { ...dueLine(), nextReviewAt: new Date(now.getTime() - 10 * DAY).toISOString() };
    const slightlyOverdue = {
      ...dueLine(),
      nextReviewAt: new Date(now.getTime() - MINUTE).toISOString(),
    };
    const candidates = [
      candidate("slight", 0, slightlyOverdue),
      candidate("very", 1, veryOverdue),
    ];
    const result = selectCohort({ candidates, unlocked: 2, sessionSize: 1, now });
    expect(result.lineIds).toEqual(["very"]);
  });

  it("is deterministic for the same input", () => {
    const candidates = Array.from({ length: 30 }, (_, i) =>
      candidate(`line-${i}`, i, i % 3 === 0 ? dueLine() : initialProgress()),
    );
    const a = selectCohort({ candidates, unlocked: 30, sessionSize: 10, now });
    const b = selectCohort({ candidates, unlocked: 30, sessionSize: 10, now });
    expect(a).toEqual(b);
  });

  it("handles an empty course without dividing by zero", () => {
    const result = selectCohort({ candidates: [], unlocked: 0, sessionSize: 10, now });
    expect(result.lineIds).toEqual([]);
  });
});
