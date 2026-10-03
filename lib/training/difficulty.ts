/**
 * Line difficulty (PRD §24).
 *
 * Four inputs, fixed weights, normalised to an integer 1–5. The raw score is
 * never shown to learners — they see "Beginner / Intermediate / Advanced".
 *
 *   difficulty = depth + branching + rarity + user error rate
 */

export const DIFFICULTY_WEIGHTS = {
  /** More decisions to recall = harder. */
  depth: 0.35,
  /** More plausible opponent replies at each node = harder. */
  branch: 0.25,
  /** Rarer opponent replies are less well-rehearsed = harder. */
  rarity: 0.25,
  /** The learner's own error rate for this line. */
  errorRate: 0.15,
} as const;

/** A line with this many decisions is already at the depth ceiling. */
const DEPTH_CEILING_DECISIONS = 12;
/** Branching beyond this adds nothing. */
const BRANCH_CEILING = 4;

export interface DifficultyInput {
  /** Learner decisions in the line, not total plies. */
  playerMoveCount: number;
  /** Mean number of opponent replies at the nodes the line passes through. */
  branchFactor: number;
  /** Mean frequency of the opponent replies on this line, 0..1. */
  opponentFrequency: number;
  /** Learner error rate for this line, 0..1. Defaults to 0 for new lines. */
  errorRate?: number;
}

/**
 * @returns integer 1–5
 */
export function lineDifficulty(input: DifficultyInput): number {
  const depthNorm = clamp01(input.playerMoveCount / DEPTH_CEILING_DECISIONS);
  const branchNorm = clamp01((input.branchFactor - 1) / (BRANCH_CEILING - 1));
  const rarityNorm = clamp01(1 - clamp01(input.opponentFrequency));
  const errorNorm = clamp01(input.errorRate ?? 0);

  const raw =
    DIFFICULTY_WEIGHTS.depth * depthNorm +
    DIFFICULTY_WEIGHTS.branch * branchNorm +
    DIFFICULTY_WEIGHTS.rarity * rarityNorm +
    DIFFICULTY_WEIGHTS.errorRate * errorNorm;

  return clampInt(Math.round(1 + raw * 4), 1, 5);
}

/**
 * Difficulty as the learner sees it: their error rate pulls the number up, so a
 * "Beginner" line they keep missing surfaces as harder in session selection.
 */
export function personalDifficulty(
  staticDifficulty: number,
  errorRate: number,
  attempts: number,
): number {
  if (attempts < 2) return staticDifficulty;
  // Blend the authored difficulty with the personal one once there is signal.
  const personal = clampInt(Math.round(1 + clamp01(errorRate) * 4), 1, 5);
  return clampInt(Math.round(staticDifficulty * 0.5 + personal * 0.5), 1, 5);
}

export function difficultyLabel(difficulty: number): "Beginner" | "Intermediate" | "Advanced" {
  if (difficulty <= 2) return "Beginner";
  if (difficulty <= 3) return "Intermediate";
  return "Advanced";
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
