"use client";

import { Chess } from "chess.js";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  displaySquares,
  isLightSquare,
  pieceGlyph,
  pieceName,
  piecesFromFen,
  squareLabel,
} from "@/lib/chess/board-utils";
import type { Side } from "@/lib/types";

export interface ChessBoardProps {
  fen: string;
  /** Which colour sits at the bottom. */
  orientation: Side;
  /** Called with a legal UCI move the learner produced. */
  onMove?: (uci: string, san: string) => void;
  /** Read-only board (analysis/replay). */
  interactive?: boolean;
  lastMove?: { from: string; to: string } | null;
  /** Hint highlight — the destination square of the repertoire move. */
  hintSquare?: string | null;
  /** Ring the board after a graded attempt. Never colour-only: text accompanies it. */
  tone?: "idle" | "correct" | "incorrect";
  /** Text announced to screen readers when the position changes. */
  announcement?: string;
  className?: string;
  ariaLabel?: string;
}

type VerboseMove = ReturnType<Chess["moves"]> extends (infer T)[] ? T : never;

const PROMOTION_CHOICES = ["q", "r", "b", "n"] as const;

interface DragState {
  from: string;
  x: number;
  y: number;
  /** Captured at pointerdown so the dragged piece is positioned correctly. */
  boardRect: { left: number; top: number; width: number; height: number };
}

/**
 * The interactive board (PRD §26, §40).
 *
 * Everything here is local: legality comes from chess.js in the browser, so
 * dragging a piece never produces a network request. Correctness is a separate
 * question, answered by the training engine (PRD §93).
 *
 * Supports drag-to-move, tap-then-tap (touch and mouse), and keyboard
 * activation, because a training tool that needs a mouse is not a training tool.
 */
