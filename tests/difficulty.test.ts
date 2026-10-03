import { describe, expect, it } from "vitest";

import {
  DIFFICULTY_WEIGHTS,
  difficultyLabel,
  lineDifficulty,
  personalDifficulty,
} from "@/lib/training/difficulty";

describe("lineDifficulty", () => {
  it("stays inside 1..5", () => {
    const cases = [
      { playerMoveCount: 1, branchFactor: 1, opponentFrequency: 1, errorRate: 0 },
      { playerMoveCount: 40, branchFactor: 20, opponentFrequency: 0, errorRate: 1 },
      { playerMoveCount: -5, branchFactor: 0, opponentFrequency: 5, errorRate: -1 },
      { playerMoveCount: NaN, branchFactor: NaN, opponentFrequency: NaN, errorRate: NaN },
    ];
    for (const input of cases) {
      const value = lineDifficulty(input);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(5);
    }
  });

  it("grows with the number of decisions to recall", () => {
    const shallow = lineDifficulty({ playerMoveCount: 2, branchFactor: 1, opponentFrequency: 0.8 });
    const deep = lineDifficulty({ playerMoveCount: 12, branchFactor: 1, opponentFrequency: 0.8 });
    expect(deep).toBeGreaterThan(shallow);
  });

  it("grows with branching", () => {
    const quiet = lineDifficulty({ playerMoveCount: 6, branchFactor: 1, opponentFrequency: 0.5 });
    const sharp = lineDifficulty({ playerMoveCount: 6, branchFactor: 4, opponentFrequency: 0.5 });
    expect(sharp).toBeGreaterThan(quiet);
  });

  it("treats rare opponent replies as harder", () => {
    const mainline = lineDifficulty({ playerMoveCount: 6, branchFactor: 2, opponentFrequency: 0.9 });
    const sideline = lineDifficulty({ playerMoveCount: 6, branchFactor: 2, opponentFrequency: 0.1 });
    expect(sideline).toBeGreaterThan(mainline);
  });

  it("weights the four documented inputs", () => {
    expect(
      DIFFICULTY_WEIGHTS.depth +
        DIFFICULTY_WEIGHTS.branch +
        DIFFICULTY_WEIGHTS.rarity +
        DIFFICULTY_WEIGHTS.errorRate,
    ).toBeCloseTo(1, 10);
  });
});

describe("personalDifficulty", () => {
  it("returns the authored difficulty before there is signal", () => {
    expect(personalDifficulty(2, 1, 0)).toBe(2);
    expect(personalDifficulty(2, 1, 1)).toBe(2);
  });

  it("raises the difficulty when the learner keeps missing the line", () => {
    expect(personalDifficulty(2, 0.9, 5)).toBeGreaterThan(2);
  });

  it("stays inside 1..5", () => {
    expect(personalDifficulty(5, 1, 10)).toBeLessThanOrEqual(5);
    expect(personalDifficulty(1, 0, 10)).toBeGreaterThanOrEqual(1);
  });
});

describe("difficultyLabel", () => {
  it("maps the 1..5 scale onto three learner-facing words", () => {
    expect(difficultyLabel(1)).toBe("Beginner");
    expect(difficultyLabel(2)).toBe("Beginner");
    expect(difficultyLabel(3)).toBe("Intermediate");
    expect(difficultyLabel(4)).toBe("Advanced");
    expect(difficultyLabel(5)).toBe("Advanced");
  });
});
