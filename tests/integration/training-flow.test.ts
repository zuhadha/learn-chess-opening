import { beforeEach, describe, expect, it } from "vitest";

import { TreeIndex } from "@/lib/chess/tree";
import { courseSpecs } from "@/lib/content/registry";
import { createMemoryStore } from "@/lib/db/local-store";
import {
  getCourseTree,
  getLineProgress,
  listCourses,
  listLines,
} from "@/lib/db/repositories";
import { seedCourses } from "@/lib/db/seed";
import {
  getDueLines,
  getWeakLines,
  planSession,
} from "@/lib/training/progress-service";
import {
  completeSession,
  recordAttempts,
  startSession,
} from "@/lib/training/session-service";
import { TrainingError } from "@/lib/training/session-service";
import { unlockedLineCount } from "@/lib/training/cohort";
import type { AttemptInput } from "@/lib/types";

const USER = "11111111-1111-4111-8111-111111111111";

/**
 * The MVP acceptance path from PRD §102, run against the real database layer:
 * open a course, train, make deliberate mistakes, finish, and check that the
 * weak lines come back.
 */

let store: ReturnType<typeof createMemoryStore>;
let tree: TreeIndex;
let courseId: string;

beforeEach(() => {
  store = createMemoryStore();
  seedCourses(store, courseSpecs, { ensureUserId: USER });
  const courses = listCourses(store);
  courseId = courses[0]!.id;
  tree = new TreeIndex(getCourseTree(store, courseId)!);
});

function decisionAttempts(lineId: string, sessionId: string, opts: { wrongAt?: number[] } = {}) {
  const decisions = tree.decisions(lineId);
  const wrongAt = new Set(opts.wrongAt ?? []);
  const attempts: AttemptInput[] = [];
  let index = 0;
  decisions.forEach((decision, i) => {
    if (wrongAt.has(i)) {
      // A legal move that is not in the repertoire — the interesting failure.
      attempts.push({
        sessionId,
        lineId,
        positionId: decision.positionId,
        move: pickLegalWrongMove(decision.positionId, decision.move.uci),
        hintUsed: false,
        elapsedMs: 1500,
        attemptIndex: index++,
      });
    }
    attempts.push({
      sessionId,
      lineId,
      positionId: decision.positionId,
      move: decision.move.uci,
      hintUsed: false,
      elapsedMs: 1200,
      attemptIndex: index++,
    });
  });
  return attempts;
}

function pickLegalWrongMove(positionId: string, expectedUci: string): string {
  // Any tree move at this position that is not the repertoire move works: it is
  // legal chess and still a failed repetition, which is the case that matters.
  const alternatives = tree.movesFor(positionId, tree.playerSide);
  const alt = alternatives.find((m) => m.uci !== expectedUci);
  if (alt) return alt.uci;
  return expectedUci === "e7e5" ? "g7g6" : "e7e5";
}

describe("seeding", () => {
  it("publishes the course with its whole tree", () => {
    const courses = listCourses(store);
    expect(courses).toHaveLength(1);
    expect(courses[0]!.slug).toBe("caro-kann-defense");
    expect(courses[0]!.lineCount).toBe(17);
    expect(courses[0]!.decisionCount).toBeGreaterThan(100);

    const lines = listLines(store, courseId);
    expect(lines).toHaveLength(17);
    expect(tree.size.positions).toBeGreaterThan(100);
  });

  it("is idempotent — reseeding does not duplicate content", () => {
    seedCourses(store, courseSpecs, { ensureUserId: USER });
    const courses = listCourses(store);
    expect(courses).toHaveLength(1);
    expect(courses[0]!.lineCount).toBe(17);
  });

  it("keeps user progress across a reseed", () => {
    const { session } = startSession(store, {
      userId: USER,
      courseId,
      mode: "learn",
      sessionId: "s-seed",
      now: new Date(),
    });
    const line = tree.lines()[0]!;
    const attempts = decisionAttempts(line.id, session.id, { wrongAt: [0, 1] });
    recordAttempts(store, { userId: USER, sessionId: session.id, attempts, now: new Date() });
    const before = getLineProgress(store, USER, line.id)!;
    expect(before.lapses).toBe(1);

    seedCourses(store, courseSpecs, { ensureUserId: USER });

    const after = getLineProgress(store, USER, line.id)!;
    expect(after.incorrectCount).toBe(1);
    expect(after.correctCount).toBe(before.correctCount);
    expect(after.nextReviewAt).toBe(before.nextReviewAt);
  });
});

