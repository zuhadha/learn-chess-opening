import type { CourseSide } from "@/lib/types";

/**
 * Authoring format for a course (PRD §11, §89).
 *
 * A course is NOT a PGN blob: it is a set of named lines that the builder in
 * `lib/chess/tree.ts` folds into a shared position graph. Where two lines pass
 * through the same position, they share one node — that is what makes
 * "opponent may play d6 / Nc6 / e6 / a6" expressible (PRD §3).
 */

export interface MoveSpec {
  /** Standard algebraic notation, e.g. `Nf3`, `exd5`, `O-O`, `e8=Q`. */
  san: string;
  /**
   * 1–2 sentences, written for the learner (PRD §88). For learner moves this
   * explains why the repertoire plays it; for opponent moves it explains what
   * the reply is trying to do.
   */
  explanation?: string;
  /**
   * How often humans play this move at this position (PRD §48). Used for
   * opponent replies to rank realistic practice, and for the rarity term of the
   * difficulty model. Omit to share probability evenly with siblings.
   */
  frequency?: number;
  /** Approximate number of games behind `frequency`, purely informational. */
  games?: number;
  /**
   * Marks the move as a deviation the opponent might try rather than a
   * repertoire move. Deviations are trained as "punish this", so the moves
   * after them are still expected.
   */
  deviation?: boolean;
  /** Display flag for traps in the course overview. */
  trap?: boolean;
}

export interface LineSpec {
  /** Stable identifier; becomes the line's primary key. */
  id: string;
  name: string;
  description: string;
  eco?: string;
  /** Full move sequence from the course root position. */
  moves: MoveSpec[];
  /** Overrides the computed difficulty (1–5) when the author knows better. */
  difficulty?: number;
}

export interface CourseSpec {
  slug: string;
  name: string;
  description: string;
  /** Colour the learner plays. */
  side: CourseSide;
  eco?: string;
  /** 1–5. Defaults to the mean of the line difficulties. */
  difficulty?: number;
  authorName: string;
  /** Defaults to the standard starting position. */
  rootFen?: string;
  /** Free-form discovery tags (PRD §10). */
  tags?: string[];
  lines: LineSpec[];
}
