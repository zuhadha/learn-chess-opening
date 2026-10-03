/**
 * The opening tree (PRD §12, §73).
 *
 * Content authors write linear lines. `buildCourseTree` folds them into a
 * position graph: nodes are positions, edges are moves, and transpositions
 * collapse onto a single node via their Zobrist hash.
 *
 * `TreeIndex` is the read model the browser keeps in memory for a whole
 * session. Every lookup the training loop needs — expected moves, next
 * position, line walk — is a `Map` hit, so a session never touches the network
 * for a single move (PRD §40, §74).
 */

import { Chess } from "chess.js";

import { fenPly, fenSideToMove, toUci } from "@/lib/chess/uci";
import { zobristHash } from "@/lib/chess/zobrist";
import type { CourseSpec, LineSpec } from "@/lib/content/types";
import { lineDifficulty } from "@/lib/training/difficulty";
import type {
  Course,
  CourseTree,
  LineDto,
  Move,
  MoveDto,
  Position,
  PositionDto,
  Side,
} from "@/lib/types";

export interface BuildError {
  lineId: string;
  ply: number;
  san: string;
  message: string;
}

export interface BuiltLine {
  id: string;
  courseId: string;
  rootPositionId: string;
  endPositionId: string;
  name: string;
  description: string;
  /** Moves the learner has to recall — not total plies. */
  moveCount: number;
  plyCount: number;
  difficulty: number;
  sortOrder: number;
  eco: string | null;
  moveIds: string[];
}

/**
 * Neutral prior for a move the author supplied no frequency for. It exists only
 * so opponent-reply ranking and the rarity term of the difficulty model have
 * something to work with; it is never presented to learners as data.
 */
export const DEFAULT_MOVE_FREQUENCY = 0.35;

export interface BuiltCourse {
  course: Omit<Course, "createdAt" | "updatedAt">;
  rootPositionId: string;
  positions: Position[];
  moves: Move[];
  lines: BuiltLine[];
  errors: BuildError[];
  /** Edge keys `positionId:mover:uci` whose frequency came from the author. */
  authoredFrequency: Set<string>;
}

interface NodeDraft {
  id: string;
  fen: string;
  zobristHash: string;
  parentPositionId: string | null;
  ply: number;
  sideToMove: Side;
  depth: number;
  openingName: string | null;
  eco: string | null;
}

interface EdgeDraft {
  id: string;
  positionId: string;
  nextPositionId: string;
  uci: string;
  san: string;
  isExpected: boolean;
  frequency: number | null;
  explanation: string | null;
  games: number | null;
  mover: Side;
}

export function positionId(zobrist: string): string {
  return `pos_${zobrist}`;
}

export function moveId(fromPositionId: string, uci: string): string {
  return `mv_${fromPositionId.slice(4)}_${uci}`;
}

export function learnerSide(side: "white" | "black"): Side {
  return side === "white" ? "w" : "b";
}

/**
 * Fold a course spec into the position graph.
 *
 * The result is deterministic: ids derive from Zobrist hashes, so seeding the
 * same content twice produces identical rows. Illegal lines are collected in
 * `errors` instead of throwing, so one bad line cannot block a whole import
 * (PRD §90 requires that validation reject them, not hide them).
 */
