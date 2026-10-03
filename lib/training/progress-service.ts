/**
 * Progress reads and session planning (PRD §23, §60).
 *
 * These are the queries behind "what should I practise next?" — the single most
 * important screen in the product (PRD §103).
 */

import { DEFAULT_SESSION_SIZE, selectCohort, unlockedLineCount } from "@/lib/training/cohort";
import type { LineCandidate } from "@/lib/training/cohort";
import { initialProgress } from "@/lib/training/scheduler";
import {
  countSuccessfulRepetitionsSince,
  getAttemptAccuracy,
  getCourseProgress,
  getLineProgressMap,
  listCourses,
  listLines,
} from "@/lib/db/repositories";
import type { LocalStore } from "@/lib/db/local-store";
import type {
  CourseSummary,
  DueLine,
  LineStatus,
  ProgressSnapshot,
  SessionPlan,
} from "@/lib/types";

const STATUSES: LineStatus[] = ["NEW", "LEARNING", "REVIEW", "MASTERED"];

/** Lines whose review is due now, soonest-scheduled first. */
export function getDueLines(
  store: LocalStore,
  userId: string,
  now: Date = new Date(),
  limit = 50,
): DueLine[] {
  const rows = store.all<{
    line_id: string;
    course_id: string;
    course_slug: string;
    course_name: string;
    name: string;
    description: string;
    status: LineStatus;
    streak: number;
    lapses: number;
    accuracy: number;
    next_review_at: string;
  }>(
    `select ulp.line_id, c.id as course_id, c.slug as course_slug, c.name as course_name,
            cl.name, cl.description, ulp.status, ulp.streak, ulp.lapses, ulp.accuracy,
            ulp.next_review_at
       from user_line_progress ulp
       join course_lines cl on cl.id = ulp.line_id
       join courses c on c.id = cl.course_id
      where ulp.user_id = ?
        and ulp.next_review_at is not null
        and ulp.next_review_at <= ?
      order by ulp.next_review_at asc
      limit ?`,
    [userId, now.toISOString(), limit],
  );

  return rows.map((row) => ({
    lineId: row.line_id,
    courseId: row.course_id,
    courseSlug: row.course_slug,
    courseName: row.course_name,
    name: row.name,
    description: row.description,
    status: row.status,
    streak: row.streak,
    lapses: row.lapses,
    accuracy: row.accuracy,
    nextReviewAt: row.next_review_at,
    overdueSeconds: Math.max(
      0,
      Math.floor((now.getTime() - new Date(row.next_review_at).getTime()) / 1000),
    ),
  }));
}

/** Lines the learner keeps missing — the "weak lines" panel (PRD §10). */
export function getWeakLines(
  store: LocalStore,
  userId: string,
  limit = 20,
): (DueLine & { incorrectCount: number })[] {
  const rows = store.all<{
    line_id: string;
    course_id: string;
    course_slug: string;
    course_name: string;
    name: string;
    description: string;
    status: LineStatus;
    streak: number;
    lapses: number;
    accuracy: number;
    incorrect_count: number;
    next_review_at: string | null;
  }>(
    `select ulp.line_id, c.id as course_id, c.slug as course_slug, c.name as course_name,
            cl.name, cl.description, ulp.status, ulp.streak, ulp.lapses, ulp.accuracy,
            ulp.incorrect_count, ulp.next_review_at
       from user_line_progress ulp
       join course_lines cl on cl.id = ulp.line_id
       join courses c on c.id = cl.course_id
      where ulp.user_id = ?
        and (ulp.correct_count + ulp.incorrect_count) >= 2
        and (ulp.accuracy < 0.6 or ulp.lapses >= 2)
      order by ulp.accuracy asc, ulp.lapses desc
      limit ?`,
    [userId, limit],
  );

  return rows.map((row) => ({
    lineId: row.line_id,
    courseId: row.course_id,
    courseSlug: row.course_slug,
    courseName: row.course_name,
    name: row.name,
    description: row.description,
    status: row.status,
    streak: row.streak,
    lapses: row.lapses,
    accuracy: row.accuracy,
    incorrectCount: row.incorrect_count,
    nextReviewAt: row.next_review_at,
    overdueSeconds: 0,
  }));
}

