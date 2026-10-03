"use client";

import clsx from "clsx";
import Link from "next/link";

import { ChessBoard } from "@/components/chess/ChessBoard";
import { MoveList } from "@/components/training/MoveList";
import { SessionSummary } from "@/components/training/SessionSummary";
import { Badge, Button, Card, ProgressBar } from "@/components/ui/primitives";
import { useTrainingSession } from "@/lib/client/use-training-session";
import { difficultyLabel } from "@/lib/training/difficulty";
import type { CourseSummary, TrainingMode } from "@/lib/types";

const MODE_COPY: Record<TrainingMode, { title: string; blurb: string }> = {
  learn: {
    title: "Learn",
    blurb: "Hints and explanations on. Mistakes are expected here.",
  },
  practice: {
    title: "Practice",
    blurb: "No explanations until you answer. Accuracy is the goal.",
  },
};

/**
 * The training screen (PRD §15–§17, §61–§63).
 *
 * Layout rule from PRD §62: board first on mobile, board + panel on desktop, and
 * never any horizontal scrolling.
 */
export function TrainingSession({
  course,
  mode,
}: {
  course: CourseSummary;
  mode: TrainingMode;
}) {
  const session = useTrainingSession(course, mode);
  const copy = MODE_COPY[mode];
  const total = session.plan?.lineIds.length ?? 0;
  const playerSide = session.index?.playerSide ?? "b";

  if (session.phase === "loading") {
    return (
      <Card className="flex flex-col items-center gap-3 py-16 text-center">
        <span aria-hidden className="animate-pulse text-3xl">
          ♞
        </span>
        <p className="text-sm text-ink-500">
          Loading the {course.name} tree and picking your lines…
        </p>
        <p className="text-xs text-ink-400">
          One request, then the whole session runs in your browser.
        </p>
      </Card>
    );
  }

  if (session.phase === "error") {
    return (
      <Card className="space-y-3 py-10 text-center">
        <h2 className="text-lg font-semibold">Training could not start</h2>
        <p className="text-sm text-ink-500">{session.error}</p>
        <div className="flex justify-center gap-2">
          <Button onClick={() => window.location.reload()}>Retry</Button>
          <Link
            href={`/opening/${course.slug}`}
            className="inline-flex h-10 items-center rounded-lg px-4 text-sm text-ink-600 hover:bg-ink-100"
          >
            Back to course
          </Link>
        </div>
      </Card>
    );
  }

  if (session.phase === "session-complete") {
    return (
      <div className="mx-auto max-w-3xl">
        <SessionSummary
          course={course}
          summary={session.summary}
          live={session.stats}
          onRestart={() => window.location.reload()}
        />
      </div>
    );
  }

  const accuracy =
    session.stats.correct + session.stats.incorrect === 0
      ? 100
      : Math.round((session.stats.correct / (session.stats.correct + session.stats.incorrect)) * 100);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* Board column */}
      <div className="order-1 mx-auto w-full max-w-[560px] lg:order-none lg:mx-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              {copy.title}
            </p>
            <h1 className="text-lg font-semibold tracking-tight">
              {session.currentLine?.name ?? course.name}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {session.currentLine ? (
              <Badge tone="neutral">
                {difficultyLabel(session.currentLine.difficulty)}
              </Badge>
            ) : null}
            <Badge tone="new">You play {playerSide === "w" ? "White" : "Black"}</Badge>
          </div>
        </div>

        <ChessBoard
          fen={session.positionFen ?? course.rootFen}
          orientation={playerSide}
          interactive={session.phase === "ready" && !session.locked}
          onMove={(uci) => session.playMove(uci)}
          lastMove={session.lastMove}
          hintSquare={session.hintSquare ?? null}
          tone={
            session.feedback?.tone === "correct"
              ? "correct"
              : session.feedback?.tone === "incorrect" || session.feedback?.tone === "illegal"
                ? "incorrect"
                : "idle"
          }
          announcement={
            session.feedback
              ? `${session.feedback.tone === "correct" ? "Correct" : "Not the repertoire move"}. ${
                  session.feedback.message
                }`
              : undefined
          }
          ariaLabel={`${course.name} training board`}
        />

        {/* Controls live under the board on mobile so the board is never pushed
            below the fold. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={session.revealHint}
            disabled={session.phase !== "ready" || session.locked}
          >
            Hint <span className="text-ink-400">(H)</span>
          </Button>
          <Button
            variant="ghost"
            onClick={session.restartLine}
            disabled={session.phase !== "ready" && session.phase !== "line-complete"}
          >
            Restart line <span className="text-ink-400">(R)</span>
          </Button>
          {session.phase === "line-complete" ? (
            <Button onClick={session.nextLine}>Next line</Button>
          ) : (
            <Button variant="ghost" onClick={() => void session.finish()}>
              Finish session
            </Button>
          )}
          <SyncIndicator pending={session.sync.pending} failed={session.sync.failed} />
        </div>
      </div>

      {/* Panel column */}
      <div className="order-2 space-y-4 lg:order-none">
        <Card className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium text-ink-700">
              Line {Math.min(session.queueIndex + 1, total)} of {total}
            </span>
            <span className="text-xs text-ink-500">{copy.blurb}</span>
          </div>
          <ProgressBar
            value={session.queueIndex + (session.phase === "line-complete" ? 1 : 0)}
            max={Math.max(1, total)}
            label="Lines completed in this session"
          />

          <div className="grid grid-cols-3 gap-2 text-center">
            <MiniStat label="Score" value={session.stats.score} />
            <MiniStat label="Streak" value={session.stats.streak} />
            <MiniStat label="Accuracy" value={`${accuracy}%`} />
          </div>
        </Card>

        <FeedbackPanel
          tone={session.feedback?.tone ?? null}
          message={
            session.phase === "line-complete"
              ? `Line complete — ${session.stats.correct} correct so far. Next line coming up.`
              : session.feedback?.message ??
                (playerSide === "b"
                  ? "White has played. Your move."
                  : "Your move.")
          }
          explanation={session.phase === "line-complete" ? null : session.feedback?.explanation}
        />

        {session.hint ? (
          <Card className="border-sky-200 bg-sky-50">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Hint</p>
            <p className="mt-1 font-mono text-lg font-semibold text-sky-900">
              {session.hint.san}
            </p>
            {session.hint.explanation ? (
              <p className="mt-1 text-sm text-sky-800">{session.hint.explanation}</p>
            ) : null}
            <p className="mt-2 text-xs text-sky-700">
              A hinted answer counts as correct but does not advance your review interval.
            </p>
          </Card>
        ) : null}

        {session.trainer ? (
          <MoveList
            moves={session.trainer.sanHistory}
            pendingSide={session.phase === "ready" ? playerSide : null}
          />
        ) : null}

        {session.plan ? (
          <Card className="text-xs text-ink-500">
            <p className="font-semibold text-ink-700">Why these lines?</p>
            <p className="mt-1">
              {describeBreakdown(session.plan.breakdown)} You have unlocked{" "}
              {session.plan.unlocked} of {session.plan.total} lines — the rest open up as you
              master these.
            </p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-ink-50 px-2 py-2">
      <div className="text-lg font-semibold tabular-nums text-ink-900">{value}</div>
      <div className="text-[0.65rem] font-medium uppercase tracking-wide text-ink-500">
        {label}
      </div>
    </div>
  );
}