export function ChessBoard({
  fen,
  orientation,
  onMove,
  interactive = true,
  lastMove,
  hintSquare,
  tone = "idle",
  announcement,
  className,
  ariaLabel = "Chess board",
}: ChessBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverSquare, setHoverSquare] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const pressRef = useRef<{ square: string; moved: boolean } | null>(null);

  const game = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return null;
    }
  }, [fen]);

  const pieces = useMemo(() => piecesFromFen(fen), [fen]);
  const squares = useMemo(() => displaySquares(orientation), [orientation]);
  const sideToMove = game?.turn() ?? "w";

  const legalMoves = useMemo<VerboseMove[]>(() => {
    if (!game) return [];
    try {
      return game.moves({ verbose: true }) as VerboseMove[];
    } catch {
      return [];
    }
  }, [game]);

  const targetsByFrom = useMemo(() => {
    const map = new Map<string, VerboseMove[]>();
    for (const move of legalMoves) {
      const bucket = map.get(move.from);
      if (bucket) bucket.push(move);
      else map.set(move.from, [move]);
    }
    return map;
  }, [legalMoves]);

  // Reset transient state when the position changes underneath us. Done during
  // render (React's "adjust state when a prop changes" pattern) rather than in
  // an effect, so the board never paints a stale selection.
  const [renderedFen, setRenderedFen] = useState(fen);
  if (renderedFen !== fen) {
    setRenderedFen(fen);
    setSelected(null);
    setDrag(null);
    setHoverSquare(null);
  }

  const squareFromPoint = useCallback(
    (clientX: number, clientY: number, rect: DragState["boardRect"]): string | null => {
      if (rect.width <= 0 || rect.height <= 0) return null;
      const col = Math.floor(((clientX - rect.left) / rect.width) * 8);
      const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
      if (!Number.isInteger(col) || !Number.isInteger(row)) return null;
      if (col < 0 || col > 7 || row < 0 || row > 7) return null;
      const file = orientation === "w" ? col : 7 - col;
      const rank = orientation === "w" ? 7 - row : row;
      return `${"abcdefgh"[file]}${rank + 1}`;
    },
    [orientation],
  );

  const emitMove = (from: string, to: string, promotionPiece?: string) => {
      if (!onMove) return;
      const candidates = legalMoves.filter((m) => m.from === from && m.to === to);
      if (candidates.length === 0) return;

      const needsPromotion = candidates.some((m) => m.promotion);
      if (needsPromotion && !promotionPiece) {
        setPromotion({ from, to });
        return;
      }
      const move = candidates.find((m) => m.promotion === promotionPiece) ?? candidates[0];
      if (!move) return;
      onMove(`${move.from}${move.to}${move.promotion ?? ""}`, move.san);
  };

  const isLegalTarget = useCallback(
    (from: string | null, to: string): boolean =>
      from !== null && (targetsByFrom.get(from)?.some((m) => m.to === to) ?? false),
    [targetsByFrom],
  );

  const grabbable = useCallback(
    (square: string): boolean => {
      if (!interactive || !game) return false;
      const piece = pieces.get(square);
      return piece?.color === sideToMove && (targetsByFrom.get(square)?.length ?? 0) > 0;
    },
    [game, interactive, pieces, sideToMove, targetsByFrom],
  );

  const currentRect = (): DragState["boardRect"] | null => {
    const board = boardRef.current;
    if (!board) return null;
    const rect = board.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  };

  const onPointerDown = (event: React.PointerEvent, square: string) => {
    if (!interactive || !game) return;

    if (!grabbable(square)) {
      // Tap-to-move: a second tap on a legal destination completes the move.
      if (isLegalTarget(selected, square)) {
        emitMove(selected as string, square);
        setSelected(null);
        return;
      }
      setSelected(null);
      return;
    }

    const rect = currentRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pressRef.current = { square, moved: false };
    setSelected(square);
    setDrag({ from: square, x: event.clientX, y: event.clientY, boardRect: rect });
    setHoverSquare(square);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const current = drag;
    if (!current) return;
    if (
      Math.abs(event.clientX - current.x) > 2 ||
      Math.abs(event.clientY - current.y) > 2
    ) {
      if (pressRef.current) pressRef.current.moved = true;
    }
    setDrag({ ...current, x: event.clientX, y: event.clientY });
    setHoverSquare(squareFromPoint(event.clientX, event.clientY, current.boardRect));
  };

  const endDrag = (event?: React.PointerEvent) => {
    const press = pressRef.current;
    const current = drag;
    pressRef.current = null;
    setDrag(null);
    setHoverSquare(null);
    if (!press || !current || !interactive || !event) return;

    if (!press.moved) return; // a tap: handled by onPointerDown of the next square

    const target = squareFromPoint(event.clientX, event.clientY, current.boardRect);
    if (target && target !== press.square && isLegalTarget(press.square, target)) {
      emitMove(press.square, target);
      setSelected(null);
    }
    // A drag that lands nowhere legal is simply cancelled — never a punishment.
  };

  const onClick = (event: React.MouseEvent, square: string) => {
    // Pointer input already handled this. Only react to keyboard activation
    // (Enter/Space), which produces a click with detail === 0.
    if (event.detail !== 0) return;
    if (!interactive || !game) return;
    if (isLegalTarget(selected, square) && selected !== square) {
      emitMove(selected as string, square);
      setSelected(null);
      return;
    }
    setSelected(grabbable(square) ? square : null);
  };

  const targetSquares = new Set<string>(
    selected ? (targetsByFrom.get(selected) ?? []).map((m) => m.to) : [],
  );

  return (
    <div className={clsx("relative select-none", className)}>
      <div
        ref={boardRef}
        role="group"
        aria-label={ariaLabel}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={() => endDrag()}
        className={clsx(
          "grid aspect-square w-full grid-cols-8 touch-none overflow-hidden rounded-md ring-1 transition-shadow",
          tone === "correct"
            ? "ring-4 ring-emerald-500"
            : tone === "incorrect"
              ? "ring-4 ring-rose-400"
              : "ring-ink-900/15",
        )}
      >
        {squares.map((square, index) => {
          const piece = pieces.get(square);
          const isTarget = targetSquares.has(square);
          const isSelected = selected === square;
          const isLast = lastMove?.from === square || lastMove?.to === square;
          const isHover = drag !== null && hoverSquare === square;
          const showRank = index % 8 === 0;
          const showFile = index >= 56;

          return (
            <button
              key={square}
              type="button"
              disabled={!interactive}
              aria-label={squareLabel(square, piece)}
              aria-pressed={isSelected}
              onPointerDown={(event) => onPointerDown(event, square)}
              onClick={(event) => onClick(event, square)}
              className={clsx(
                "board-square cursor-pointer disabled:cursor-default",
                isLightSquare(square) ? "bg-board-light" : "bg-board-dark",
                isLast && "bg-amber-300/70",
                isSelected && "bg-emerald-400/80",
                isHover && "bg-emerald-300/70",
              )}
            >
              {showRank ? (
                <span
                  aria-hidden
                  className={clsx(
                    "pointer-events-none absolute left-0.5 top-0.5 text-[0.6rem] font-bold",
                    isLightSquare(square) ? "text-board-dark/80" : "text-board-light/80",
                  )}
                >
                  {square[1]}
                </span>
              ) : null}
              {showFile ? (
                <span
                  aria-hidden
                  className={clsx(
                    "pointer-events-none absolute bottom-0 right-0.5 text-[0.6rem] font-bold",
                    isLightSquare(square) ? "text-board-dark/80" : "text-board-light/80",
                  )}
                >
                  {square[0]}
                </span>
              ) : null}

              {piece && drag?.from !== square ? (
                <span
                  aria-hidden
                  className={clsx(
                    "piece text-[min(10.5vw,3.1rem)]",
                    piece.color === "w" ? "piece-light" : "piece-dark",
                  )}
                >
                  {pieceGlyph(piece.type)}
                </span>
              ) : null}

              {isTarget && !piece ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute h-1/3 w-1/3 rounded-full bg-ink-900/25"
                />
              ) : null}
              {isTarget && piece ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 ring-4 ring-inset ring-ink-900/30"
                />
              ) : null}

              {hintSquare === square ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-1 rounded-full ring-4 ring-sky-400"
                />
              ) : null}
            </button>
          );
        })}

        {drag ? (
          <DraggedPiece fen={fen} from={drag.from} drag={drag} />
        ) : null}
      </div>

      {promotion ? (
        <PromotionDialog
          color={sideToMove}
          onCancel={() => setPromotion(null)}
          onChoose={(piece) => {
            emitMove(promotion.from, promotion.to, piece);
            setPromotion(null);
            setSelected(null);
          }}
        />
      ) : null}

      {announcement ? (
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      ) : null}
    </div>
  );
}

