/**
 * Training engine (PRD §15–§17, §26, §93).
 *
 * Two questions are answered here, and they are deliberately different:
 *
 *   chess correctness  — is this a legal chess move?   (chess.js)
 *   training correctness — is this the repertoire move? (the course tree)
 *
 * `Bc4` against the Caro-Kann is perfectly legal and still a failed repetition.
 *
 * The module is pure: no database, no fetch. The browser runs it for instant
 * feedback, and the route handler runs the *same* function to validate an
 * attempt server-side, so a client cannot invent a result (PRD §57).
 */

import { Chess } from "chess.js";

import { normalizeMoveInput, toUci } from "@/lib/chess/uci";
import type { LineStep, TreeIndex } from "@/lib/chess/tree";
import type { MoveDto, Side, TrainingMode } from "@/lib/types";

export type JudgeStatus = "correct" | "incorrect" | "illegal";

export interface JudgeResult {
  status: JudgeStatus;
  legal: boolean;
  /** UCI of what the learner played, if it parsed at all. */
  playedUci: string | null;
  playedSan: string | null;
  expected: { uci: string; san: string } | null;
  /** Other repertoire moves at this node — "Nf3 or Nc3 both work". */
  alternatives: { uci: string; san: string }[];
  explanation: string | null;
  /** Anti-frustration phrasing (PRD §87). */
  feedback: string;
  /** Only populated for illegal input, to help the learner recover. */
  legalSan?: string[];
}

export interface JudgeInput {
  tree: TreeIndex;
  positionId: string;
  /** SAN or UCI, as typed or dragged. */
  move: string;
  learnerSide: Side;
  mode?: TrainingMode;
}

/**
 * Judge one attempt.
 *
 * Never throws on a bad move: illegal input is a result, not an exception,
 * because a learner dragging a piece to a nonsense square is a normal event.
 */
export function judgeMove(input: JudgeInput): JudgeResult {
  const { tree, positionId, learnerSide, mode = "learn" } = input;
  const position = tree.position(positionId);
  const expected = tree.expectedMoves(positionId, learnerSide);

  if (!position) {
    return {
      status: "illegal",
      legal: false,
      playedUci: null,
      playedSan: null,
      expected: null,
      alternatives: [],
      explanation: null,
      feedback: "That position is not part of this course.",
    };
  }

  const chess = new Chess(position.fen);
  const wanted = normalizeMoveInput(input.move);
  const legal = chess.moves({ verbose: true });

  const match = findLegalMove(legal, wanted);
  if (!match) {
    return {
      status: "illegal",
      legal: false,
      playedUci: null,
      playedSan: null,
      expected: primary(expected),
      alternatives: others(expected, undefined),
      explanation: expected[0]?.explanation ?? null,
      feedback: `${wanted} is not a legal move from this position.`,
      legalSan: legal.slice(0, 12).map((m) => m.san),
    };
  }

  const playedUci = toUci(match.from, match.to, match.promotion);
  const expectedUcis = new Set(expected.map((m) => m.uci));
  const treeMove = tree.moveByUci(positionId, playedUci);
  const explanation = treeMove?.explanation ?? expected[0]?.explanation ?? null;

  if (expectedUcis.has(playedUci)) {
    return {
      status: "correct",
      legal: true,
      playedUci,
      playedSan: match.san,
      expected: { uci: playedUci, san: match.san },
      alternatives: others(expected, playedUci),
      explanation,
      feedback: feedbackForCorrect(match.san, explanation, mode),
    };
  }

  // Legal chess, wrong repertoire. This is the case the product exists for.
  const primaryExpected = primary(expected);
  return {
    status: "incorrect",
    legal: true,
    playedUci,
    playedSan: match.san,
    expected: primaryExpected,
    alternatives: others(expected, primaryExpected?.uci),
    explanation,
    feedback: feedbackForIncorrect(match.san, primaryExpected?.san, explanation),
  };
}

type VerboseMove = ReturnType<Chess["moves"]> extends (infer T)[] ? T : never;

function findLegalMove(
  legal: VerboseMove[],
  wanted: string,
): VerboseMove | undefined {
  const needle = wanted.toLowerCase();
  return (
    legal.find((m) => m.san.toLowerCase() === needle) ??
    legal.find((m) => toUci(m.from, m.to, m.promotion) === needle) ??
    // Tolerate a missing promotion suffix: `e8` means `e8=Q`.
    legal.find((m) => m.promotion && `${m.from}${m.to}` === needle)
  );
}

function primary(expected: MoveDto[]): { uci: string; san: string } | null {
  const best = [...expected].sort((a, b) => b.frequency - a.frequency)[0];
  return best ? { uci: best.uci, san: best.san } : null;
}

function others(expected: MoveDto[], excludeUci?: string): { uci: string; san: string }[] {
  return expected
    .filter((m) => m.uci !== excludeUci)
    .map((m) => ({ uci: m.uci, san: m.san }));
}

function feedbackForCorrect(
  san: string,
  explanation: string | null,
  mode: TrainingMode,
): string {
  // Practice mode stays quiet (PRD §16): no automatic explanation.
  if (mode === "practice") return `${san} — correct.`;
  return explanation ? `${san} — ${explanation}` : `${san} — correct.`;
}

