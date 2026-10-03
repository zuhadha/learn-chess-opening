import { describe, expect, it } from "vitest";

import {
  DEFAULT_MOVE_FREQUENCY,
  TreeIndex,
  buildCourseTree,
  estimateMinutes,
  toTreeDto,
} from "@/lib/chess/tree";
import type { CourseSpec } from "@/lib/content/types";

const spec: CourseSpec = {
  slug: "test-open",
  name: "Test Opening",
  description: "Two lines that share a prefix, plus one deviation.",
  side: "black",
  authorName: "Tests",
  lines: [
    {
      id: "main",
      name: "Main line",
      description: "The main line.",
      moves: [
        { san: "e4" },
        { san: "c6", explanation: "Support d5.", frequency: 0.12 },
        { san: "d4" },
        { san: "d5", explanation: "Challenge the centre." },
        { san: "e5", explanation: "White takes space.", frequency: 0.4 },
        { san: "Bf5", explanation: "Bishop out first." },
      ],
    },
    {
      id: "sideline",
      name: "Sideline",
      description: "Shares the first four plies with the main line.",
      moves: [
        { san: "e4" },
        { san: "c6", explanation: "Support d5." },
        { san: "d4" },
        { san: "d5", explanation: "Challenge the centre." },
        { san: "Nc3", explanation: "White develops.", frequency: 0.35 },
        { san: "dxe4", explanation: "Simplify." },
        { san: "Nxe4" },
        { san: "Bf5", explanation: "Bishop out first." },
      ],
    },
  ],
};

const built = buildCourseTree(spec, "course:test-open");
const tree = new TreeIndex(toTreeDto(built));

describe("buildCourseTree", () => {
  it("reports no errors for a legal spec", () => {
    expect(built.errors).toEqual([]);
  });

  it("collapses shared prefixes onto one node", () => {
    // 6 + 8 = 14 plies, but the first 4 are shared, plus the start position.
    expect(built.positions.length).toBe(1 + 14 - 4);
  });

  it("marks only learner moves as decisions", () => {
    const main = built.lines.find((l) => l.id.endsWith(":main"))!;
    // e4 c6 d4 d5 e5 Bf5 -> Black plays c6, d5, Bf5.
    expect(main.moveCount).toBe(3);
    expect(main.plyCount).toBe(6);
    const decisions = tree.decisions(main.id);
    expect(decisions.map((d) => d.move.san)).toEqual(["c6", "d5", "Bf5"]);
    expect(decisions.every((d) => d.mover === "b")).toBe(true);
  });

  it("keeps authored frequency as a share of human games, not renormalised", () => {
    // 1...c6 is played from the position after 1.e4, not from the root.
    const afterE4 = tree.steps(built.lines[0]!.id)[0]!.nextPositionId;
    expect(tree.moveByUci(afterE4, "c7c6")!.frequency).toBe(0.12);
  });

  it("uses the neutral prior when the author supplied no frequency", () => {
    expect(tree.moveByUci(tree.root.id, "e2e4")!.frequency).toBe(DEFAULT_MOVE_FREQUENCY);
  });

  it("records which frequencies were authored", () => {
    const authored = [...built.authoredFrequency];
    expect(authored.some((key) => key.endsWith(":c7c6"))).toBe(true);
    expect(authored.some((key) => key.endsWith(":e2e4"))).toBe(false);
  });

  it("collects illegal moves as errors instead of throwing", () => {
    const broken = buildCourseTree(
      {
        ...spec,
        slug: "broken",
        lines: [
          {
            id: "bad",
            name: "Broken",
            description: "Contains an impossible move.",
            moves: [{ san: "e4" }, { san: "Ke7" }],
          },
        ],
      },
      "course:broken",
    );
    expect(broken.errors.length).toBeGreaterThan(0);
    expect(broken.errors[0]?.lineId).toBe("bad");
    expect(broken.errors[0]?.san).toBe("Ke7");
    // The line is truncated at the illegal move, so it teaches nothing.
    expect(broken.lines[0]?.moveCount).toBe(0);
  });

  it("merges explanations when two lines share an edge", () => {
    const withExplanation = buildCourseTree(
      {
        ...spec,
        slug: "merge",
        lines: [
          { id: "a", name: "A", description: "", moves: [{ san: "e4" }, { san: "c6" }] },
          {
            id: "b",
            name: "B",
            description: "",
            moves: [{ san: "e4" }, { san: "c6", explanation: "Explained here." }],
          },
        ],
      },
      "course:merge",
    );
    const c6 = withExplanation.moves.find((m) => m.uci === "c7c6");
    expect(c6?.explanation).toBe("Explained here.");
  });

  it("flags deviation moves as not expected", () => {
    const withDeviation = buildCourseTree(
      {
        ...spec,
        slug: "dev",
        lines: [
          {
            id: "trap",
            name: "Trap",
            description: "",
            moves: [
              { san: "e4" },
              { san: "c6", explanation: "x" },
              { san: "d4" },
              { san: "d5", explanation: "x" },
              { san: "g4", deviation: true, trap: true, frequency: 0.02 },
              { san: "dxe4", explanation: "The refutation." },
            ],
          },
        ],
      },
      "course:dev",
    );
    const g4 = withDeviation.moves.find((m) => m.uci === "g2g4");
    expect(g4?.isExpected).toBe(false);
    // The learner's reply is still part of the repertoire.
    const dxe4 = withDeviation.moves.find((m) => m.uci === "d5e4");
    expect(dxe4?.isExpected).toBe(true);
  });

  it("estimates study time from the number of decisions", () => {
    expect(estimateMinutes(built.lines)).toBeGreaterThan(0);
  });
});

describe("TreeIndex", () => {
  it("exposes O(1) lookups for positions, moves and lines", () => {
    const main = built.lines[0]!;
    expect(tree.position(main.rootPositionId)?.fen).toBe(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    );
    expect(tree.line(main.id)?.moveIds.length).toBe(6);
    expect(tree.size.lines).toBe(2);
  });

  it("returns expected moves only for the side to move", () => {
    const afterE4 = tree.steps(built.lines[0]!.id)[0]!.nextPositionId;
    expect(tree.expectedMoves(afterE4, "b").map((m) => m.san)).toEqual(["c6"]);
    // It is White's move here, so asking for White's expected moves finds nothing.
    expect(tree.expectedMoves(afterE4, "w")).toEqual([]);
  });

  it("ranks the opponent's most common reply first", () => {
    const afterD5 = tree.steps(built.lines[0]!.id)[3]!.nextPositionId;
    const reply = tree.topOpponentReply(afterD5, "b");
    // e5 (0.4) is authored higher than Nc3 (0.35) at the same position.
    expect(reply?.san).toBe("e5");
  });

  it("walks a line as an ordered list of steps", () => {
    const steps = tree.steps(built.lines[1]!.id);
    expect(steps.map((s) => s.move.san)).toEqual([
      "e4",
      "c6",
      "d4",
      "d5",
      "Nc3",
      "dxe4",
      "Nxe4",
      "Bf5",
    ]);
    expect(steps.map((s) => s.isDecision)).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
    ]);
  });

  it("throws on a missing root rather than silently returning undefined", () => {
    const empty = new TreeIndex({
      course: {
        id: "x",
        slug: "x",
        name: "x",
        description: "",
        side: "black",
        eco: null,
        difficulty: 1,
        rootFen: "",
      },
      rootPositionId: "missing",
      positions: [],
      moves: [],
      lines: [],
    });
    expect(() => empty.root).toThrow();
  });
});
