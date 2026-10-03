/**
 * Deterministic Zobrist hashing (PRD §13, §38).
 *
 * Two positions that are genuinely identical — same pieces, same side to move,
 * same castling rights, same en-passant file — hash to the same value even when
 * they are reached by a different move order. That is what lets the content
 * pipeline deduplicate transpositions when it writes `positions`.
 *
 * The random tables are generated from a fixed seed with SplitMix64 so the hash
 * is stable across processes, machines and deployments. Never regenerate these
 * tables: stored hashes would become meaningless.
 */

const MASK64 = 0xffffffffffffffffn;

const PIECE_INDEX: Record<string, number> = {
  p: 0,
  n: 1,
  b: 2,
  r: 3,
  q: 4,
  k: 5,
};

/** SplitMix64 — small, fast, and good enough for hashing. */
function createSplitMix64(seed: bigint): () => bigint {
  let state = seed & MASK64;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK64;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return (z ^ (z >> 31n)) & MASK64;
  };
}

const SEED = 0x2545f4914f6cdd1dn;

function buildTables() {
  const next = createSplitMix64(SEED);
  // 2 colours x 6 piece types x 64 squares
  const pieces: bigint[] = new Array(12 * 64);
  for (let i = 0; i < 12 * 64; i += 1) pieces[i] = next();
  const castling = [next(), next(), next(), next()];
  const enPassantFile: bigint[] = new Array(8);
  for (let i = 0; i < 8; i += 1) enPassantFile[i] = next();
  return { pieces, castling, enPassantFile, sideToMove: next() };
}

const TABLES = buildTables();

const CASTLING_ORDER = ["K", "Q", "k", "q"] as const;

function pieceTableIndex(piece: string, squareIndex: number): number {
  const color = piece === piece.toUpperCase() ? 0 : 6;
  const idx = PIECE_INDEX[piece.toLowerCase()];
  if (idx === undefined) {
    throw new Error(`zobrist: unknown piece "${piece}"`);
  }
  return (color + idx) * 64 + squareIndex;
}

/**
 * Compute the Zobrist hash of a FEN.
 *
 * Returns a zero-padded 16-character hex string so it can live in a TEXT column
 * and be compared/indexed cheaply.
 */
export function zobristHash(fen: string): string {
  const parts = fen.trim().split(/\s+/);
  const board = parts[0];
  const sideToMove = parts[1] ?? "w";
  const castling = parts[2] ?? "-";
  const enPassant = parts[3] ?? "-";

  if (!board) {
    throw new Error(`zobrist: cannot parse FEN "${fen}"`);
  }

  let hash = 0n;
  const ranks = board.split("/");
  if (ranks.length !== 8) {
    throw new Error(`zobrist: FEN board must have 8 ranks, got "${board}"`);
  }

  for (let rank = 0; rank < 8; rank += 1) {
    const row = ranks[rank];
    if (!row) continue;
    let file = 0;
    for (const ch of row) {
      if (ch >= "1" && ch <= "8") {
        file += Number(ch);
        continue;
      }
      if (!/[pnbrqk]/i.test(ch)) {
        throw new Error(`zobrist: illegal board character "${ch}" in "${fen}"`);
      }
      // Square 0 = a8, matching FEN's rank order.
      const squareIndex = rank * 8 + file;
      hash ^= TABLES.pieces[pieceTableIndex(ch, squareIndex)] ?? 0n;
      file += 1;
    }
    if (file !== 8) {
      throw new Error(`zobrist: rank ${8 - rank} has ${file} squares in "${fen}"`);
    }
  }

  if (sideToMove === "b") hash ^= TABLES.sideToMove;

  if (castling !== "-") {
    CASTLING_ORDER.forEach((right, i) => {
      if (castling.includes(right)) hash ^= TABLES.castling[i] ?? 0n;
    });
  }

  if (enPassant !== "-") {
    const file = enPassant.charCodeAt(0) - "a".charCodeAt(0);
    if (file >= 0 && file < 8) hash ^= TABLES.enPassantFile[file] ?? 0n;
  }

  return hash.toString(16).padStart(16, "0");
}