describe("a full session (PRD §102)", () => {
  it("starts with a server-chosen cohort", () => {
    const { session, unlocked } = startSession(store, {
      userId: USER,
      courseId,
      mode: "learn",
      sessionId: "s-1",
      now: new Date(),
    });
    const plan = planSession(store, USER, courseId, { sessionSize: 6 });
    expect(session.mode).toBe("learn");
    expect(plan.lineIds).toHaveLength(6);
    expect(unlocked).toBe(unlockedLineCount(0, 17));
    // A brand-new learner only gets the first slice of the course.
    expect(unlocked).toBe(10);
  });

  it("records attempts, and folds a finished line into one schedule step", () => {
    const { session } = startSession(store, {
      userId: USER,
      courseId,
      mode: "learn",
      sessionId: "s-2",
      now: new Date(),
    });
    const line = tree.lines()[0]!;
    const decisions = tree.decisions(line.id).length;
    const attempts = decisionAttempts(line.id, session.id, { wrongAt: [0, 1] });
    const { results } = recordAttempts(store, {
      userId: USER,
      sessionId: session.id,
      attempts,
      now: new Date(),
    });

    // Every decision is stored, retries included.
    expect(results).toHaveLength(decisions + 2);
    expect(results.filter((r) => !r.correct)).toHaveLength(2);
    expect(results[0]!.expectedSan).toBeTruthy();

    // Only the attempt that finished the line advanced the schedule.
    expect(results.filter((r) => r.completedLine)).toHaveLength(1);
    expect(results.at(-1)!.completedLine).toBe(true);

    const progress = getLineProgress(store, USER, line.id)!;
    // One repetition of the line, with mistakes: a single lapse, not one per ply.
    expect(progress.correctCount).toBe(0);
    expect(progress.incorrectCount).toBe(1);
    expect(progress.lapses).toBe(1);
    expect(progress.streak).toBe(0);
    expect(progress.status).toBe("LEARNING");
    expect(progress.intervalSeconds).toBe(600);
  });

  it("does not master a line just because it is long", () => {
    const { session } = startSession(store, {
      userId: USER,
      courseId,
      mode: "learn",
      sessionId: "s-2b",
      now: new Date(),
    });
    // The longest line in the course: eleven decisions, all first-time correct.
    const line = tree.lines().reduce((a, b) => (b.moveCount > a.moveCount ? b : a));
    expect(line.moveCount).toBeGreaterThan(6);

    recordAttempts(store, {
      userId: USER,
      sessionId: session.id,
      attempts: decisionAttempts(line.id, session.id),
      now: new Date(),
    });

    const progress = getLineProgress(store, USER, line.id)!;
    expect(progress.streak).toBe(1);
    expect(progress.status).toBe("LEARNING");
    expect(progress.intervalSeconds).toBe(600);
  });

  it("completes with a server-recomputed score and mastery counts", () => {
    const now = new Date();
    const { session } = startSession(store, {
      userId: USER,
      courseId,
      mode: "practice",
      sessionId: "s-3",
      now,
    });
    const lines = tree.lines().slice(0, 3);
    const attempts = lines.flatMap((line, i) =>
      decisionAttempts(line.id, session.id, i === 0 ? { wrongAt: [0] } : {}),
    );
    recordAttempts(store, { userId: USER, sessionId: session.id, attempts, now });

    const result = completeSession(store, { userId: USER, sessionId: session.id, now });

    expect(result.session.endedAt).toBeTruthy();
    expect(result.session.linesAttempted).toBe(3);
    expect(result.session.linesCompleted).toBe(3);
    expect(result.session.mistakes).toBe(1);
    // Score is derived from the attempt log, not from any client value.
    expect(result.serverScore).toBeGreaterThan(0);
    expect(result.serverScore).toBe(result.session.score);
    expect(result.mastery.total).toBe(17);
    expect(result.dueIn.length).toBeGreaterThan(0);
  });

  it("puts the failed line at the front of the next session's cohort", () => {
    const now = new Date();
    const first = startSession(store, {
      userId: USER,
      courseId,
      mode: "learn",
      sessionId: "s-4",
      now,
    });
    const line = tree.lines()[3]!;
    recordAttempts(store, {
      userId: USER,
      sessionId: first.session.id,
      attempts: decisionAttempts(line.id, first.session.id, { wrongAt: [0, 1] }),
      now,
    });
    completeSession(store, { userId: USER, sessionId: first.session.id, now });

    const plan = planSession(store, USER, courseId, { sessionSize: 6 });
    // One lapse is not yet "weak" (that needs a second attempt), but it is a
    // recent failure and gets priority over untouched lines.
    expect(plan.breakdown.failed).toBe(1);
    expect(plan.lineIds[0]).toBe(line.id);
  });

  it("promotes a line to weak after it fails twice", () => {
    const now = new Date();
    const line = tree.lines()[2]!;
    for (let round = 0; round < 2; round += 1) {
      const { session } = startSession(store, {
        userId: USER,
        courseId,
        mode: "practice",
        sessionId: `s-weak-${round}`,
        now,
      });
      recordAttempts(store, {
        userId: USER,
        sessionId: session.id,
        attempts: decisionAttempts(line.id, session.id, { wrongAt: [0] }),
        now,
      });
      completeSession(store, { userId: USER, sessionId: session.id, now });
    }

    expect(getWeakLines(store, USER).some((w) => w.lineId === line.id)).toBe(true);
    const plan = planSession(store, USER, courseId, { sessionSize: 6 });
    expect(plan.breakdown.weak).toBe(1);
    expect(plan.lineIds[0]).toBe(line.id);
  });

  it("schedules reviews so tomorrow has something due", () => {
    const now = new Date();
    const { session } = startSession(store, {
      userId: USER,
      courseId,
      mode: "learn",
      sessionId: "s-5",
      now,
    });
    const line = tree.lines()[1]!;
    recordAttempts(store, {
      userId: USER,
      sessionId: session.id,
      attempts: decisionAttempts(line.id, session.id),
      now,
    });
    completeSession(store, { userId: USER, sessionId: session.id, now });

    // Nothing due immediately: the first correct answer schedules 10 minutes out.
    expect(getDueLines(store, USER, now)).toHaveLength(0);

    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const due = getDueLines(store, USER, tomorrow);
    expect(due.some((d) => d.lineId === line.id)).toBe(true);
    expect(due[0]!.overdueSeconds).toBeGreaterThan(0);
  });

  it("unlocks more of the course once enough lines are mastered", () => {
    const now = new Date();
    const lines = tree.lines().slice(0, 7);

    // Six clean repetitions of a line is what MASTERED requires (PRD §22).
    lines.forEach((line, lineIndex) => {
      for (let round = 0; round < 6; round += 1) {
        const { session } = startSession(store, {
          userId: USER,
          courseId,
          mode: "practice",
          sessionId: `s-master-${lineIndex}-${round}`,
          now,
        });
        recordAttempts(store, {
          userId: USER,
          sessionId: session.id,
          attempts: decisionAttempts(line.id, session.id),
          now: new Date(now.getTime() + round * 1000),
        });
        completeSession(store, {
          userId: USER,
          sessionId: session.id,
          now: new Date(now.getTime() + round * 1000),
        });
      }
      expect(getLineProgress(store, USER, line.id)!.status).toBe("MASTERED");
    });

    const plan = planSession(store, USER, courseId, { sessionSize: 10 });
    expect(plan.unlocked).toBeGreaterThan(10);
    // Mastered lines come back only for maintenance, after everything else.
    expect(plan.breakdown.mastered + plan.breakdown.new).toBe(10);
  });
});