function feedbackForIncorrect(
  playedSan: string,
  expectedSan: string | undefined,
  explanation: string | null,
): string {
  const base = expectedSan
    ? `Not quite — the repertoire move is ${expectedSan}.`
    : `Not quite — ${playedSan} is not in this repertoire.`;
  return explanation ? `${base} ${explanation}` : base;
}

/* -------------------------------------------------------------------------- */
/* Line walker                                                                 */
/* -------------------------------------------------------------------------- */

export interface TrainerState {
  lineId: string;
  /** Index into the line's learner decisions. */
  decisionIndex: number;
  positionId: string;
  playerMovesTaken: number;
  mistakes: number;
  hintsUsed: number;
  status: "playing" | "complete";
  /** FENs played so far, newest last — the board's history. */
  history: string[];
  /** SAN of every move played so far, for the move list. */
  sanHistory: { ply: number; side: Side; san: string }[];
}

export function startLine(tree: TreeIndex, lineId: string): TrainerState {
  const decisions = tree.decisions(lineId);
  const first = decisions[0];
  return {
    lineId,
    decisionIndex: 0,
    positionId: first?.positionId ?? tree.rootId,
    playerMovesTaken: 0,
    mistakes: 0,
    hintsUsed: 0,
    status: decisions.length === 0 ? "complete" : "playing",
    history: [tree.position(first?.positionId ?? tree.rootId)?.fen ?? tree.root.fen],
    sanHistory: sanHistoryUpTo(tree, first?.positionId ?? tree.rootId),
  };
}

export function currentDecision(tree: TreeIndex, state: TrainerState): LineStep | null {
  if (state.status === "complete") return null;
  return tree.decisions(state.lineId)[state.decisionIndex] ?? null;
}

export function hintFor(tree: TreeIndex, state: TrainerState): { san: string; explanation: string | null } | null {
  const decision = currentDecision(tree, state);
  if (!decision) return null;
  const expected = tree.expectedMoves(decision.positionId, tree.playerSide);
  const best = primary(expected);
  if (!best) return null;
  const move = tree.moveByUci(decision.positionId, best.uci);
  return { san: best.san, explanation: move?.explanation ?? null };
}

/**
 * Apply one judged attempt to the walker.
 *
 * A wrong answer does not advance the line — the learner retries the same
 * decision (PRD §87). A right answer plays the opponent's reply automatically
 * and moves to the next decision.
 */
export function applyJudgement(
  tree: TreeIndex,
  state: TrainerState,
  result: JudgeResult,
  options: { hintUsed?: boolean } = {},
): TrainerState {
  const decision = currentDecision(tree, state);
  if (!decision) return state;

  const hintsUsed = state.hintsUsed + (options.hintUsed ? 1 : 0);

  if (result.status !== "correct") {
    return { ...state, mistakes: state.mistakes + 1, hintsUsed };
  }

  // Play the learner's move, then the opponent's reply, until the next decision.
  const steps = tree.steps(state.lineId);
  const sanHistory = [...state.sanHistory, { ply: 0, side: decision.mover, san: decision.move.san }];
  const history = [
    ...state.history,
    tree.position(decision.nextPositionId)?.fen ?? state.history[state.history.length - 1] ?? "",
  ];
  const lastPly = tree.position(decision.positionId)?.ply ?? 0;
  sanHistory[sanHistory.length - 1] = { ply: lastPly, side: decision.mover, san: decision.move.san };

  let cursor = decision.index + 1;
  let positionId = decision.nextPositionId;
  while (cursor < steps.length) {
    const step = steps[cursor];
    if (!step) break;
    if (step.isDecision) break;
    sanHistory.push({ ply: tree.position(step.positionId)?.ply ?? 0, side: step.mover, san: step.move.san });
    history.push(tree.position(step.nextPositionId)?.fen ?? positionId);
    positionId = step.nextPositionId;
    cursor += 1;
  }

  const nextDecisionIndex = state.decisionIndex + 1;
  const decisions = tree.decisions(state.lineId);
  const complete = nextDecisionIndex >= decisions.length;

  return {
    ...state,
    decisionIndex: nextDecisionIndex,
    positionId: complete ? positionId : decisions[nextDecisionIndex]?.positionId ?? positionId,
    playerMovesTaken: state.playerMovesTaken + 1,
    hintsUsed,
    status: complete ? "complete" : "playing",
    history,
    sanHistory,
  };
}

/** SAN list for the plies leading up to a position (used to seed the move list). */
function sanHistoryUpTo(tree: TreeIndex, positionId: string): TrainerState["sanHistory"] {
  const result: TrainerState["sanHistory"] = [];
  let cursor = positionId;
  const chain: { ply: number; side: Side; san: string }[] = [];
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const position = tree.position(cursor);
    if (!position || !position.parentPositionId) break;
    const parent = tree.position(position.parentPositionId);
    if (!parent) break;
    const edge = tree
      .movesFrom(parent.id)
      .find((move) => move.nextPositionId === cursor);
    if (!edge) break;
    chain.unshift({ ply: parent.ply, side: parent.sideToMove, san: edge.san });
    cursor = parent.id;
  }
  return result.concat(chain);
}
