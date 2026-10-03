import { describe, expect, it } from "vitest";

import { zobristHash } from "@/lib/chess/zobrist";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("zobristHash", () => {
  it("is deterministic across calls", () => {
    expect(zobristHash(START)).toBe(zobristHash(START));
  });

  it("returns a 16-character zero-padded hex string", () => {
    const hash = zobristHash(START);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("gives transpositions the same hash", () => {
    // 1.e4 c6 2.d4 d5  vs  1.d4 c6 2.e4 d5 — same position, different move order.
    const viaE4 = "rnbqkbnr/pp2pppp/2p5/3p4/3PP3/8/PPP2PPP/RNBQKBNR w KQkq - 0 3";
    const viaD4 = "rnbqkbnr/pp2pppp/2p5/3p4/3PP3/8/PPP2PPP/RNBQKBNR w KQkq - 0 3";
    expect(zobristHash(viaE4)).toBe(zobristHash(viaD4));
  });

  it("distinguishes side to move", () => {
    const white = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
    const black = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e3 0 2";
    expect(zobristHash(white)).not.toBe(zobristHash(black));
  });

  it("distinguishes castling rights", () => {
    const withRights = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    const without = "r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1";
    expect(zobristHash(withRights)).not.toBe(zobristHash(without));
  });

  it("distinguishes the en-passant file", () => {
    const epE = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2";
    const epD = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2";
    expect(zobristHash(epE)).not.toBe(zobristHash(epD));
  });

  it("ignores halfmove and fullmove counters", () => {
    expect(zobristHash("8/8/8/3k4/3K4/8/8/8 w - - 0 1")).toBe(
      zobristHash("8/8/8/3k4/3K4/8/8/8 w - - 42 99"),
    );
  });

  it("rejects malformed FENs instead of hashing garbage", () => {
    expect(() => zobristHash("nonsense")).toThrow();
    expect(() => zobristHash("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1")).toThrow();
    expect(() => zobristHash("rnbqkbnr/pppppppp/8/8/8/8/PPPPXPPP/RNBQKBNR w KQkq - 0 1")).toThrow();
  });
});
