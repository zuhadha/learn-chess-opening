/**
 * Board geometry and piece rendering.
 *
 * Deliberately free of chess.js so that pages which only need to *draw* a
 * position never pull the engine into their bundle (PRD §44, §45).
 */

import type { Side } from "@/lib/types";

export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

/** Solid Unicode glyphs: one shape set for both colours, coloured via CSS. */
const PIECE_GLYPHS: Record<string, string> = {
  k: "\u265a",
  q: "\u265b",
  r: "\u265c",
  b: "\u265d",
  n: "\u265e",
  p: "\u265f",
};

const PIECE_NAMES: Record<string, string> = {
  k: "king",
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn",
};

export interface PlacedPiece {
  type: string;
  color: "w" | "b";
}

export function squareName(file: number, rank: number): string {
  return `${FILES[file] ?? "a"}${rank + 1}`;
}

export function squareFile(square: string): number {
  return FILES.indexOf(square[0] as (typeof FILES)[number]);
}

export function squareRank(square: string): number {
  return Number(square[1]) - 1;
}

/** 64 squares in display order for the given orientation (top-left first). */
export function displaySquares(orientation: Side): string[] {
  const squares: string[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const file = orientation === "w" ? col : 7 - col;
      const rank = orientation === "w" ? 7 - row : row;
      squares.push(squareName(file, rank));
    }
  }
  return squares;
}

export function isLightSquare(square: string): boolean {
  return (squareFile(square) + squareRank(square)) % 2 === 1;
}

/** Parse just the piece placement out of a FEN — no engine, no validation. */
export function piecesFromFen(fen: string): Map<string, PlacedPiece> {
  const placement = fen.trim().split(/\s+/)[0] ?? "";
  const pieces = new Map<string, PlacedPiece>();
  const ranks = placement.split("/");

  ranks.forEach((row, rankFromTop) => {
    const rank = 7 - rankFromTop;
    let file = 0;
    for (const ch of row) {
      if (ch >= "1" && ch <= "8") {
        file += Number(ch);
        continue;
      }
      const type = ch.toLowerCase();
      if (PIECE_GLYPHS[type]) {
        pieces.set(squareName(file, rank), { type, color: ch === ch.toUpperCase() ? "w" : "b" });
      }
      file += 1;
    }
  });

  return pieces;
}

export function pieceGlyph(type: string): string {
  return PIECE_GLYPHS[type.toLowerCase()] ?? "";
}

export function pieceName(type: string): string {
  return PIECE_NAMES[type.toLowerCase()] ?? "piece";
}

export function squareLabel(square: string, piece?: PlacedPiece): string {
  if (!piece) return `${square}, empty`;
  return `${square}, ${piece.color === "w" ? "white" : "black"} ${pieceName(piece.type)}`;
}
