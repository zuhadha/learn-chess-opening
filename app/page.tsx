import { getProgressSnapshot } from "@/lib/training/progress-service";
import { getStore } from "@/lib/db/local-store";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getDueLines } from "@/lib/training/progress-service";
import { CourseCard } from "@/components/courses/CourseCard";
import { Badge, ButtonLink, Card, CardTitle, Stat } from "@/components/ui/primitives";
import Link from "next/link";

export default function HomePage() {
  const store = getStore();
  const userId = getCurrentUserId();
  const snapshot = getProgressSnapshot(store, userId);
  const due = getDueLines(store, userId, new Date(), 8);

  const primary = snapshot.courses[0];
  const hasHistory = snapshot.totals.linesAttempted > 0;

  return (
    <div className="space-y-14">
      {/* Hero */}
      <section className="pt-6 text-center sm:pt-12">
        <Badge tone="accent">Opening repetition trainer</Badge>
        <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
          Don&rsquo;t just study an opening.
          <span className="block text-emerald-700">Recall it until it&rsquo;s automatic.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-ink-600">
          Every opening is a set of decision points, not a PGN file. You play the move, you get
          instant feedback, and the lines you keep missing come back tomorrow — not the ones you
          already know.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          {primary ? (
            <ButtonLink
              href={`/train/${primary.course.id}?mode=${hasHistory ? "practice" : "learn"}`}
              size="lg"
            >
              {hasHistory ? "Start training" : "Start learning"}
            </ButtonLink>
          ) : null}
          <ButtonLink href="/openings" variant="secondary" size="lg">
            Explore openings
          </ButtonLink>
        </div>
      </section>

      {/* Today */}
      <section aria-labelledby="today-heading" className="space-y-4">
        <h2 id="today-heading" className="text-xl font-semibold tracking-tight">
          Today&rsquo;s training
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Due now"
            value={snapshot.totals.dueNow}
            hint={`${snapshot.totals.dueToday} due by midnight`}
          />
          <Stat
            label="Recalls this week"
            value={snapshot.totals.successfulRepetitionsLast7Days}
            hint="Correct moves, last 7 days"
          />
          <Stat
            label="Lines mastered"
            value={snapshot.totals.linesMastered}
            hint={`of ${snapshot.totals.linesAttempted} attempted`}
          />
          <Stat
            label="Accuracy"
            value={`${Math.round(snapshot.totals.accuracy * 100)}%`}
            hint="Correct moves, all time"
          />
        </div>

        {due.length > 0 ? (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Due for review</CardTitle>
              {primary ? (
                <ButtonLink href={`/train/${primary.course.id}?mode=practice`} size="sm">
                  Practise {due.length} line{due.length === 1 ? "" : "s"}
                </ButtonLink>
              ) : null}
            </div>
            <ul className="mt-3 divide-y divide-ink-100">
              {due.map((line) => (
                <li key={line.lineId} className="flex items-baseline justify-between gap-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-ink-800">{line.name}</p>
                    <p className="text-xs text-ink-500">{line.courseName}</p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-amber-700">
                    {formatOverdue(line.overdueSeconds)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Nothing due right now</CardTitle>
              <p className="mt-1 text-sm text-ink-500">
                {hasHistory
                  ? "Your reviews are scheduled. Come back when the next line is due — or learn something new."
                  : "Pick a course and play your first ten lines. It takes about five minutes."}
              </p>
            </div>
            {primary ? (
              <ButtonLink href={`/train/${primary.course.id}?mode=learn`} variant="secondary">
                Learn new lines
              </ButtonLink>
            ) : null}
          </Card>
        )}
      </section>

      {/* Courses */}
      <section aria-labelledby="courses-heading" className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 id="courses-heading" className="text-xl font-semibold tracking-tight">
            Openings
          </h2>
          <Link href="/openings" className="text-sm text-emerald-700 hover:underline">
            All openings
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {snapshot.courses.map((entry) => (
            <CourseCard
              key={entry.course.id}
              course={entry.course}
              byStatus={entry.byStatus}
              dueNow={entry.dueNow}
            />
          ))}
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-heading" className="space-y-4">
        <h2 id="how-heading" className="text-xl font-semibold tracking-tight">
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {[
            {
              title: "Play the move",
              body: "The board is in your browser. Dragging a piece, checking legality and grading your answer never touch the network.",
            },
            {
              title: "Fail where it matters",
              body: "A legal move that is not in the repertoire still counts as a miss. That is the whole point: you are training recall, not legality.",
            },
            {
              title: "Come back tomorrow",
              body: "Each line gets its own review interval. Weak lines return in minutes; mastered lines return in a month.",
            },
          ].map((step, i) => (
            <li key={step.title} className="rounded-xl border border-ink-200 bg-white p-5">
              <span className="text-sm font-semibold text-emerald-700">{i + 1}</span>
              <h3 className="mt-1 font-semibold text-ink-900">{step.title}</h3>
              <p className="mt-1 text-sm text-ink-600">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function formatOverdue(seconds: number): string {
  if (seconds < 60) return "due now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m overdue`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h overdue`;
  return `${Math.round(hours / 24)}d overdue`;
}
