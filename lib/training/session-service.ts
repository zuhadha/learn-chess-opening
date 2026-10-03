/**
 * Training session service (PRD §25, §57, §75).
 *
 * The client judges moves locally for speed and batches the results. This module
 * is the authority: it re-derives correctness from the course tree, ignores any
 * score the client claims, and recomputes the schedule. A client that posts
 * `{"score": 999999}` gets a session scored from its own attempt log.
 */

import { judgeMove } from "@/lib/chess/training-engine";
import { getTreeIndex } from "@/lib/training/tree-cache";
import { unlockedLineCount } from "@/lib/training/cohort";
import { scoreAttempt, scoreSession } from "@/lib/training/scoring";
import { applyAttempt, initialProgress } from "@/lib/training/scheduler";
import {
  countAttempts,
  getCourseById,
  getCourseProgress,
  getLineProgress,
  getSession,
  insertAttempt,
  listAttempts,
  listLineAttempts,
  listLines,
  updateSession,
  upsertCourseProgress,
  upsertLineProgress,
} from "@/lib/db/repositories";
import type { LocalStore } from "@/lib/db/local-store";
import type {
  AttemptInput,
  AttemptResult,
  LineStatus,
  SessionCompleteResult,
  TrainingMode,
  TrainingSession,
} from "@/lib/types";

export function ensureProfile(store: LocalStore, userId: string, now: string): void {
  store.run(
    `insert into profiles (id, username, created_at, updated_at) values (?, ?, ?, ?)
     on conflict (id) do nothing`,
    [userId, userId, now, now],
  );
}

export class TrainingError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "TrainingError";
  }
}

export function startSession(
  store: LocalStore,
  input: { userId: string; courseId: string; mode: TrainingMode; sessionId: string; now: Date },
): { session: TrainingSession; unlocked: number; lineIds: string[] } {
  const course = getCourseById(store, input.courseId);
  if (!course) throw new TrainingError(`unknown course ${input.courseId}`, 404);
  if (!getTreeIndex(store, input.courseId)) {
    throw new TrainingError(`course ${input.courseId} has no tree`, 409);
  }

  const now = input.now.toISOString();
  ensureProfile(store, input.userId, now);

  const session = createSessionRow(store, {
    id: input.sessionId,
    userId: input.userId,
    courseId: input.courseId,
    mode: input.mode,
    now,
  });

  const totalLines = listLines(store, input.courseId).length;
  const mastered = countByStatus(store, input.userId, input.courseId).MASTERED;
  const unlocked = unlockedLineCount(mastered, totalLines);

  return { session, unlocked, lineIds: [] };
}

function createSessionRow(
  store: LocalStore,
  input: { id: string; userId: string; courseId: string; mode: TrainingMode; now: string },
): TrainingSession {
  // Retry-safe: the client generates the session id, so a start request whose
  // response was lost can be replayed without producing a duplicate or a 500.
  const existing = getSession(store, input.id);
  if (existing) {
    if (existing.userId !== input.userId) {
      throw new TrainingError("that session id belongs to another learner", 409);
    }
    if (existing.courseId !== input.courseId || existing.mode !== input.mode) {
      throw new TrainingError("that session id is already used by a different session", 409);
    }
    return existing;
  }

  store.run(
    `insert into training_sessions (
       id, user_id, course_id, mode, started_at, score, accuracy,
       lines_attempted, lines_completed, mistakes, hints_used
     ) values (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0)`,
    [input.id, input.userId, input.courseId, input.mode, input.now],
  );
  const session = getSession(store, input.id);
  if (!session) throw new TrainingError("failed to create session", 500);
  return session;
}

/**
 * Validate and persist a batch of attempts.
 *
 * Batched because progress is checkpointed, not streamed: 5–20 attempts per
 * request keeps a training session to a handful of round trips (PRD §75).
 *
 * Scheduling granularity matters here. Attempts are stored per decision (that
 * is what makes the score and the anti-cheat replay work), but the *schedule*
 * advances once per completed line — `user_line_progress` is keyed by line
 * (PRD §21), and stepping it per ply would mark a freshly-seen eleven-move line
 * as mastered after a single pass.
 */
