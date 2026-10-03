import clsx from "clsx";

import {
  displaySquares,
  isLightSquare,
  pieceGlyph,
  piecesFromFen,
  squareLabel,
} from "@/lib/chess/board-utils";
import type { Side } from "@/lib/types";

/**
 * A board that only draws. No chess.js, no event handlers — used for course
 * previews and marketing so those bundles stay small (PRD §44).
 */
export function StaticBoard({
  fen,
  orientation = "w",
  className,
  lastMove,
}: {
  fen: string;
  orientation?: Side;
  className?: string;
  lastMove?: { from: string; to: string } | null;
}) {
  const pieces = piecesFromFen(fen);
  const squares = displaySquares(orientation);

  return (
    <div
      className={clsx(
        "grid aspect-square w-full grid-cols-8 overflow-hidden rounded-md ring-1 ring-ink-900/10",
        className,
      )}
      role="img"
      aria-label={`Chess position: ${fen}`}
    >
      {squares.map((square) => {
        const piece = pieces.get(square);
        const highlighted = lastMove?.from === square || lastMove?.to === square;
        return (
          <div
            key={square}
            className={clsx(
              "board-square",
              isLightSquare(square) ? "bg-board-light" : "bg-board-dark",
              highlighted && "ring-2 ring-inset ring-amber-400/80",
            )}
          >
            {piece ? (
              <span
                aria-hidden
                className={clsx(
                  "piece text-[min(9vw,2.4rem)] leading-none",
                  piece.color === "w" ? "piece-light" : "piece-dark",
                )}
              >
                {pieceGlyph(piece.type)}
              </span>
            ) : null}
            <span className="sr-only">{squareLabel(square, piece)}</span>
          </div>
        );
      })}
    </div>
  );
}
