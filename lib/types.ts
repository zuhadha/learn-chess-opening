/**
 * Domain types.
 *
 * The architecture principle from PRD §92 is enforced by the module layout:
 *
 *   CONTENT (courses, positions, moves)   -> immutable, generated offline
 *   TRAINING STATE (sessions, attempts)   -> derived, server-authoritative
 *   USER STATE (progress, preferences)    -> per user, sync'd
 *
 * These types are shared by the browser, the route handlers and the seed
 * scripts, so the wire format and the persistence format stay identical.
 */

/** Chess side, in chess.js notation. */
export type Side = "w" | "b";

/** Course side, as authored: which colour the learner plays. */
export type CourseSide = "white" | "black";

export type CourseStatus = "draft" | "review" | "published" | "archived";

export type TrainingMode = "learn" | "practice";

/** Spaced-repetition lifecycle (PRD §22). */
export type LineStatus = "NEW" | "LEARNING" | "REVIEW" | "MASTERED";

export type CourseDifficultyTag = "beginner" | "intermediate" | "advanced";

/* -------------------------------------------------------------------------- */
/* Content                                                                     */
/* -------------------------------------------------------------------------- */

export interface Course {
  id: string;
  slug: string;
  name: string;
  description: string;
  side: CourseSide;
  eco: string | null;
  difficulty: number;
  status: CourseStatus;
  authorName: string;
  /** Root FEN every line of this course starts from. */
  rootFen: string;
  createdAt: string;
  updatedAt: string;
}

export interface CourseSummary extends Course {
  lineCount: number;
  /** Sum of player decisions across all lines — the real training volume. */
  decisionCount: number;
  estimatedMinutes: number;
}

export interface Position {
  id: string;
  courseId: string;
  fen: string;
  zobristHash: string;
  parentPositionId: string | null;
  /** Half-moves played from the initial position. */
  ply: number;
  sideToMove: Side;
  /** Depth inside this course's tree (0 = course root). */
  depth: number;
  openingName: string | null;
  eco: string | null;
}

export interface Move {
  id: string;
  courseId: string;
  positionId: string;
  nextPositionId: string;
  uci: string;
  san: string;
  /** True when the move belongs to the repertoire (PRD §14). */
  isExpected: boolean;
  /** 0..1 share of this side's outgoing probability mass at the position. */
  frequency: number;
  priority: number;
  explanation: string | null;
  games: number | null;
}

export interface CourseLine {
  id: string;
  courseId: string;
  rootPositionId: string;
  name: string;
  description: string;
  /** Number of moves the learner has to recall (not total plies). */
  moveCount: number;
  plyCount: number;
  difficulty: number;
  sortOrder: number;
  eco: string | null;
  moveIds: string[];
}

/* -------------------------------------------------------------------------- */
/* Wire format for the in-memory training tree (PRD §41, §73)                  */
/* -------------------------------------------------------------------------- */

export interface PositionDto {
  id: string;
  fen: string;
  ply: number;
  sideToMove: Side;
  depth: number;
  parentPositionId: string | null;
}

export interface MoveDto {
  id: string;
  positionId: string;
  nextPositionId: string;
  uci: string;
  san: string;
  isExpected: boolean;
  frequency: number;
  explanation: string | null;
}

export interface LineDto {
  id: string;
  name: string;
  description: string;
  difficulty: number;
  sortOrder: number;
  rootPositionId: string;
  moveCount: number;
  plyCount: number;
  moveIds: string[];
}

export interface CourseTree {
  course: Pick<
    Course,
    "id" | "slug" | "name" | "description" | "side" | "eco" | "difficulty" | "rootFen"
  >;
  rootPositionId: string;
  positions: PositionDto[];
  moves: MoveDto[];
  lines: LineDto[];
}

/* -------------------------------------------------------------------------- */
/* Training state                                                             */
/* -------------------------------------------------------------------------- */

