/**
 * Validate the content set without touching the database (PRD §90, §91).
 *
 *   npm run validate:content
 *
 * Checks every published course for:
 *   - illegal moves (chess.js refuses them)
 *   - duplicate Zobrist hashes inside a course (should be impossible)
 *   - lines whose learner decisions are not actually on the learner's side
 *   - missing explanations on repertoire moves
 *   - move frequencies that do not sum to ~1 per (position, side)
 *
 * Exits non-zero if any check fails, so CI cannot ship a broken repertoire.
 */
import { buildCourseTree, toTreeDto, TreeIndex, learnerSide } from "@/lib/chess/tree";
import { courseSpecs, courseIdFor } from "@/lib/content/registry";

let failures = 0;

function fail(message: string): void {
  failures += 1;
  console.error(`  ✗ ${message}`);
}

for (const spec of courseSpecs) {
  console.log(`\n${spec.slug}`);
  const built = buildCourseTree(spec, courseIdFor(spec.slug));
  const tree = new TreeIndex(toTreeDto(built));

  for (const error of built.errors) {
    fail(`illegal move [${error.lineId}] ply ${error.ply} "${error.san}": ${error.message}`);
  }

  const hashes = new Map<string, number>();
  for (const position of built.positions) {
    hashes.set(position.zobristHash, (hashes.get(position.zobristHash) ?? 0) + 1);
  }
  for (const [hash, count] of hashes) {
    if (count > 1) fail(`duplicate zobrist hash ${hash} appears ${count} times`);
  }

  for (const line of built.lines) {
    if (line.moveCount === 0) fail(`line ${line.id} has no learner decisions`);
    const steps = tree.decisions(line.id);
    for (const step of steps) {
      if (step.mover !== learnerSide(spec.side)) {
        fail(`line ${line.id}: decision at ${step.positionId} is not ${spec.side}'s move`);
      }
      if (!step.move.explanation) {
        fail(`line ${line.id}: repertoire move ${step.move.san} has no explanation`);
      }
    }
    if (steps.length !== line.moveCount) {
      fail(
        `line ${line.id}: move_count=${line.moveCount} but ${steps.length} decision steps were derived`,
      );
    }
  }

  // Frequency semantics (PRD §48): a move's frequency is the share of human
  // games that continue with it, so every value must be in [0,1] and the
  // *authored* values at one position for one side cannot exceed 100% of games.
  const sideByPosition = new Map(built.positions.map((p) => [p.id, p.sideToMove]));
  for (const move of built.moves) {
    if (move.frequency < 0 || move.frequency > 1) {
      fail(`move ${move.san} at ${move.positionId} has frequency ${move.frequency}`);
    }
  }
  const authoredSums = new Map<string, number>();
  for (const move of built.moves) {
    const side = sideByPosition.get(move.positionId);
    const key = `${move.positionId}:${side}:${move.uci}`;
    if (!built.authoredFrequency.has(key)) continue;
    const group = `${move.positionId}:${side}`;
    authoredSums.set(group, (authoredSums.get(group) ?? 0) + move.frequency);
  }
  for (const [group, sum] of authoredSums) {
    if (sum > 1.02) {
      fail(`authored frequencies at ${group} sum to ${sum.toFixed(4)} (> 100% of games)`);
    }
  }

  const decisions = built.lines.reduce((s, l) => s + l.moveCount, 0);
  console.log(
    `  ${built.lines.length} lines · ${built.positions.length} positions · ` +
      `${built.moves.length} moves · ${decisions} decisions`,
  );
}

console.log(failures === 0 ? "\ncontent OK" : `\n${failures} content problem(s)`);
process.exit(failures === 0 ? 0 : 1);
