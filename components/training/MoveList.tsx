import clsx from "clsx";

import { plyLabel } from "@/lib/chess/uci";
import type { Side } from "@/lib/types";

export interface MoveListEntry {
  ply: number;
  side: Side;
  san: string;
}

/**
 * The moves played so far in the current line.
 *
 * Rendered as a real list with text — no colour-only state — so it stays usable
 * with a screen reader (PRD §64).
 */
export function MoveList({
  moves,
  pendingSide,
  className,
}: {
  moves: MoveListEntry[];
  pendingSide: Side | null;
  className?: string;
}) {
  return (
    <div className={clsx("rounded-lg border border-ink-200 bg-ink-50 p-3", className)}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
        Moves
      </h3>
      {moves.length === 0 ? (
        <p className="text-sm text-ink-400">
          {pendingSide === "b"
            ? "White to play the first move."
            : "Play the first move of the line."}
        </p>
      ) : (
        <ol className="flex flex-wrap gap-x-1 gap-y-1 font-mono text-sm">
          {moves.map((move, i) => (
            <li key={`${move.ply}-${move.side}-${i}`} className="flex items-baseline gap-0.5">
              <span className="text-ink-400">{plyLabel(move.ply, move.side)}</span>
              <span className="font-semibold text-ink-800">{move.san}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