export interface LineProgressState {
  status: LineStatus;
  /** Total correct answers ever. */
  repetitions: number;
  correctCount: number;
  incorrectCount: number;
  lapses: number;
  /** Consecutive correct answers — the scheduling clock. */
  streak: number;
  easeFactor: number;
  intervalSeconds: number;
  accuracy: number;
  lastAttemptAt: string | null;
  nextReviewAt: string | null;
}

export interface UserLineProgress extends LineProgressState {
  id: string;
  userId: string;
  lineId: string;
  updatedAt: string;
}

export interface UserCourseProgress {
  id: string;
  userId: string;
  courseId: string;
  /** Lines the learner has unlocked so far (adaptive cohort, PRD §23). */
  unlockedLines: number;
  linesAttempted: number;
  linesMastered: number;
  totalSessions: number;
  lastTrainedAt: string | null;
  updatedAt: string;
}

export interface TrainingSession {
  id: string;
  userId: string;
  courseId: string;
  mode: TrainingMode;
  startedAt: string;
  endedAt: string | null;
  score: number;
  accuracy: number;
  linesAttempted: number;
  linesCompleted: number;
  mistakes: number;
  hintsUsed: number;
}

export interface TrainingAttempt {
  id: string;
  sessionId: string;
  userId: string;
  courseId: string;
  lineId: string;
  positionId: string;
  moveUci: string;
  expectedUci: string;
  correct: boolean;
  hintUsed: boolean;
  elapsedMs: number;
  attemptIndex: number;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* API payloads                                                               */
/* -------------------------------------------------------------------------- */

export interface AttemptInput {
  sessionId: string;
  lineId: string;
  positionId: string;
  /** SAN or UCI, as typed/played by the learner. */
  move: string;
  hintUsed: boolean;
  elapsedMs: number;
  attemptIndex: number;
}

export interface AttemptResult {
  correct: boolean;
  /** chess.js says the move is legal; the course says whether it is expected. */
  legal: boolean;
  expectedUci: string | null;
  expectedSan: string | null;
  alternatives: { uci: string; san: string }[];
  explanation: string | null;
  /** Human-readable feedback, anti-frustration phrasing per PRD §87. */
  feedback: string;
  progress: LineProgressState;
  /** True when this attempt completed the line and advanced its schedule. */
  completedLine: boolean;
  /** Base value for this attempt. The authoritative session score is recomputed
   *  from the whole attempt log at completion (PRD §57). */
  points: number;
  streak: number;
}

export interface SessionCompleteResult {
  session: TrainingSession;
  /** Recomputed server-side from stored attempts; the client value is ignored. */
  serverScore: number;
  mastery: {
    total: number;
    new: number;
    learning: number;
    review: number;
    mastered: number;
    /** mastered / attempted (PRD §60). */
    masteryRate: number;
  };
  dueIn: { lineId: string; name: string; nextReviewAt: string }[];
}

/** The adaptive cohort chosen for the next session (PRD §23). */
export interface SessionPlan {
  lineIds: string[];
  /** How many lines came from each priority bucket. */
  breakdown: Record<"due" | "weak" | "failed" | "learning" | "new" | "mastered", number>;
  /** Lines the learner has unlocked so far. */
  unlocked: number;
  /** Total lines in the course. */
  total: number;
}

export interface DueLine {
  lineId: string;
  courseId: string;
  courseSlug: string;
  courseName: string;
  name: string;
  description: string;
  status: LineStatus;
  streak: number;
  lapses: number;
  accuracy: number;
  nextReviewAt: string | null;
  /** Overdue seconds; <= 0 for lines that are due now. */
  overdueSeconds: number;
}

export interface ProgressSnapshot {
  userId: string;
  courses: {
    course: CourseSummary;
    progress: UserCourseProgress;
    byStatus: Record<LineStatus, number>;
    dueNow: number;
    masteryRate: number;
  }[];
  totals: {
    linesAttempted: number;
    linesMastered: number;
    dueNow: number;
    dueToday: number;
    /** Correct move recalls in the last 7 days — the north star (PRD §59). */
    successfulRepetitionsLast7Days: number;
    /** Correct moves / all moves, from the attempt log. */
    accuracy: number;
  };
}
