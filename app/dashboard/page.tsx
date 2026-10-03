import type { Metadata } from "next";
import Link from "next/link";

import { Badge, ButtonLink, Card, CardTitle, ProgressBar, Stat } from "@/components/ui/primitives";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getStore } from "@/lib/db/local-store";
import {
  getDueLines,
  getProgressSnapshot,
  getWeakLines,
} from "@/lib/training/progress-service";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export default function DashboardPage() {
  const store = getStore();
  const userId = getCurrentUserId();
  const now = new Date();
  const snapshot = getProgressSnapshot(store, userId, now);
  const due = getDueLines(store, userId, now, 25);
  const weak = getWeakLines(store, userId, 12);

  const recentSessions = store.all<{
    id: string;
    mode: string;
    score: number;
    accuracy: number;
    lines_completed: number;
    started_at: string;
  }>(
    `select s.id, s.mode, s.score, s.accuracy, s.lines_completed, s.started_at
       from training_sessions s
      where s.user_id = ?
      order by s.started_at desc
      limit 8`,
    [userId],
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-600">
          What the scheduler thinks you should practise next, and why.
        </p>
      </header>

      <section aria-labelledby="totals" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <h2 id="totals" className="sr-only">
          Totals
        </h2>
        <Stat
          label="Due now"
          value={snapshot.totals.dueNow}
          hint={`${snapshot.totals.dueToday} by midnight`}
        />
        <Stat
          label="Recalls this week"
          value={snapshot.totals.successfulRepetitionsLast7Days}
          hint="Correct moves — the north star"
        />
        <Stat
          label="Mastery rate"
          value={`${Math.round(masteryRate(snapshot) * 100)}%`}
          hint="Mastered / attempted lines"
        />
        <Stat
          label="Move accuracy"
          value={`${Math.round(snapshot.totals.accuracy * 100)}%`}
          hint="Correct moves, all time"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="due-heading" className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 id="due-heading" className="text-lg font-semibold tracking-tight">
              Due for review
            </h2>
            <span className="text-sm text-ink-500">{due.length} lines</span>
          </div>

          {due.length === 0 ? (
            <Card>
              <p className="text-sm text-ink-600">
                Nothing due. Your next review is scheduled — that is the system working, not a
                bug.
              </p>
            </Card>
          ) : (
            <Card className="divide-y divide-ink-100 p-0">
              {due.map((line) => (
                <div key={line.lineId} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-800">{line.name}</p>
                    <p className="truncate text-xs text-ink-500">
                      {line.courseName} · streak {line.streak} ·{" "}
                      {Math.round(line.accuracy * 100)}% accuracy
                    </p>
                  </div>
                  <Link
                    href={`/train/${line.courseId}?mode=practice`}
                    className="shrink-0 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
                  >
                    Practise
                  </Link>
                </div>
              ))}
            </Card>
          )}
        </section>

        <section aria-labelledby="weak-heading" className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 id="weak-heading" className="text-lg font-semibold tracking-tight">
              Weak lines
            </h2>
            <span className="text-sm text-ink-500">{weak.length} lines</span>
          </div>

          {weak.length === 0 ? (
            <Card>
              <p className="text-sm text-ink-600">
                No weak lines yet. A line becomes weak after two misses or two lapses.
              </p>
            </Card>
          ) : (
            <Card className="divide-y divide-ink-100 p-0">
              {weak.map((line) => (
                <div key={line.lineId} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-800">{line.name}</p>
                    <p className="truncate text-xs text-ink-500">
                      {line.courseName} · {Math.round(line.accuracy * 100)}% accuracy ·{" "}
                      {line.incorrectCount} misses
                    </p>
                  </div>
                  <Badge tone={line.accuracy < 0.4 ? "warning" : "learning"}>
                    {line.lapses} lapse{line.lapses === 1 ? "" : "s"}
                  </Badge>
                </div>
              ))}
            </Card>
          )}
        </section>
      </div>

      <section aria-labelledby="courses-heading" className="space-y-3">
        <h2 id="courses-heading" className="text-lg font-semibold tracking-tight">
          Courses
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {snapshot.courses.map((entry) => (
            <Card key={entry.course.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{entry.course.name}</CardTitle>
                  <p className="text-xs text-ink-500">
                    {entry.progress.totalSessions} session
                    {entry.progress.totalSessions === 1 ? "" : "s"}
                    {entry.progress.lastTrainedAt
                      ? ` · last ${new Date(entry.progress.lastTrainedAt).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                <Badge tone="neutral">
                  {entry.progress.unlockedLines}/{entry.course.lineCount} unlocked
                </Badge>
              </div>

              <ProgressBar
                value={entry.byStatus.MASTERED}
                max={Math.max(1, entry.course.lineCount)}
                label={`Mastered lines in ${entry.course.name}`}
              />

              <dl className="grid grid-cols-4 gap-2 text-center text-xs">
                {(["NEW", "LEARNING", "REVIEW", "MASTERED"] as const).map((status) => (
                  <div key={status} className="rounded-md bg-ink-50 py-2">
                    <dt className="text-ink-500">{status.toLowerCase()}</dt>
                    <dd className="text-sm font-semibold tabular-nums text-ink-900">
                      {entry.byStatus[status]}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="flex gap-2">
                <ButtonLink href={`/train/${entry.course.id}?mode=practice`} size="sm">
                  Practise
                </ButtonLink>
                <ButtonLink
                  href={`/train/${entry.course.id}?mode=learn`}
                  variant="secondary"
                  size="sm"
                >
                  Learn
                </ButtonLink>
                <ButtonLink
                  href={`/opening/${entry.course.slug}`}
                  variant="ghost"
                  size="sm"
                >
                  Details
                </ButtonLink>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="sessions-heading" className="space-y-3">
        <h2 id="sessions-heading" className="text-lg font-semibold tracking-tight">
          Recent sessions
        </h2>
        {recentSessions.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-600">
              No sessions yet. Finish one and it will show up here with the server-verified score.
            </p>
          </Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Recent training sessions</caption>
              <thead className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    When
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Mode
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Lines
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Accuracy
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {recentSessions.map((session) => (
                  <tr key={session.id}>
                    <td className="px-4 py-2 text-ink-600">
                      {new Date(session.started_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 capitalize text-ink-800">{session.mode}</td>
                    <td className="px-4 py-2 tabular-nums text-ink-800">
                      {session.lines_completed}
                    </td>
                    <td className="px-4 py-2 tabular-nums text-ink-800">
                      {Math.round(session.accuracy * 100)}%
                    </td>
                    <td className="px-4 py-2 tabular-nums font-semibold text-ink-900">
                      {session.score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}

function masteryRate(snapshot: ReturnType<typeof getProgressSnapshot>): number {
  const attempted = snapshot.totals.linesAttempted;
  if (attempted === 0) return 0;
  return snapshot.totals.linesMastered / attempted;
}