function DraggedPiece({ fen, from, drag }: { fen: string; from: string; drag: DragState }) {
  const piece = piecesFromFen(fen).get(from);
  if (!piece) return null;
  const squareSize = drag.boardRect.width / 8;
  return (
    <span
      aria-hidden
      className={clsx(
        "piece pointer-events-none absolute z-10 flex items-center justify-center text-[min(10.5vw,3.1rem)]",
        piece.color === "w" ? "piece-light" : "piece-dark",
      )}
      style={{
        left: drag.x - drag.boardRect.left - squareSize / 2,
        top: drag.y - drag.boardRect.top - squareSize / 2,
        width: squareSize,
        height: squareSize,
      }}
    >
      {pieceGlyph(piece.type)}
    </span>
  );
}

function PromotionDialog({
  color,
  onChoose,
  onCancel,
}: {
  color: Side;
  onChoose: (piece: string) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose a promotion piece"
      className="absolute inset-0 z-20 flex items-center justify-center rounded-md bg-ink-900/60"
    >
      <div className="flex gap-2 rounded-lg bg-white p-3 shadow-lg">
        {PROMOTION_CHOICES.map((piece) => (
          <button
            key={piece}
            type="button"
            onClick={() => onChoose(piece)}
            aria-label={`Promote to ${pieceName(piece)}`}
            className="flex h-14 w-14 items-center justify-center rounded-md bg-ink-100 text-3xl hover:bg-emerald-100"
          >
            <span aria-hidden className={clsx("piece", color === "w" ? "piece-light" : "piece-dark")}>
              {pieceGlyph(piece)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