export function recordAttempts(
  store: LocalStore,
  input: { userId: string; sessionId: string; attempts: AttemptInput[]; now: Date },
): { results: AttemptResult[] } {
  const session = getSession(store, input.sessionId);
  if (!session) throw new TrainingError("session not found", 404);
  if (session.userId !== input.userId) throw new TrainingError("session is not yours", 403);
  if (session.endedAt) throw new TrainingError("session already completed", 409);

  const tree = getTreeIndex(store, session.courseId);
  if (!tree) throw new TrainingError("course tree unavailable", 503);

  const nowIso = input.now.toISOString();
  const results: AttemptResult[] = [];

  for (const attempt of input.attempts) {
    const line = tree.line(attempt.lineId);
    if (!line) throw new TrainingError(`line ${attempt.lineId} is not in this course`, 400);

    const position = tree.position(attempt.positionId);
    if (!position) throw new TrainingError(`position ${attempt.positionId} is unknown`, 400);

    // The position must be one of this line's decision points, otherwise a
    // client could farm easy positions for progress on a hard line.
    const decisions = tree.decisions(attempt.lineId);
    const decisionIndex = decisions.findIndex((step) => step.positionId === attempt.positionId);
    if (decisionIndex < 0) {
      throw new TrainingError(
        `position ${attempt.positionId} is not a decision point of line ${attempt.lineId}`,
        400,
      );
    }

    const judgement = judgeMove({
      tree,
      positionId: attempt.positionId,
      move: attempt.move,
      learnerSide: tree.playerSide,
      mode: session.mode,
    });
    const correct = judgement.status === "correct";

    insertAttempt(store, {
      id: `att:${input.sessionId}:${attempt.lineId}:${attempt.attemptIndex}`.toLowerCase(),
      sessionId: input.sessionId,
      userId: input.userId,
      courseId: session.courseId,
      lineId: attempt.lineId,
      positionId: attempt.positionId,
      moveUci: judgement.playedUci ?? "",
      expectedUci: judgement.expected?.uci ?? "",
      correct,
      legal: judgement.legal,
      hintUsed: attempt.hintUsed,
      // Clamped so a client cannot inflate the speed bonus with a huge clock.
      elapsedMs: Math.max(0, Math.min(600_000, attempt.elapsedMs)),
      attemptIndex: attempt.attemptIndex,
      createdAt: nowIso,
    });

    let progress = getLineProgress(store, input.userId, attempt.lineId) ?? initialProgress();

    // The line was just completed: fold the whole repetition into one step.
    const completedLine =
      correct && decisions[decisions.length - 1]?.positionId === attempt.positionId;

    if (completedLine) {
      const lineAttempts = listLineAttempts(store, input.sessionId, attempt.lineId);
      progress = applyAttempt(progress, {
        correct: lineAttempts.every((a) => a.correct),
        hintUsed: lineAttempts.some((a) => a.hintUsed),
        at: input.now,
      });
      upsertLineProgress(store, input.userId, attempt.lineId, progress, nowIso);
    }

    results.push({
      correct,
      legal: judgement.legal,
      expectedUci: judgement.expected?.uci ?? null,
      expectedSan: judgement.expected?.san ?? null,
      alternatives: judgement.alternatives,
      explanation: judgement.explanation,
      feedback: judgement.feedback,
      progress,
      completedLine,
      // Per-attempt value without the streak multiplier: the authoritative
      // score is `scoreSession` over the stored log at completion.
      points: scoreAttempt({ correct, elapsedMs: attempt.elapsedMs, streakBefore: 0 }),
      streak: progress.streak,
    });
  }

  return { results };
}

export function countByStatus(
  store: LocalStore,
  userId: string,
  courseId: string,
): Record<LineStatus, number> {
  const rows = store.all<{ status: LineStatus; n: number }>(
    `select ulp.status as status, count(*) as n
       from user_line_progress ulp
       join course_lines cl on cl.id = ulp.line_id
      where ulp.user_id = ? and cl.course_id = ?
      group by ulp.status`,
    [userId, courseId],
  );
  const result: Record<LineStatus, number> = { NEW: 0, LEARNING: 0, REVIEW: 0, MASTERED: 0 };
  for (const row of rows) result[row.status] = row.n;
  return result;
}

/**
 * Finish a session.
 *
 * Everything returned here is derived from stored attempts. `score` is
 * recomputed with the same pure function the HUD uses, so the number on screen
 * and the number in the database cannot diverge.
 */
