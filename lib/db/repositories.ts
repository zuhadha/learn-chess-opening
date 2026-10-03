/**
 * Data access.
 *
 * This is the seam a Supabase implementation replaces: everything the app needs
 * from the database is expressed here, and nothing else imports SQL.
 *
 * Reads that drive training are deliberately cheap and index-backed
 * (`idx_user_line_review`, `idx_moves_position`), because the two rules the
 * product lives by are "no request per move" (PRD §74) and "progress persists"
 * (PRD §83).
 */

import type { LocalStore } from "@/lib/db/local-store";
import { estimateMinutes } from "@/lib/chess/tree";
import type {
  Course,
  CourseSummary,
  CourseTree,
  LineProgressState,
  LineStatus,
  TrainingAttempt,
  TrainingMode,
  TrainingSession,
  UserCourseProgress,
} from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                  */
/* -------------------------------------------------------------------------- */

interface CourseRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  side: "white" | "black";
  eco: string | null;
  difficulty: number;
  status: "draft" | "review" | "published" | "archived";
  root_fen: string;
  author_id: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
  author_name?: string | null;
  line_count?: number;
  decision_count?: number;
}

interface LineRow {
  id: string;
  course_id: string;
  root_position_id: string;
  name: string;
  description: string;
  move_count: number;
  ply_count: number;
  difficulty: number;
  sort_order: number;
  eco: string | null;
}

interface LineMoveRow {
  line_id: string;
  move_id: string;
}

interface PositionRow {
  id: string;
  fen: string;
  ply: number;
  side_to_move: "w" | "b";
  depth: number;
  parent_position_id: string | null;
}

interface MoveRow {
  id: string;
  position_id: string;
  next_position_id: string;
  uci: string;
  san: string;
  is_expected: number;
  frequency: number;
  explanation: string | null;
}

interface LineProgressRow {
  id: string;
  user_id: string;
  line_id: string;
  status: LineStatus;
  repetitions: number;
  correct_count: number;
  incorrect_count: number;
  lapses: number;
  streak: number;
  ease_factor: number;
  interval_seconds: number;
  accuracy: number;
  last_attempt_at: string | null;
  next_review_at: string | null;
  updated_at: string;
}

interface CourseProgressRow {
  id: string;
  user_id: string;
  course_id: string;
  unlocked_lines: number;
  lines_attempted: number;
  lines_mastered: number;
  total_sessions: number;
  last_trained_at: string | null;
  updated_at: string;
}

/* -------------------------------------------------------------------------- */
/* Content                                                                     */
/* -------------------------------------------------------------------------- */

export interface CourseFilter {
  search?: string;
  side?: "white" | "black";
  status?: Course["status"];
}

/**
 * Course cards (PRD §10).
 *
 * Search matches name, description, ECO and the move sequence, so "Caro Kann",
 * "Caro-Kann", "caro" and "1.e4 c6" all resolve to the same course.
 */
export function listCourses(store: LocalStore, filter: CourseFilter = {}): CourseSummary[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filter.status) {
    clauses.push("c.status = ?");
    params.push(filter.status);
  } else {
    clauses.push("c.status = 'published'");
  }
  if (filter.side) {
    clauses.push("c.side = ?");
    params.push(filter.side);
  }

  const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";

  const rows = store.all<CourseRow>(
    `select c.*, a.name as author_name
       from courses c
       left join course_authors a on a.id = c.author_id
      ${where}
      order by c.slug`,
    params,
  );

  return rows
    .filter((row) => matchesSearch(row, filter.search))
    .map((row) => toCourseSummary(store, row));
}

function matchesSearch(row: CourseRow, search?: string): boolean {
  const needle = normalizeSearch(search ?? "");
  if (!needle) return true;
  const haystack = normalizeSearch(
    [row.name, row.description, row.eco ?? "", row.author_name ?? "", row.slug, row.root_fen]
      .filter(Boolean)
      .join(" "),
  );
  // Every token must appear, so "caro kann" and "kann caro" both match.
  return needle.split(/\s+/).every((token) => haystack.includes(token));
}

