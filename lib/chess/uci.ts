/**
 * Small FEN / SAN / UCI helpers.
 *
 * Everything in here is pure and runs on both the server and the browser, which
 * is what keeps move handling off the network (PRD §40).
 */

import type { Side } from "@/lib/types";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** `e2` + `e4` (+ `q`) -> `e2e4q`. */
export function toUci(from: string, to: string, promotion?: string): string {
  return `${from}${to}${promotion ? promotion.toLowerCase() : ""}`;
}

export function parseUci(uci: string): {
  from: string;
  to: string;
  promotion?: string;
} {
  const clean = uci.trim().toLowerCase();
  if (clean.length < 4) {
    throw new Error(`parseUci: "${uci}" is not a UCI move`);
  }
  return {
    from: clean.slice(0, 2),
    to: clean.slice(2, 4),
    promotion: clean.length > 4 ? clean.slice(4, 5) : undefined,
  };
}

/**
 * Normalise whatever the learner produced into something comparable to a SAN:
 * `0-0` and `O-O` agree, `Nf3` and `nf3 ` agree, `e7e5` stays a UCI string.
 */
export function normalizeMoveInput(input: string): string {
  const trimmed = input.trim();
  const castling = trimmed.replace(/^0-0(-0)?$/i, (m) => (m.length === 3 ? "O-O" : "O-O-O"));
  return castling;
}

export function fenSideToMove(fen: string): Side {
  const parts = fen.trim().split(/\s+/);
  return parts[1] === "b" ? "b" : "w";
}

/** Half-moves played from the initial position. */
export function fenPly(fen: string): number {
  const parts = fen.trim().split(/\s+/);
  const fullmove = Math.max(1, Number(parts[5] ?? 1) || 1);
  const side = fenSideToMove(fen);
  return (fullmove - 1) * 2 + (side === "b" ? 1 : 0);
}

export function otherSide(side: Side): Side {
  return side === "w" ? "b" : "w";
}

export function courseSideToSide(side: "white" | "black"): Side {
  return side === "white" ? "w" : "b";
}

/** Move-number prefix for display: ply 0 -> "1.", ply 1 -> "1...". */
export function plyLabel(ply: number, side: Side): string {
  return `${Math.floor(ply / 2) + 1}.${side === "w" ? "" : ".."}`;
}
