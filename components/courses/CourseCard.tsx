import Link from "next/link";

import { Badge, ProgressBar } from "@/components/ui/primitives";
import { difficultyLabel } from "@/lib/training/difficulty";
import type { CourseSummary, LineStatus } from "@/lib/types";

const statusTone: Record<LineStatus, "new" | "learning" | "review" | "mastered"> = {
  NEW: "new",
  LEARNING: "learning",
  REVIEW: "review",
  MASTERED: "mastered",
};

export function CourseCard({
  course,
  byStatus,
  dueNow,
}: {
  course: CourseSummary;
  byStatus?: Record<LineStatus, number>;
  dueNow?: number;
}) {
  const mastered = byStatus?.MASTERED ?? 0;
  const touched = byStatus
    ? byStatus.LEARNING + byStatus.REVIEW + byStatus.MASTERED
    : 0;

  return (
    <article className="flex h-full flex-col rounded-xl border border-ink-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-ink-900">
            <Link href={`/opening/${course.slug}`} className="hover:underline">
              {course.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">
            {course.authorName}
            {course.eco ? ` · ECO ${course.eco}` : ""}
          </p>
        </div>
        <Badge tone={course.side === "white" ? "neutral" : "neutral"}>
          {course.side === "white" ? "White" : "Black"}
        </Badge>
      </div>

      <p className="mt-3 line-clamp-3 text-sm text-ink-600">{course.description}</p>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-md bg-ink-50 py-2">
          <dt className="text-ink-500">Lines</dt>
          <dd className="text-sm font-semibold tabular-nums text-ink-900">{course.lineCount}</dd>
        </div>
        <div className="rounded-md bg-ink-50 py-2">
          <dt className="text-ink-500">Decisions</dt>
          <dd className="text-sm font-semibold tabular-nums text-ink-900">
            {course.decisionCount}
          </dd>
        </div>
        <div className="rounded-md bg-ink-50 py-2">
          <dt className="text-ink-500">Time</dt>
          <dd className="text-sm font-semibold tabular-nums text-ink-900">
            {course.estimatedMinutes}m
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex items-center justify-between gap-2 text-xs text-ink-500">
        <Badge tone="neutral">{difficultyLabel(course.difficulty)}</Badge>
        {dueNow && dueNow > 0 ? (
          <span className="font-medium text-amber-700">{dueNow} due now</span>
        ) : touched > 0 ? (
          <span>
            {mastered}/{course.lineCount} mastered
          </span>
        ) : null}
      </div>

      {byStatus ? (
        <div className="mt-2">
          <ProgressBar
            value={mastered}
            max={Math.max(1, course.lineCount)}
            label={`Mastered lines in ${course.name}`}
          />
        </div>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Link
          href={`/train/${course.id}?mode=learn`}
          className="inline-flex h-9 flex-1 items-center justify-center rounded-lg bg-emerald-700 px-3 text-sm font-medium text-white hover:bg-emerald-800"
        >
          {touched > 0 ? "Continue" : "Start learning"}
        </Link>
        <Link
          href={`/opening/${course.slug}`}
          className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-medium text-ink-600 ring-1 ring-ink-200 hover:bg-ink-100"
        >
          Details
        </Link>
      </div>

      {byStatus ? (
        <p className="mt-3 flex flex-wrap gap-1 text-[0.7rem] text-ink-500">
          {(["NEW", "LEARNING", "REVIEW", "MASTERED"] as LineStatus[]).map((status) => (
            <Badge key={status} tone={statusTone[status]}>
              {byStatus[status]} {status.toLowerCase()}
            </Badge>
          ))}
        </p>
      ) : null}
    </article>
  );
}