export function getProgressSnapshot(
  store: LocalStore,
  userId: string,
  now: Date = new Date(),
): ProgressSnapshot {
  const courses = listCourses(store);
  const entries = courses.map((course) => buildCourseEntry(store, userId, course, now));
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const dueLines = getDueLines(store, userId, now, 500);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const dueToday = getDueLines(store, userId, endOfDay, 1000).length;

  const totals = entries.reduce(
    (acc, entry) => ({
      linesAttempted: acc.linesAttempted + entry.progress.linesAttempted,
      linesMastered: acc.linesMastered + entry.progress.linesMastered,
      dueNow: acc.dueNow + entry.dueNow,
    }),
    { linesAttempted: 0, linesMastered: 0, dueNow: 0 },
  );

  const { correct, incorrect } = getAttemptAccuracy(store, userId);
  const attempted = correct + incorrect;

  return {
    userId,
    courses: entries,
    totals: {
      linesAttempted: totals.linesAttempted,
      linesMastered: totals.linesMastered,
      dueNow: dueLines.length,
      dueToday,
      successfulRepetitionsLast7Days: countSuccessfulRepetitionsSince(store, userId, since),
      accuracy: attempted === 0 ? 0 : Math.round((correct / attempted) * 10_000) / 10_000,
    },
  };
}

function buildCourseEntry(
  store: LocalStore,
  userId: string,
  course: CourseSummary,
  now: Date,
): ProgressSnapshot["courses"][number] {
  const lines = listLines(store, course.id);
  const progressMap = getLineProgressMap(store, userId, course.id);
  const courseProgress = getCourseProgress(store, userId, course.id);

  const byStatus: Record<LineStatus, number> = { NEW: 0, LEARNING: 0, REVIEW: 0, MASTERED: 0 };
  let dueNow = 0;
  let attempted = 0;

  for (const line of lines) {
    const state = progressMap.get(line.id);
    if (!state) {
      byStatus.NEW += 1;
      continue;
    }
    byStatus[state.status] += 1;
    if (state.correctCount + state.incorrectCount > 0) attempted += 1;
    if (state.nextReviewAt && new Date(state.nextReviewAt).getTime() <= now.getTime()) {
      dueNow += 1;
    }
  }

  const totalLines = lines.length;
  const mastered = byStatus.MASTERED;

  return {
    course,
    progress:
      courseProgress ?? {
        id: "",
        userId,
        courseId: course.id,
        unlockedLines: unlockedLineCount(mastered, totalLines),
        linesAttempted: attempted,
        linesMastered: mastered,
        totalSessions: 0,
        lastTrainedAt: null,
        updatedAt: now.toISOString(),
      },
    byStatus,
    dueNow,
    masteryRate: attempted === 0 ? 0 : Math.round((mastered / attempted) * 10_000) / 10_000,
  };
}

/**
 * Choose the lines for the next session (PRD §23, §85).
 *
 * Deliberately server-computed: the learner should not be able to pick only the
 * lines they already know, because the whole product is the adaptive engine.
 */
export function planSession(
  store: LocalStore,
  userId: string,
  courseId: string,
  options: { now?: Date; sessionSize?: number } = {},
): SessionPlan {
  const now = options.now ?? new Date();
  const lines = listLines(store, courseId);
  const progressMap = getLineProgressMap(store, userId, courseId);

  const candidates: LineCandidate[] = lines.map((line) => ({
    lineId: line.id,
    sortOrder: line.sortOrder,
    difficulty: line.difficulty,
    progress: progressMap.get(line.id) ?? initialProgress(),
  }));

  const mastered = candidates.filter((c) => c.progress.status === "MASTERED").length;
  const unlocked = unlockedLineCount(mastered, candidates.length);

  const selection = selectCohort({
    candidates,
    unlocked,
    sessionSize: options.sessionSize ?? DEFAULT_SESSION_SIZE,
    now,
  });

  return {
    lineIds: selection.lineIds,
    breakdown: selection.breakdown,
    unlocked: selection.unlocked,
    total: candidates.length,
  };
}

export { STATUSES };
