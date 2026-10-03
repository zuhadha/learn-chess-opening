import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StaticBoard } from "@/components/chess/StaticBoard";
import { Badge, ButtonLink, Card, CardTitle, ProgressBar } from "@/components/ui/primitives";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getCourseBySlug, getCourseTree, getLineProgressMap, listLines } from "@/lib/db/repositories";
import { getStore } from "@/lib/db/local-store";
import { difficultyLabel } from "@/lib/training/difficulty";
import { isDue } from "@/lib/training/scheduler";
import { courseSideToSide } from "@/lib/chess/uci";
import type { LineStatus } from "@/lib/types";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const course = getCourseBySlug(getStore(), slug);
  if (!course) return { title: "Opening not found" };
  return {
    title: `${course.name} repertoire`,
    description: `${course.name} training for ${course.side}: ${course.lineCount} lines, ${course.decisionCount} decisions to recall. ${course.description}`,
    alternates: { canonical: `/opening/${slug}` },
    openGraph: {
      title: `${course.name} repertoire`,
      description: course.description,
    },
  };
}

const statusLabel: Record<LineStatus, string> = {
  NEW: "Not started",
  LEARNING: "Learning",
  REVIEW: "In review",
  MASTERED: "Mastered",
};

const statusTone: Record<LineStatus, "new" | "learning" | "review" | "mastered"> = {
  NEW: "new",
  LEARNING: "learning",
  REVIEW: "review",
  MASTERED: "mastered",
};

export default async function OpeningPage({ params }: Props) {
  const { slug } = await params;
  const store = getStore();
  const course = getCourseBySlug(store, slug);
  if (!course) notFound();

  const userId = getCurrentUserId();
  const lines = listLines(store, course.id);
  const progress = getLineProgressMap(store, userId, course.id);
  const tree = getCourseTree(store, course.id);

  const byStatus: Record<LineStatus, number> = { NEW: 0, LEARNING: 0, REVIEW: 0, MASTERED: 0 };
  let dueNow = 0;
  for (const line of lines) {
    const state = progress.get(line.id);
    byStatus[state?.status ?? "NEW"] += 1;
    if (state && isDue(state)) dueNow += 1;
  }
  const mastered = byStatus.MASTERED;

  // A representative position for the preview: the end of the main line.
  const previewLine = tree?.lines[0];
  const previewFen =
    tree && previewLine
      ? (tree.positions.find((p) => p.id === lastPositionOf(tree, previewLine.moveIds))?.fen ??
        course.rootFen)
      : course.rootFen;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
          <Link href="/openings" className="hover:underline">
            Openings
          </Link>
          <span aria-hidden>/</span>
          <span>{course.name}</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{course.name}</h1>
        <p className="max-w-3xl text-base text-ink-600">{course.description}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{course.side === "white" ? "For White" : "For Black"}</Badge>
          <Badge tone="neutral">{difficultyLabel(course.difficulty)}</Badge>
          {course.eco ? <Badge tone="neutral">ECO {course.eco}</Badge> : null}
          <Badge tone="neutral">
            {course.lineCount} lines · {course.decisionCount} decisions
          </Badge>
          <Badge tone="neutral">~{course.estimatedMinutes} min</Badge>
          <span className="text-xs text-ink-500">by {course.authorName}</span>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <StaticBoard
            fen={previewFen}
            orientation={courseSideToSide(course.side)}
            className="max-w-[320px]"
          />
          <Card className="space-y-3">
            <CardTitle>Your progress</CardTitle>
            <ProgressBar
              value={mastered}
              max={Math.max(1, lines.length)}
              label={`Mastered lines in ${course.name}`}
            />
            <p className="text-sm text-ink-600">
              {mastered} of {lines.length} lines mastered
              {dueNow > 0 ? ` · ${dueNow} due now` : ""}
            </p>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {(["NEW", "LEARNING", "REVIEW", "MASTERED"] as LineStatus[]).map((status) => (
                <div key={status} className="flex items-center justify-between rounded-md bg-ink-50 px-3 py-1.5">
                  <dt className="text-ink-500">{statusLabel[status]}</dt>
                  <dd className="font-semibold tabular-nums text-ink-900">{byStatus[status]}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-col gap-2 pt-1">
              <ButtonLink href={`/train/${course.id}?mode=learn`}>
                {mastered > 0 ? "Learn more lines" : "Start learning"}
              </ButtonLink>
              <ButtonLink href={`/train/${course.id}?mode=practice`} variant="secondary">
                Practise {dueNow > 0 ? `${dueNow} due` : "what you know"}
              </ButtonLink>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardTitle>What you will train</CardTitle>
            <p className="mt-1 text-sm text-ink-600">
              Each line is a path through the opening. You play every move for{" "}
              {course.side}; the opponent&rsquo;s replies are played for you, including the
              sidelines they actually try.
            </p>
          </Card>

          <ul className="space-y-3">
            {lines.map((line) => {
              const state = progress.get(line.id);
              const due = state ? isDue(state) : false;
              return (
                <li
                  key={line.id}
                  className="rounded-xl border border-ink-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-semibold text-ink-900">{line.name}</h2>
                      <p className="mt-0.5 text-sm text-ink-600">{line.description}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={statusTone[state?.status ?? "NEW"]}>
                        {statusLabel[state?.status ?? "NEW"]}
                      </Badge>
                      {due ? <span className="text-xs text-amber-700">due now</span> : null}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
                    <span>
                      <span className="font-semibold tabular-nums text-ink-800">
                        {line.moveCount}
                      </span>{" "}
                      moves to recall
                    </span>
                    <span>{line.plyCount} plies</span>
                    <span>{difficultyLabel(line.difficulty)}</span>
                    {line.eco ? <span>ECO {line.eco}</span> : null}
                    {state && state.correctCount + state.incorrectCount > 0 ? (
                      <span>
                        {Math.round(state.accuracy * 100)}% accuracy · {state.lapses} lapse
                        {state.lapses === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function lastPositionOf(
  tree: { moves: { id: string; nextPositionId: string }[] },
  moveIds: string[],
): string | undefined {
  const byId = new Map(tree.moves.map((m) => [m.id, m]));
  const last = moveIds[moveIds.length - 1];
  return last ? byId.get(last)?.nextPositionId : undefined;
}
