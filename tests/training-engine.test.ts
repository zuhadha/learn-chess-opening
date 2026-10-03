import { describe, expect, it } from "vitest";

import { TreeIndex, buildCourseTree, toTreeDto } from "@/lib/chess/tree";
import {
  applyJudgement,
  currentDecision,
  hintFor,
  judgeMove,
  startLine,
} from "@/lib/chess/training-engine";
import type { CourseSpec } from "@/lib/content/types";

const spec: CourseSpec = {
  slug: "judge-test",
  name: "Judge Test",
  description: "",
  side: "black",
  authorName: "Tests",
  lines: [
    {
      id: "main",
      name: "Main",
      description: "",
      moves: [
        { san: "e4" },
        { san: "c6", explanation: "Support d5." },
        { san: "d4" },
        { san: "d5", explanation: "Challenge the centre." },
        { san: "exd5", frequency: 0.3 },
        { san: "cxd5", explanation: "Recapture toward the centre." },
      ],
    },
  ],
};

const built = buildCourseTree(spec, "course:judge-test");
const tree = new TreeIndex(toTreeDto(built));
const lineId = built.lines[0]!.id;
const firstDecision = tree.decisions(lineId)[0]!;

function judge(move: string, mode: "learn" | "practice" = "learn") {
  return judgeMove({
    tree,
    positionId: firstDecision.positionId,
    move,
    learnerSide: tree.playerSide,
    mode,
  });
}

describe("judgeMove — chess correctness vs training correctness (PRD §93)", () => {
  it("accepts the repertoire move", () => {
    const result = judge("c6");
    expect(result.status).toBe("correct");
    expect(result.legal).toBe(true);
    expect(result.playedUci).toBe("c7c6");
    expect(result.expected?.san).toBe("c6");
  });

  it("accepts UCI input as well as SAN", () => {
    expect(judge("c7c6").status).toBe("correct");
    expect(judge("C7C6").status).toBe("correct");
  });

  it("marks a legal-but-off-repertoire move as incorrect, not illegal", () => {
    const result = judge("e5");
    expect(result.status).toBe("incorrect");
    expect(result.legal).toBe(true);
    expect(result.expected?.san).toBe("c6");
  });

  it("marks an impossible move as illegal", () => {
    const result = judge("Ke7");
    expect(result.status).toBe("illegal");
    expect(result.legal).toBe(false);
    expect(result.playedUci).toBeNull();
    expect(result.legalSan?.length).toBeGreaterThan(0);
  });

  it("rejects the opponent's move as an answer", () => {
    // It is Black to move; a White move cannot be played here.
    expect(judge("Nf3").status).toBe("illegal");
  });

  it("gives anti-frustration phrasing rather than FAILED (PRD §87)", () => {
    expect(judge("e5").feedback).toContain("Not quite");
    expect(judge("e5").feedback).toContain("c6");
    expect(judge("e5").feedback.toLowerCase()).not.toContain("failed");
  });

  it("explains in Learn mode but stays quiet in Practice mode (PRD §16)", () => {
    expect(judge("c6", "learn").feedback).toContain("Support d5.");
    expect(judge("c6", "practice").feedback).toBe("c6 — correct.");
  });

  it("normalises castling notation", () => {
    const castlingSpec: CourseSpec = {
      ...spec,
      slug: "castling",
      lines: [
        {
          id: "castle",
          name: "Castle",
          description: "",
          moves: [
            { san: "e4" },
            { san: "c6", explanation: "x" },
            { san: "Nf3" },
            { san: "d5", explanation: "x" },
            { san: "Bc4" },
            { san: "Nf6", explanation: "x" },
            { san: "d3" },
            { san: "e6", explanation: "x" },
            { san: "O-O" },
            { san: "Be7", explanation: "x" },
            { san: "Re1" },
            { san: "O-O", explanation: "Castle and finish development." },
          ],
        },
      ],
    };
    const castlingBuilt = buildCourseTree(castlingSpec, "course:castling");
    expect(castlingBuilt.errors).toEqual([]);
    const castlingTree = new TreeIndex(toTreeDto(castlingBuilt));
    const decision = castlingTree.decisions(castlingBuilt.lines[0]!.id).at(-1)!;
    expect(decision.move.uci).toBe("e8g8");
    for (const notation of ["O-O", "0-0", "o-o", "e8g8"]) {
      expect(
        judgeMove({
          tree: castlingTree,
          positionId: decision.positionId,
          move: notation,
          learnerSide: castlingTree.playerSide,
        }).status,
      ).toBe("correct");
    }
  });
});

/** Walk the line, judging each SAN at whatever decision the walker is on. */
function playLine(sans: string[]) {
  let state = startLine(tree, lineId);
  for (const san of sans) {
    const decision = currentDecision(tree, state)!;
    state = applyJudgement(
      tree,
      state,
      judgeMove({
        tree,
        positionId: decision.positionId,
        move: san,
        learnerSide: tree.playerSide,
      }),
    );
  }
  return state;
}

describe("the line walker", () => {
  it("starts at the first learner decision", () => {
    const state = startLine(tree, lineId);
    expect(state.status).toBe("playing");
    expect(state.positionId).toBe(firstDecision.positionId);
    expect(currentDecision(tree, state)?.move.san).toBe("c6");
  });

  it("does not advance on a wrong answer (PRD §87: explain and retry)", () => {
    const state = startLine(tree, lineId);
    const next = applyJudgement(tree, state, judge("e5"));
    expect(next.positionId).toBe(state.positionId);
    expect(next.mistakes).toBe(1);
    expect(next.playerMovesTaken).toBe(0);
  });

  it("advances and auto-plays the opponent reply on a correct answer", () => {
    const state = startLine(tree, lineId);
    const next = applyJudgement(tree, state, judge("c6"));
    expect(next.playerMovesTaken).toBe(1);
    // The learner's c6 and White's d4 have both been played.
    expect(next.sanHistory.map((m) => m.san)).toEqual(["e4", "c6", "d4"]);
    expect(currentDecision(tree, next)?.move.san).toBe("d5");
  });

  it("completes the line after the last decision", () => {
    const state = playLine(["c6", "d5", "cxd5"]);
    expect(state.status).toBe("complete");
    expect(state.playerMovesTaken).toBe(3);
    expect(currentDecision(tree, state)).toBeNull();
  });

  it("records hint usage separately from correctness", () => {
    const state = startLine(tree, lineId);
    const next = applyJudgement(tree, state, judge("c6"), { hintUsed: true });
    expect(next.hintsUsed).toBe(1);
    expect(next.playerMovesTaken).toBe(1);
  });

  it("exposes a hint for the current decision", () => {
    const state = startLine(tree, lineId);
    expect(hintFor(tree, state)).toEqual({ san: "c6", explanation: "Support d5." });
  });

  it("returns no hint once the line is complete", () => {
    expect(hintFor(tree, playLine(["c6", "d5", "cxd5"]))).toBeNull();
  });
});
