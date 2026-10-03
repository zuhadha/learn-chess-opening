import Link from "next/link";

import { Badge, ButtonLink, Card, CardTitle, ProgressBar, Stat } from "@/components/ui/primitives";
import type { CourseSummary, SessionCompleteResult } from "@/lib/types";
import type { LiveStats } from "@/lib/client/use-training-session";

/**
 * End-of-session panel.
 *
 * The score shown is the one the server recomputed from the stored attempt log —
 * not the number the client was displaying (PRD §57).
 */
export function SessionSummary({
  course,
  summary,
  live,
  onRestart,
}: {
  course: CourseSummary;
  summary: SessionCompleteResult | null;
  live: LiveStats;
  onRestart: () => void;
}) {
  const accuracy = summary
    ? Math.round(summary.session.accuracy * 100)
    : live.correct + live.incorrect === 0
      ? 0
      : Math.round((live.correct / (live.correct + live.incorrect)) * 100);

  return (
    <Card className="space-y-5">
      <div>
        <Badge tone="accent">Session complete</Badge>
        <CardTitle className="mt-2 text-lg">{course.name}</CardTitle>
        <p className="mt-1 text-sm text-ink-500">
          {summary
            ? "Score verified against your attempt log on the server."
            : "Finishing up — your attempts are still syncing."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Score" value={summary?.serverScore ?? live.score} />
        <Stat label="Accuracy" value={`${accuracy}%`} />
        <Stat
          label="Lines done"
          value={summary?.session.linesCompleted ?? live.linesDone}
          hint={`${summary?.session.linesAttempted ?? live.linesDone} attempted`}
        />
        <Stat label="Mistakes" value={summary?.session.mistakes ?? live.incorrect} />
      </div>

      {summary ? (
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="font-medium text-ink-700">Mastery in this course</span>
              <span className="tabular-nums text-ink-500">
                {summary.mastery.mastered} of {summary.mastery.total} lines
              </span>
            </div>
            <ProgressBar
              value={summary.mastery.mastered}
              max={Math.max(1, summary.mastery.total)}
              label="Mastered lines in this course"
            />
            <p className="mt-1 text-xs text-ink-500">
              {summary.mastery.learning} learning · {summary.mastery.review} in review ·{" "}
              {summary.mastery.new} not started
            </p>
          </div>

          {summary.dueIn.length > 0 ? (
            <div className="rounded-lg border border-ink-200 bg-ink-50 p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                Coming back soon
              </h3>
              <ul className="space-y-1 text-sm">
                {summary.dueIn.map((line) => (
                  <li key={line.lineId} className="flex justify-between gap-3">
                    <span className="text-ink-700">{line.name}</span>
                    <span className="tabular-nums text-ink-400">
                      {formatWhen(line.nextReviewAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/opening/${course.slug}`} variant="primary">
          Back to course
        </ButtonLink>
        <ButtonLink href="/dashboard" variant="secondary">
          Dashboard
        </ButtonLink>
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium text-ink-600 hover:bg-ink-100"
        >
          Train again
        </button>
      </div>

      <p className="text-xs text-ink-400">
        Progress is stored per line, so tomorrow&rsquo;s session will start with whatever you
        are closest to forgetting.{" "}
        <Link href="/dashboard" className="underline">
          See what&rsquo;s due
        </Link>
        .
      </p>
    </Card>
  );
}

function formatWhen(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}