export function completeSession(
  store: LocalStore,
  input: { userId: string; sessionId: string; now: Date },
): SessionCompleteResult {
  const session = getSession(store, input.sessionId);
  if (!session) throw new TrainingError("session not found", 404);
  if (session.userId !== input.userId) throw new TrainingError("session is not yours", 403);

  const tree = getTreeIndex(store, session.courseId);
  const attempts = listAttempts(store, input.sessionId);
  // The score is derived from the stored attempt log, never from the client.
  const nowIso = input.now.toISOString();
  const scored = scoreSession(
    attempts.map((a) => ({ correct: a.correct, elapsedMs: a.elapsedMs, hintUsed: a.hintUsed })),
  );

  const lineIds = [...new Set(attempts.map((a) => a.lineId))];
  const completedLineIds = new Set<string>();
  if (tree) {
    for (const lineId of lineIds) {
      const decisions = tree.decisions(lineId);
      const solved = new Set(
        attempts.filter((a) => a.lineId === lineId && a.correct).map((a) => a.positionId),
      );
      if (decisions.length > 0 && decisions.every((d) => solved.has(d.positionId))) {
        completedLineIds.add(lineId);
      }
    }
  }
  const linesCompleted = completedLineIds.size;

  // A line the learner started, failed at least once, and then abandoned never
  // reached the completion step in `recordAttempts`. Record the lapse here so an
  // unfinished struggle still counts against the line.
  for (const lineId of lineIds) {
    if (completedLineIds.has(lineId)) continue;
    const lineAttempts = attempts.filter((a) => a.lineId === lineId);
    if (!lineAttempts.some((a) => !a.correct)) continue;
    const state = getLineProgress(store, input.userId, lineId) ?? initialProgress();
    upsertLineProgress(
      store,
      input.userId,
      lineId,
      applyAttempt(state, { correct: false, at: input.now }),
      nowIso,
    );
  }

  const updated = updateSession(store, input.sessionId, {
    endedAt: nowIso,
    score: scored.score,
    accuracy: scored.accuracy,
    linesAttempted: lineIds.length,
    linesCompleted,
    mistakes: scored.incorrect,
    hintsUsed: scored.hintsUsed,
  });
  if (!updated) throw new TrainingError("session update failed", 500);

  // Refresh course-level progress and the adaptive unlock ladder (PRD §23).
  const totalLines = tree ? tree.lines().length : listLines(store, session.courseId).length;
  const byStatus = countByStatus(store, input.userId, session.courseId);
  const previous = getCourseProgress(store, input.userId, session.courseId);
  upsertCourseProgress(store, {
    id: previous?.id,
    userId: input.userId,
    courseId: session.courseId,
    unlockedLines: unlockedLineCount(byStatus.MASTERED, totalLines),
    linesAttempted: countDistinctLines(store, input.userId, session.courseId),
    linesMastered: byStatus.MASTERED,
    totalSessions: (previous?.totalSessions ?? 0) + 1,
    lastTrainedAt: nowIso,
    updatedAt: nowIso,
  });

  const attempted = countDistinctLines(store, input.userId, session.courseId);
  const masteryRate = attempted === 0 ? 0 : Math.round((byStatus.MASTERED / attempted) * 10_000) / 10_000;

  const dueIn = store
    .all<{ line_id: string; name: string; next_review_at: string | null }>(
      `select ulp.line_id, cl.name, ulp.next_review_at
         from user_line_progress ulp
         join course_lines cl on cl.id = ulp.line_id
        where ulp.user_id = ? and cl.course_id = ? and ulp.next_review_at is not null
        order by ulp.next_review_at asc
        limit 5`,
      [input.userId, session.courseId],
    )
    .map((row) => ({
      lineId: row.line_id,
      name: row.name,
      nextReviewAt: row.next_review_at ?? nowIso,
    }));

  return {
    session: updated,
    serverScore: scored.score,
    mastery: {
      total: totalLines,
      new: byStatus.NEW,
      learning: byStatus.LEARNING,
      review: byStatus.REVIEW,
      mastered: byStatus.MASTERED,
      masteryRate,
    },
    dueIn,
  };
}

function countDistinctLines(store: LocalStore, userId: string, courseId: string): number {
  return (
    store.get<{ n: number }>(
      `select count(distinct ulp.line_id) as n
         from user_line_progress ulp
         join course_lines cl on cl.id = ulp.line_id
        where ulp.user_id = ? and cl.course_id = ?
          and (ulp.correct_count > 0 or ulp.incorrect_count > 0)`,
      [userId, courseId],
    )?.n ?? 0
  );
}

/** Convenience used by tests and scripts to assert the log grew. */
export function attemptCount(store: LocalStore, sessionId: string): number {
  return countAttempts(store, sessionId);
}