function FeedbackPanel({
  tone,
  message,
  explanation,
}: {
  tone: "correct" | "incorrect" | "illegal" | null;
  message: string;
  explanation?: string | null;
}) {
  // Text + icon + colour: no state is communicated by colour alone (PRD §64).
  const icon = tone === "correct" ? "✓" : tone === "incorrect" || tone === "illegal" ? "!" : "→";
  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "rounded-xl border p-4",
        tone === "correct"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : tone === "incorrect" || tone === "illegal"
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-ink-200 bg-white text-ink-700",
      )}
    >
      <p className="flex items-start gap-2 text-sm font-medium">
        <span aria-hidden className="mt-0.5 font-bold">
          {icon}
        </span>
        <span>{message}</span>
      </p>
      {explanation ? <p className="mt-2 text-sm opacity-90">{explanation}</p> : null}
    </div>
  );
}

function SyncIndicator({ pending, failed }: { pending: number; failed: boolean }) {
  if (failed) {
    return (
      <span className="ml-auto text-xs text-amber-700" role="status">
        Offline — {pending} saved locally, retrying
      </span>
    );
  }
  if (pending > 0) {
    return (
      <span className="ml-auto text-xs text-ink-400" role="status">
        {pending} to sync
      </span>
    );
  }
  return <span className="ml-auto text-xs text-ink-400">Progress saved</span>;
}

function describeBreakdown(
  breakdown: Record<"due" | "weak" | "failed" | "learning" | "new" | "mastered", number>,
): string {
  const parts: string[] = [];
  if (breakdown.due) parts.push(`${breakdown.due} due for review`);
  if (breakdown.weak) parts.push(`${breakdown.weak} you keep missing`);
  if (breakdown.failed) parts.push(`${breakdown.failed} failed recently`);
  if (breakdown.learning) parts.push(`${breakdown.learning} still learning`);
  if (breakdown.new) parts.push(`${breakdown.new} new`);
  if (breakdown.mastered) parts.push(`${breakdown.mastered} mastered lines for maintenance`);
  if (parts.length === 0) return "The cohort is empty.";
  return `This session is ${parts.join(", ")}.`;
}