describe("server-side validation (PRD §57)", () => {
  it("rejects an attempt at a position that is not part of the line", () => {
    const { session } = startSession(store, {
      userId: USER,
      courseId,
      mode: "learn",
      sessionId: "s-cheat-1",
      now: new Date(),
    });
    const lines = tree.lines();
    const target = lines[0]!;
    const allowed = new Set(tree.decisions(target.id).map((d) => d.positionId));

    // Find a decision that belongs to a different line and not to this one.
    const foreign = lines
      .slice(1)
      .flatMap((line) => tree.decisions(line.id))
      .find((decision) => !allowed.has(decision.positionId));
    expect(foreign, "the course must contain a position outside the first line").toBeTruthy();

    expect(() =>
      recordAttempts(store, {
        userId: USER,
        sessionId: session.id,
        attempts: [
          {
            sessionId: session.id,
            lineId: target.id,
            positionId: foreign!.positionId,
            move: foreign!.move.uci,
            hintUsed: false,
            elapsedMs: 100,
            attemptIndex: 0,
          },
        ],
        now: new Date(),
      }),
    ).toThrow(TrainingError);
  });

  it("rejects attempts on a session that has already finished", () => {
    const now = new Date();
    const { session } = startSession(store, {
      userId: USER,
      courseId,
      mode: "learn",
      sessionId: "s-cheat-2",
      now,
    });
    completeSession(store, { userId: USER, sessionId: session.id, now });

    expect(() =>
      recordAttempts(store, {
        userId: USER,
        sessionId: session.id,
        attempts: decisionAttempts(tree.lines()[0]!.id, session.id),
        now,
      }),
    ).toThrow(/already completed/);
  });

  it("rejects attempts on somebody else's session", () => {
    const { session } = startSession(store, {
      userId: USER,
      courseId,
      mode: "learn",
      sessionId: "s-cheat-3",
      now: new Date(),
    });
    expect(() =>
      recordAttempts(store, {
        userId: "someone-else",
        sessionId: session.id,
        attempts: decisionAttempts(tree.lines()[0]!.id, session.id),
        now: new Date(),
      }),
    ).toThrow(/not yours/);
  });

  it("grades an illegal move as not-legal rather than crashing", () => {
    const { session } = startSession(store, {
      userId: USER,
      courseId,
      mode: "learn",
      sessionId: "s-cheat-4",
      now: new Date(),
    });
    const line = tree.lines()[0]!;
    const decision = tree.decisions(line.id)[0]!;
    const { results } = recordAttempts(store, {
      userId: USER,
      sessionId: session.id,
      attempts: [
        {
          sessionId: session.id,
          lineId: line.id,
          positionId: decision.positionId,
          move: "a1",
          hintUsed: false,
          elapsedMs: 100,
          attemptIndex: 0,
        },
      ],
      now: new Date(),
    });
    expect(results[0]!.legal).toBe(false);
    expect(results[0]!.correct).toBe(false);
    expect(results[0]!.points).toBe(0);
  });

  it("cannot buy speed bonus with an inflated clock", () => {
    const { session } = startSession(store, {
      userId: USER,
      courseId,
      mode: "learn",
      sessionId: "s-cheat-5",
      now: new Date(),
    });
    const line = tree.lines()[0]!;
    const decision = tree.decisions(line.id)[0]!;
    const { results } = recordAttempts(store, {
      userId: USER,
      sessionId: session.id,
      attempts: [
        {
          sessionId: session.id,
          lineId: line.id,
          positionId: decision.positionId,
          move: decision.move.uci,
          hintUsed: false,
          elapsedMs: Number.MAX_SAFE_INTEGER,
          attemptIndex: 0,
        },
      ],
      now: new Date(),
    });
    // Base score only — the clamped clock earns no speed bonus.
    expect(results[0]!.points).toBe(100);
  });
});