export function buildCourseTree(spec: CourseSpec, courseId: string): BuiltCourse {
  const rootFen = spec.rootFen ?? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const errors: BuildError[] = [];
  const playerSide = learnerSide(spec.side);
  const opponentSide: Side = playerSide === "w" ? "b" : "w";

  const nodes = new Map<string, NodeDraft>();
  const edges = new Map<string, EdgeDraft>();
  const edgesById = new Map<string, EdgeDraft>();

  const rootHash = zobristHash(rootFen);
  const rootPositionId = positionId(rootHash);
  nodes.set(rootPositionId, {
    id: rootPositionId,
    fen: rootFen,
    zobristHash: rootHash,
    parentPositionId: null,
    ply: fenPly(rootFen),
    sideToMove: fenSideToMove(rootFen),
    depth: 0,
    openingName: spec.name,
    eco: spec.eco ?? null,
  });

  interface LineDraft {
    spec: LineSpec;
    moveIds: string[];
    endPositionId: string;
  }
  const lineDrafts: LineDraft[] = [];

  for (const lineSpec of spec.lines) {
    const chess = new Chess(rootFen);
    const moveIds: string[] = [];
    let currentNodeId = rootPositionId;
    let depth = 0;

    lineSpec.moves.forEach((moveSpec, index) => {
      const beforeFen = chess.fen();
      const mover = fenSideToMove(beforeFen);

      let played;
      try {
        played = chess.move(moveSpec.san);
      } catch (error) {
        errors.push({
          lineId: lineSpec.id,
          ply: index,
          san: moveSpec.san,
          message:
            error instanceof Error
              ? `${error.message} (line "${lineSpec.id}" after "${lineSpec.moves
                  .slice(0, index)
                  .map((m) => m.san)
                  .join(" ")}")`
              : String(error),
        });
        return;
      }

      const afterFen = chess.fen();
      const afterHash = zobristHash(afterFen);
      const nextPositionId = positionId(afterHash);
      depth += 1;

      if (!nodes.has(nextPositionId)) {
        nodes.set(nextPositionId, {
          id: nextPositionId,
          fen: afterFen,
          zobristHash: afterHash,
          parentPositionId: currentNodeId,
          ply: fenPly(afterFen),
          sideToMove: fenSideToMove(afterFen),
          depth,
          openingName: lineSpec.name,
          eco: lineSpec.eco ?? spec.eco ?? null,
        });
      }

      const uci = toUci(played.from, played.to, played.promotion);
      const edgeKey = `${currentNodeId}:${uci}`;
      let edge = edges.get(edgeKey);

      if (!edge) {
        edge = {
          id: moveId(currentNodeId, uci),
          positionId: currentNodeId,
          nextPositionId,
          uci,
          san: played.san,
          isExpected: moveSpec.deviation !== true,
          frequency: clampFrequency(moveSpec.frequency),
          explanation: moveSpec.explanation ?? null,
          games: moveSpec.games ?? null,
          mover,
        };
        edges.set(edgeKey, edge);
        edgesById.set(edge.id, edge);
      } else {
        // Reached from another line: keep the richer metadata.
        if (!edge.explanation && moveSpec.explanation) edge.explanation = moveSpec.explanation;
        if (edge.frequency === null && moveSpec.frequency !== undefined) {
          edge.frequency = clampFrequency(moveSpec.frequency);
        }
        if (edge.games === null && moveSpec.games !== undefined) edge.games = moveSpec.games;
        if (moveSpec.deviation !== true) edge.isExpected = true;
      }

      moveIds.push(edge.id);
      currentNodeId = nextPositionId;
    });

    if (moveIds.length > 0) {
      lineDrafts.push({ spec: lineSpec, moveIds, endPositionId: currentNodeId });
    } else {
      errors.push({
        lineId: lineSpec.id,
        ply: 0,
        san: lineSpec.moves[0]?.san ?? "",
        message: `line "${lineSpec.id}" produced no legal moves`,
      });
    }
  }

  // Outgoing move count per (position, side) — the branch-count input to the
  // difficulty model. Computed once here instead of rescanning the edge set per
  // line, which keeps the import linear in the number of moves (PRD §72).
  const outDegree = new Map<string, number>();
  for (const edge of edges.values()) {
    const key = `${edge.positionId}:${edge.mover}`;
    outDegree.set(key, (outDegree.get(key) ?? 0) + 1);
  }

  // `frequency` keeps its PRD §48 meaning: the share of human games at this
  // position that continue with this move. It is NOT renormalised across the
  // moves a course happens to model — a repertoire covers a slice of the game
  // tree, and forcing that slice to sum to 1 would silently turn "played in 11%
  // of games" into "the only move", which would also break the rarity term of
  // the difficulty model. Moves with no data get a neutral prior instead.
  const edgeFrequency = new Map<string, number>();
  const authoredFrequency = new Set<string>();
  for (const edge of edges.values()) {
    const authored = clampFrequency(edge.frequency);
    const key = `${edge.positionId}:${edge.uci}`;
    if (authored !== null) authoredFrequency.add(`${edge.positionId}:${edge.mover}:${edge.uci}`);
    edgeFrequency.set(key, authored ?? DEFAULT_MOVE_FREQUENCY);
  }

  const lines: BuiltLine[] = lineDrafts.map((draft, index) => {
    let playerMoveCount = 0;
    const branchFactors: number[] = [];
    const opponentFrequencies: number[] = [];

    for (const id of draft.moveIds) {
      const edge = edgesById.get(id);
      if (!edge) continue;
      if (edge.mover === playerSide) {
        playerMoveCount += 1;
      } else {
        branchFactors.push(outDegree.get(`${edge.positionId}:${opponentSide}`) ?? 1);
        opponentFrequencies.push(edgeFrequency.get(`${edge.positionId}:${edge.uci}`) ?? 1);
      }
    }

    const avgBranch = mean(branchFactors, 1);
    const avgFrequency = mean(opponentFrequencies, 1);

    return {
      id: `${courseId}:line:${draft.spec.id}`,
      courseId,
      rootPositionId,
      endPositionId: draft.endPositionId,
      name: draft.spec.name,
      description: draft.spec.description,
      moveCount: playerMoveCount,
      plyCount: draft.moveIds.length,
      difficulty:
        draft.spec.difficulty ??
        lineDifficulty({
          playerMoveCount,
          branchFactor: avgBranch,
          opponentFrequency: avgFrequency,
          errorRate: 0,
        }),
      sortOrder: index,
      eco: draft.spec.eco ?? spec.eco ?? null,
      moveIds: draft.moveIds,
    };
  });

  const positions: Position[] = [...nodes.values()].map((node) => ({
    id: node.id,
    courseId,
    fen: node.fen,
    zobristHash: node.zobristHash,
    parentPositionId: node.parentPositionId,
    ply: node.ply,
    sideToMove: node.sideToMove,
    depth: node.depth,
    openingName: node.openingName,
    eco: node.eco,
  }));

  const moves: Move[] = [...edges.values()].map((edge, index) => ({
    id: edge.id,
    courseId,
    positionId: edge.positionId,
    nextPositionId: edge.nextPositionId,
    uci: edge.uci,
    san: edge.san,
    isExpected: edge.isExpected,
    frequency: edgeFrequency.get(`${edge.positionId}:${edge.uci}`) ?? 0,
    // Expected repertoire moves sort ahead of deviations, then by frequency.
    priority: (edge.isExpected ? 1000 : 500) - index,
    explanation: edge.explanation,
    games: edge.games,
  }));

  const meanLineDifficulty = mean(
    lines.map((l) => l.difficulty),
    1,
  );

  return {
    course: {
      id: courseId,
      slug: spec.slug,
      name: spec.name,
      description: spec.description,
      side: spec.side,
      eco: spec.eco ?? null,
      difficulty:
        spec.difficulty ?? Math.max(1, Math.min(5, Math.round(meanLineDifficulty))),
      status: "published",
      authorName: spec.authorName,
      rootFen,
    },
    rootPositionId,
    positions,
    moves,
    lines,
    errors,
    authoredFrequency,
  };
}