/** "Caro-Kann" -> "caro kann", so hyphens and spacing stop mattering. */
export function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
}

function toCourseSummary(store: LocalStore, row: CourseRow): CourseSummary {
  const counts = store.get<{ line_count: number; decision_count: number }>(
    `select count(*) as line_count, coalesce(sum(move_count), 0) as decision_count
       from course_lines where course_id = ?`,
    [row.id],
  );
  const lineCount = counts?.line_count ?? 0;
  const decisionCount = counts?.decision_count ?? 0;
  return {
    ...toCourse(row),
    authorName: row.author_name ?? "Unknown",
    lineCount,
    decisionCount,
    estimatedMinutes: estimateMinutes(
      store
        .all<{ move_count: number }>(`select move_count from course_lines where course_id = ?`, [
          row.id,
        ])
        .map((l) => ({ moveCount: l.move_count })),
    ),
  };
}

function toCourse(row: CourseRow): Course {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    side: row.side,
    eco: row.eco,
    difficulty: row.difficulty,
    status: row.status,
    authorName: row.author_name ?? "Unknown",
    rootFen: row.root_fen,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getCourseBySlug(store: LocalStore, slug: string): CourseSummary | undefined {
  const row = store.get<CourseRow>(
    `select c.*, a.name as author_name
       from courses c left join course_authors a on a.id = c.author_id
      where c.slug = ?`,
    [slug],
  );
  return row ? toCourseSummary(store, row) : undefined;
}

export function getCourseById(store: LocalStore, id: string): CourseSummary | undefined {
  const row = store.get<CourseRow>(
    `select c.*, a.name as author_name
       from courses c left join course_authors a on a.id = c.author_id
      where c.id = ?`,
    [id],
  );
  return row ? toCourseSummary(store, row) : undefined;
}

export function listLines(store: LocalStore, courseId: string) {
  return store
    .all<LineRow>(`select * from course_lines where course_id = ? order by sort_order`, [courseId])
    .map((row) => ({
      id: row.id,
      courseId: row.course_id,
      rootPositionId: row.root_position_id,
      name: row.name,
      description: row.description,
      moveCount: row.move_count,
      plyCount: row.ply_count,
      difficulty: row.difficulty,
      sortOrder: row.sort_order,
      eco: row.eco,
    }));
}

/**
 * The whole training tree for a course, in the shape the browser caches
 * (PRD §41, §73). Course content is immutable, so this is the one response that
 * is safe to cache hard (`s-maxage=3600, stale-while-revalidate`).
 */
export function getCourseTree(store: LocalStore, courseId: string): CourseTree | undefined {
  const course = getCourseById(store, courseId);
  if (!course) return undefined;

  const positions = store.all<PositionRow>(
    `select id, fen, ply, side_to_move, depth, parent_position_id
       from positions where course_id = ?`,
    [courseId],
  );
  const moves = store.all<MoveRow>(
    `select id, position_id, next_position_id, uci, san, is_expected, frequency, explanation
       from moves where course_id = ?`,
    [courseId],
  );
  const lines = store.all<LineRow>(
    `select * from course_lines where course_id = ? order by sort_order`,
    [courseId],
  );
  const lineMoves = store.all<LineMoveRow>(
    `select lm.line_id, lm.move_id
       from course_line_moves lm
       join course_lines l on l.id = lm.line_id
      where l.course_id = ?
      order by lm.line_id, lm.seq`,
    [courseId],
  );

  const moveIdsByLine = new Map<string, string[]>();
  for (const row of lineMoves) {
    const list = moveIdsByLine.get(row.line_id);
    if (list) list.push(row.move_id);
    else moveIdsByLine.set(row.line_id, [row.move_id]);
  }

  return {
    course: {
      id: course.id,
      slug: course.slug,
      name: course.name,
      description: course.description,
      side: course.side,
      eco: course.eco,
      difficulty: course.difficulty,
      rootFen: course.rootFen,
    },
    rootPositionId: positions.find((p) => p.parent_position_id === null)?.id ?? "",
    positions: positions.map((p) => ({
      id: p.id,
      fen: p.fen,
      ply: p.ply,
      sideToMove: p.side_to_move,
      depth: p.depth,
      parentPositionId: p.parent_position_id,
    })),
    moves: moves.map((m) => ({
      id: m.id,
      positionId: m.position_id,
      nextPositionId: m.next_position_id,
      uci: m.uci,
      san: m.san,
      isExpected: m.is_expected === 1,
      frequency: m.frequency,
      explanation: m.explanation,
    })),
    lines: lines.map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      difficulty: l.difficulty,
      sortOrder: l.sort_order,
      rootPositionId: l.root_position_id,
      moveCount: l.move_count,
      plyCount: l.ply_count,
      moveIds: moveIdsByLine.get(l.id) ?? [],
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                    */
/* -------------------------------------------------------------------------- */

export function getLineProgress(
  store: LocalStore,
  userId: string,
  lineId: string,
): LineProgressState | undefined {
  const row = store.get<LineProgressRow>(
    `select * from user_line_progress where user_id = ? and line_id = ?`,
    [userId, lineId],
  );
  return row ? toLineProgressState(row) : undefined;
}

export function getLineProgressMap(
  store: LocalStore,
  userId: string,
  courseId: string,
): Map<string, LineProgressState> {
  const rows = store.all<LineProgressRow>(
    `select ulp.*
       from user_line_progress ulp
       join course_lines cl on cl.id = ulp.line_id
      where ulp.user_id = ? and cl.course_id = ?`,
    [userId, courseId],
  );
  return new Map(rows.map((row) => [row.line_id, toLineProgressState(row)]));
}

export function getAllLineProgress(
  store: LocalStore,
  userId: string,
): (LineProgressState & { lineId: string })[] {
  return store
    .all<LineProgressRow>(`select * from user_line_progress where user_id = ?`, [userId])
    .map((row) => ({ lineId: row.line_id, ...toLineProgressState(row) }));
}

function toLineProgressState(row: LineProgressRow): LineProgressState {
  return {
    status: row.status,
    repetitions: row.repetitions,
    correctCount: row.correct_count,
    incorrectCount: row.incorrect_count,
    lapses: row.lapses,
    streak: row.streak,
    easeFactor: row.ease_factor,
    intervalSeconds: row.interval_seconds,
    accuracy: row.accuracy,
    lastAttemptAt: row.last_attempt_at,
    nextReviewAt: row.next_review_at,
  };
}

export function upsertLineProgress(
  store: LocalStore,
  userId: string,
  lineId: string,
  state: LineProgressState,
  now: string,
): void {
  store.run(
    `insert into user_line_progress (
       id, user_id, line_id, status, repetitions, correct_count, incorrect_count,
       lapses, streak, ease_factor, interval_seconds, accuracy,
       last_attempt_at, next_review_at, created_at, updated_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (user_id, line_id) do update set
       status = excluded.status,
       repetitions = excluded.repetitions,
       correct_count = excluded.correct_count,
       incorrect_count = excluded.incorrect_count,
       lapses = excluded.lapses,
       streak = excluded.streak,
       ease_factor = excluded.ease_factor,
       interval_seconds = excluded.interval_seconds,
       accuracy = excluded.accuracy,
       last_attempt_at = excluded.last_attempt_at,
       next_review_at = excluded.next_review_at,
       updated_at = excluded.updated_at`,
    [
      `ulp:${userId}:${lineId}`,
      userId,
      lineId,
      state.status,
      state.repetitions,
      state.correctCount,
      state.incorrectCount,
      state.lapses,
      state.streak,
      state.easeFactor,
      state.intervalSeconds,
      state.accuracy,
      state.lastAttemptAt,
      state.nextReviewAt,
      now,
      now,
    ],
  );
}

export function getCourseProgress(
  store: LocalStore,
  userId: string,
  courseId: string,
): UserCourseProgress | undefined {
  const row = store.get<CourseProgressRow>(
    `select * from user_course_progress where user_id = ? and course_id = ?`,
    [userId, courseId],
  );
  if (!row) return undefined;
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id,
    unlockedLines: row.unlocked_lines,
    linesAttempted: row.lines_attempted,
    linesMastered: row.lines_mastered,
    totalSessions: row.total_sessions,
    lastTrainedAt: row.last_trained_at,
    updatedAt: row.updated_at,
  };
}

export function upsertCourseProgress(
  store: LocalStore,
  progress: Omit<UserCourseProgress, "id"> & { id?: string },
): void {
  store.run(
    `insert into user_course_progress (
       id, user_id, course_id, unlocked_lines, lines_attempted, lines_mastered,
       total_sessions, last_trained_at, updated_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (user_id, course_id) do update set
       unlocked_lines = excluded.unlocked_lines,
       lines_attempted = excluded.lines_attempted,
       lines_mastered = excluded.lines_mastered,
       total_sessions = excluded.total_sessions,
       last_trained_at = excluded.last_trained_at,
       updated_at = excluded.updated_at`,
    [
      progress.id ?? `ucp:${progress.userId}:${progress.courseId}`,
      progress.userId,
      progress.courseId,
      progress.unlockedLines,
      progress.linesAttempted,
      progress.linesMastered,
      progress.totalSessions,
      progress.lastTrainedAt,
      progress.updatedAt,
    ],
  );
}

/* -------------------------------------------------------------------------- */
/* Sessions and attempts                                                       */
/* -------------------------------------------------------------------------- */

interface SessionRow {
  id: string;
  user_id: string;
  course_id: string;
  mode: TrainingMode;
  started_at: string;
  ended_at: string | null;
  score: number;
  accuracy: number;
  lines_attempted: number;
  lines_completed: number;
  mistakes: number;
  hints_used: number;
}

interface AttemptRow {
  id: string;
  session_id: string;
  user_id: string;
  course_id: string;
  line_id: string;
  position_id: string;
  move_uci: string | null;
  expected_uci: string | null;
  correct: number;
  legal: number;
  hint_used: number;
  elapsed_ms: number;
  attempt_index: number;
  created_at: string;
}

export function createSession(
  store: LocalStore,
  input: {
    userId: string;
    courseId: string;
    mode: TrainingMode;
    startedAt: string;
    id: string;
  },
): TrainingSession {
  store.run(
    `insert into training_sessions (
       id, user_id, course_id, mode, started_at, score, accuracy,
       lines_attempted, lines_completed, mistakes, hints_used
     ) values (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0)`,
    [input.id, input.userId, input.courseId, input.mode, input.startedAt],
  );
  return toSession(
    store.get<SessionRow>(`select * from training_sessions where id = ?`, [input.id])!,
  );
}

export function getSession(store: LocalStore, sessionId: string): TrainingSession | undefined {
  const row = store.get<SessionRow>(`select * from training_sessions where id = ?`, [sessionId]);
  return row ? toSession(row) : undefined;
}

export function insertAttempt(
  store: LocalStore,
  attempt: Omit<TrainingAttempt, "createdAt"> & { legal: boolean; createdAt: string },
): void {
  store.run(
    `insert into training_attempts (
       id, session_id, user_id, course_id, line_id, position_id, move_uci, expected_uci,
       correct, legal, hint_used, elapsed_ms, attempt_index, created_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     -- Attempts arrive at-least-once (the client retries a failed batch), so a
     -- replay of the same attempt is a no-op rather than a duplicate row.
     on conflict (id) do nothing`,
    [
      attempt.id,
      attempt.sessionId,
      attempt.userId,
      attempt.courseId,
      attempt.lineId,
      attempt.positionId,
      attempt.moveUci,
      attempt.expectedUci,
      attempt.correct,
      attempt.legal,
      attempt.hintUsed,
      attempt.elapsedMs,
      attempt.attemptIndex,
      attempt.createdAt,
    ],
  );
}

export function listAttempts(store: LocalStore, sessionId: string) {
  return store
    .all<AttemptRow>(
      `select * from training_attempts where session_id = ? order by attempt_index, created_at`,
      [sessionId],
    )
    .map(toAttempt);
}

/** Attempts for one line inside one session, in play order. */
export function listLineAttempts(
  store: LocalStore,
  sessionId: string,
  lineId: string,
): (TrainingAttempt & { legal: boolean })[] {
  return store
    .all<AttemptRow>(
      `select * from training_attempts
        where session_id = ? and line_id = ?
        order by attempt_index, created_at`,
      [sessionId, lineId],
    )
    .map(toAttempt);
}

export function countAttempts(store: LocalStore, sessionId: string): number {
  return store.get<{ n: number }>(`select count(*) as n from training_attempts where session_id = ?`, [
    sessionId,
  ])?.n ?? 0;
}

export function updateSession(
  store: LocalStore,
  sessionId: string,
  patch: Partial<Pick<TrainingSession, "endedAt" | "score" | "accuracy" | "linesAttempted" | "linesCompleted" | "mistakes" | "hintsUsed">>,
): TrainingSession | undefined {
  const current = getSession(store, sessionId);
  if (!current) return undefined;
  store.run(
    `update training_sessions set
       ended_at = ?, score = ?, accuracy = ?, lines_attempted = ?, lines_completed = ?,
       mistakes = ?, hints_used = ?
     where id = ?`,
    [
      patch.endedAt ?? current.endedAt,
      patch.score ?? current.score,
      patch.accuracy ?? current.accuracy,
      patch.linesAttempted ?? current.linesAttempted,
      patch.linesCompleted ?? current.linesCompleted,
      patch.mistakes ?? current.mistakes,
      patch.hintsUsed ?? current.hintsUsed,
      sessionId,
    ],
  );
  return getSession(store, sessionId);
}

/**
 * Move-level accuracy across every attempt this learner has ever made.
 *
 * Deliberately not derived from `user_line_progress.accuracy`: since the
 * schedule advances per completed line, those counters describe line
 * repetitions, not individual recalls (PRD §60 distinguishes the two).
 */
export function getAttemptAccuracy(
  store: LocalStore,
  userId: string,
): { correct: number; incorrect: number } {
  const row = store.get<{ correct: number; incorrect: number }>(
    `select coalesce(sum(case when correct = 1 then 1 else 0 end), 0) as correct,
            coalesce(sum(case when correct = 0 then 1 else 0 end), 0) as incorrect
       from training_attempts where user_id = ?`,
    [userId],
  );
  return { correct: row?.correct ?? 0, incorrect: row?.incorrect ?? 0 };
}

/** Attempts in a time window — powers the north-star metric (PRD §59). */
export function countSuccessfulRepetitionsSince(
  store: LocalStore,
  userId: string,
  sinceIso: string,
): number {
  return (
    store.get<{ n: number }>(
      `select count(*) as n from training_attempts
        where user_id = ? and correct = 1 and created_at >= ?`,
      [userId, sinceIso],
    )?.n ?? 0
  );
}

function toSession(row: SessionRow): TrainingSession {
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id,
    mode: row.mode,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    score: row.score,
    accuracy: row.accuracy,
    linesAttempted: row.lines_attempted,
    linesCompleted: row.lines_completed,
    mistakes: row.mistakes,
    hintsUsed: row.hints_used,
  };
}

function toAttempt(row: AttemptRow): TrainingAttempt & { legal: boolean } {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    courseId: row.course_id,
    lineId: row.line_id,
    positionId: row.position_id,
    moveUci: row.move_uci ?? "",
    expectedUci: row.expected_uci ?? "",
    correct: row.correct === 1,
    legal: row.legal === 1,
    hintUsed: row.hint_used === 1,
    elapsedMs: row.elapsed_ms,
    attemptIndex: row.attempt_index,
    createdAt: row.created_at,
  };
}
