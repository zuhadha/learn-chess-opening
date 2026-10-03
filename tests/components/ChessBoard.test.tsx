// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChessBoard } from "@/components/chess/ChessBoard";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** jsdom reports zero-size boxes; give the board a real 400x400 geometry. */
function mockBoardGeometry() {
  Element.prototype.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 400,
      height: 400,
      right: 400,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

/** Centre of a square in client coordinates, for a White-oriented board. */
function pointOf(square: string): { clientX: number; clientY: number } {
  const file = square.charCodeAt(0) - "a".charCodeAt(0);
  const rank = Number(square[1]) - 1;
  return { clientX: file * 50 + 25, clientY: (7 - rank) * 50 + 25 };
}

beforeEach(() => {
  mockBoardGeometry();
});

// Vitest runs with `globals: false`, so React Testing Library cannot register
// its own auto-cleanup; unmount explicitly or labels accumulate across tests.
afterEach(() => {
  cleanup();
});

describe("ChessBoard rendering", () => {
  it("draws all 32 pieces from a FEN", () => {
    render(<ChessBoard fen={START} orientation="w" />);
    expect(screen.getByLabelText("e1, white king")).toBeTruthy();
    expect(screen.getByLabelText("d8, black queen")).toBeTruthy();
    expect(screen.getByLabelText("e4, empty")).toBeTruthy();
  });

  it("flips the board for Black", () => {
    const { container } = render(<ChessBoard fen={START} orientation="b" />);
    const squares = container.querySelectorAll("button");
    // The first rendered square is the top-left one: h1 when Black is at the bottom.
    expect(squares[0]?.getAttribute("aria-label")).toBe("h1, white rook");
  });

  it("is inert when not interactive", () => {
    const onMove = vi.fn();
    render(<ChessBoard fen={START} orientation="w" interactive={false} onMove={onMove} />);
    fireEvent.click(screen.getByLabelText("e2, white pawn"));
    fireEvent.click(screen.getByLabelText("e4, empty"));
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe("ChessBoard move input", () => {
  it("plays a move with two clicks", () => {
    const onMove = vi.fn();
    render(<ChessBoard fen={START} orientation="w" onMove={onMove} />);
    fireEvent.click(screen.getByLabelText("e2, white pawn"));
    fireEvent.click(screen.getByLabelText("e4, empty"));
    expect(onMove).toHaveBeenCalledWith("e2e4", "e4");
  });

  it("plays a move with a drag", () => {
    const onMove = vi.fn();
    render(<ChessBoard fen={START} orientation="w" onMove={onMove} />);
    const source = screen.getByLabelText("d2, white pawn");

    // Pointer capture routes the move/up events through the grabbed square, so
    // dispatch them there and let them bubble to the board.
    fireEvent.pointerDown(source, pointOf("d2"));
    fireEvent.pointerMove(source, { clientX: 100, clientY: 200 });
    fireEvent.pointerUp(source, pointOf("d4"));

    expect(onMove).toHaveBeenCalledWith("d2d4", "d4");
  });

  it("ignores a drag that lands on an illegal square", () => {
    const onMove = vi.fn();
    render(<ChessBoard fen={START} orientation="w" onMove={onMove} />);
    const source = screen.getByLabelText("e2, white pawn");
    fireEvent.pointerDown(source, pointOf("e2"));
    fireEvent.pointerMove(source, { clientX: 100, clientY: 200 });
    fireEvent.pointerUp(source, pointOf("e5"));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("refuses to move the opponent's pieces", () => {
    const onMove = vi.fn();
    render(<ChessBoard fen={START} orientation="w" onMove={onMove} />);
    fireEvent.click(screen.getByLabelText("e7, black pawn"));
    fireEvent.click(screen.getByLabelText("e5, empty"));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("asks before promoting", () => {
    const onMove = vi.fn();
    render(<ChessBoard fen="8/P6k/8/8/8/8/7K/8 w - - 0 1" orientation="w" onMove={onMove} />);
    fireEvent.click(screen.getByLabelText("a7, white pawn"));
    fireEvent.click(screen.getByLabelText("a8, empty"));

    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Promote to queen")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Promote to knight"));
    expect(onMove).toHaveBeenCalledWith("a7a8n", "a8=N");
  });

  it("survives a zero-size board instead of emitting a nonsense square", () => {
    Element.prototype.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const onMove = vi.fn();
    render(<ChessBoard fen={START} orientation="w" onMove={onMove} />);
    const source = screen.getByLabelText("e2, white pawn");
    fireEvent.pointerDown(source, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(source, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(source, { clientX: 999, clientY: 999 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("announces position changes for screen readers", () => {
    render(<ChessBoard fen={START} orientation="w" announcement="White played e4" />);
    expect(screen.getByText("White played e4")).toBeTruthy();
  });
});