function clampFrequency(value: number | null | undefined): number | null {
  if (value === undefined || value === null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function mean(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/* -------------------------------------------------------------------------- */
/* Read model                                                                  */
/* -------------------------------------------------------------------------- */

export interface PositionNode {
  position: PositionDto;
  moves: MoveDto[];
}

export interface LineStep {
  index: number;
  move: MoveDto;
  mover: Side;
  positionId: string;
  nextPositionId: string;
  /** True when the learner has to produce this move. */
  isDecision: boolean;
}

/**
 * O(1) in-memory view of a course tree (PRD §73).
 *
 * Built once per session from the `/api/courses/:slug/tree` payload and reused
 * for every move the learner plays.
 */
export class TreeIndex {
  private readonly positions = new Map<string, PositionDto>();
  private readonly nodes = new Map<string, PositionNode>();
  private readonly movesById = new Map<string, MoveDto>();
  private readonly linesById = new Map<string, LineDto>();
  private readonly stepsCache = new Map<string, LineStep[]>();
  private readonly rootPositionId: string;
  readonly playerSide: Side;

  constructor(tree: CourseTree) {
    this.rootPositionId = tree.rootPositionId;
    this.playerSide = learnerSide(tree.course.side);

    for (const position of tree.positions) {
      this.positions.set(position.id, position);
      this.nodes.set(position.id, { position, moves: [] });
    }
    for (const move of tree.moves) {
      this.movesById.set(move.id, move);
      this.nodes.get(move.positionId)?.moves.push(move);
    }
    for (const node of this.nodes.values()) {
      node.moves.sort((a, b) => b.frequency - a.frequency);
    }
    for (const line of tree.lines) this.linesById.set(line.id, line);
  }

  get root(): PositionDto {
    const root = this.positions.get(this.rootPositionId);
    if (!root) throw new Error(`TreeIndex: missing root position ${this.rootPositionId}`);
    return root;
  }

  get size(): { positions: number; moves: number; lines: number } {
    return {
      positions: this.positions.size,
      moves: this.movesById.size,
      lines: this.linesById.size,
    };
  }

  get rootId(): string {
    return this.rootPositionId;
  }

  position(id: string): PositionDto | undefined {
    return this.positions.get(id);
  }

  movesFrom(positionId: string): MoveDto[] {
    return this.nodes.get(positionId)?.moves ?? [];
  }

  /**
   * The repertoire moves for `side` at a position. Only these count as a
   * correct answer — chess-legality is a separate question (PRD §93).
   */
  expectedMoves(positionId: string, side: Side): MoveDto[] {
    const position = this.positions.get(positionId);
    if (!position || position.sideToMove !== side) return [];
    return this.movesFrom(positionId).filter((move) => move.isExpected);
  }

  /** Every tree move `side` can make here, expected or not. */
  movesFor(positionId: string, side: Side): MoveDto[] {
    const position = this.positions.get(positionId);
    if (!position || position.sideToMove !== side) return [];
    return this.movesFrom(positionId);
  }

  moveByUci(positionId: string, uci: string): MoveDto | undefined {
    const needle = uci.toLowerCase();
    return this.movesFrom(positionId).find((move) => move.uci === needle);
  }

  moveById(moveIdValue: string): MoveDto | undefined {
    return this.movesById.get(moveIdValue);
  }

  line(lineId: string): LineDto | undefined {
    return this.linesById.get(lineId);
  }

  lines(): LineDto[] {
    return [...this.linesById.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /** Ordered walk of a line, with each step tagged as a learner decision. */
  steps(lineId: string): LineStep[] {
    const cached = this.stepsCache.get(lineId);
    if (cached) return cached;

    const line = this.linesById.get(lineId);
    const steps: LineStep[] = [];
    if (line) {
      line.moveIds.forEach((id, index) => {
        const move = this.movesById.get(id);
        if (!move) return;
        const position = this.positions.get(move.positionId);
        if (!position) return;
        steps.push({
          index,
          move,
          mover: position.sideToMove,
          positionId: move.positionId,
          nextPositionId: move.nextPositionId,
          isDecision: position.sideToMove === this.playerSide,
        });
      });
    }
    this.stepsCache.set(lineId, steps);
    return steps;
  }

  /** Positions where the learner must answer, in order. */
  decisions(lineId: string): LineStep[] {
    return this.steps(lineId).filter((step) => step.isDecision);
  }

  /** The opponent's most common reply at a position (PRD §48). */
  topOpponentReply(positionId: string, learnerSideValue: Side = this.playerSide): MoveDto | undefined {
    const opponent: Side = learnerSideValue === "w" ? "b" : "w";
    const candidates = this.movesFor(positionId, opponent);
    if (candidates.length === 0) return undefined;
    return [...candidates].sort((a, b) => b.frequency - a.frequency)[0];
  }

  /** Total learner decisions across the whole course. */
  decisionCount(): number {
    return this.lines().reduce((sum, line) => sum + line.moveCount, 0);
  }
}

export function toTreeDto(built: BuiltCourse): CourseTree {
  return {
    course: {
      id: built.course.id,
      slug: built.course.slug,
      name: built.course.name,
      description: built.course.description,
      side: built.course.side,
      eco: built.course.eco,
      difficulty: built.course.difficulty,
      rootFen: built.course.rootFen,
    },
    rootPositionId: built.rootPositionId,
    positions: built.positions.map((p) => ({
      id: p.id,
      fen: p.fen,
      ply: p.ply,
      sideToMove: p.sideToMove,
      depth: p.depth,
      parentPositionId: p.parentPositionId,
    })),
    moves: built.moves.map((m) => ({
      id: m.id,
      positionId: m.positionId,
      nextPositionId: m.nextPositionId,
      uci: m.uci,
      san: m.san,
      isExpected: m.isExpected,
      frequency: m.frequency,
      explanation: m.explanation,
    })),
    lines: built.lines.map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      difficulty: l.difficulty,
      sortOrder: l.sortOrder,
      rootPositionId: l.rootPositionId,
      moveCount: l.moveCount,
      plyCount: l.plyCount,
      moveIds: l.moveIds,
    })),
  };
}

/** Rough study-time estimate: ~12s per decision plus 20s of reading per line. */
export function estimateMinutes(lines: { moveCount: number }[]): number {
  const seconds = lines.reduce((sum, l) => sum + l.moveCount * 12 + 20, 0);
  return Math.max(1, Math.round(seconds / 60));
}
