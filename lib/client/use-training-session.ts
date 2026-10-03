"use client";

/**
 * The training loop (PRD §15–§17).
 *
 * Runs entirely in the browser: the tree is in memory, moves are judged by the
 * training engine, and only batched progress leaves the device. The server
 * re-judges every attempt asynchronously, so the UI can stay instant without
 * becoming the source of truth.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  applyJudgement,
  currentDecision,
  hintFor,
  judgeMove,
  startLine,
  type TrainerState,
} from "@/lib/chess/training-engine";
import type { TreeIndex } from "@/lib/chess/tree";
import { loadCourseTree } from "@/lib/client/tree-store";
import { ProgressQueue } from "@/lib/client/progress-queue";
import { scoreAttempt } from "@/lib/training/scoring";
import type {
  CourseSummary,
  SessionCompleteResult,
  SessionPlan,
  TrainingMode,
  TrainingSession,
} from "@/lib/types";

export type TrainingPhase =
  | "loading"
  | "ready"
  | "line-complete"
  | "session-complete"
  | "error";

export interface Feedback {
  tone: "correct" | "incorrect" | "illegal";
  message: string;
  expectedSan: string | null;
  explanation: string | null;
}

export interface LiveStats {
  score: number;
  streak: number;
  bestStreak: number;
  correct: number;
  incorrect: number;
  hints: number;
  linesDone: number;
}

const INITIAL_STATS: LiveStats = {
  score: 0,
  streak: 0,
  bestStreak: 0,
  correct: 0,
  incorrect: 0,
  hints: 0,
  linesDone: 0,
};

/** How long the board pauses after a correct answer so the reply is readable. */
const ADVANCE_DELAY_MS = 900;

export function useTrainingSession(course: CourseSummary, mode: TrainingMode) {
  const [phase, setPhase] = useState<TrainingPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState<TreeIndex | null>(null);
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [queueIndex, setQueueIndex] = useState(0);
  const [trainer, setTrainer] = useState<TrainerState | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [hint, setHint] = useState<{ san: string; explanation: string | null } | null>(null);
  const [locked, setLocked] = useState(false);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [stats, setStats] = useState<LiveStats>(INITIAL_STATS);
  const [sync, setSync] = useState({ pending: 0, syncing: false, failed: false });
  const [summary, setSummary] = useState<SessionCompleteResult | null>(null);

  const queueRef = useRef<ProgressQueue | null>(null);
  const attemptCounter = useRef(0);
  const decisionStartedAt = useRef(Date.now());
  const hintUsedRef = useRef(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const beginLine = useCallback((treeIndex: TreeIndex, lineId: string) => {
    if (!lineId) {
      setPhase("session-complete");
      return;
    }
    const state = startLine(treeIndex, lineId);
    setTrainer(state);
    setFeedback(null);
    setHint(null);
    hintUsedRef.current = false;
    decisionStartedAt.current = Date.now();
    setLastMove(null);
    setPhase(state.status === "complete" ? "line-complete" : "ready");
  }, []);

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { index: treeIndex } = await loadCourseTree(course.slug);
        if (cancelled) return;
        setIndex(treeIndex);

        const response = await fetch("/api/training/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            courseId: course.id,
            mode,
            sessionId: crypto.randomUUID(),
            sessionSize: mode === "learn" ? 6 : 10,
          }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `could not start session (${response.status})`);
        }
        const data = (await response.json()) as { session: TrainingSession; plan: SessionPlan };
        if (cancelled) return;

        setSession(data.session);
        setPlan(data.plan);

        queueRef.current = new ProgressQueue({
          sessionId: data.session.id,
          batchSize: mode === "learn" ? 4 : 6,
          flushIntervalMs: 4000,
          onStateChange: setSync,
        });

        beginLine(treeIndex, data.plan.lineIds[0] ?? "");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "could not start training");
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
      queueRef.current?.dispose();
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
    // `course.id` is the identity of the session; remounting on mode change is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id, mode]);


  /* ------------------------------------------------------------------ */
  /* Moves                                                               */
  /* ------------------------------------------------------------------ */

  const playMove = useCallback(
    (uci: string) => {
      const treeIndex = index;
      const state = trainer;
      if (!treeIndex || !state || locked || phase !== "ready") return;

      const decision = currentDecision(treeIndex, state);
      if (!decision) return;

      const elapsedMs = Date.now() - decisionStartedAt.current;
      const result = judgeMove({
        tree: treeIndex,
        positionId: state.positionId,
        move: uci,
        learnerSide: treeIndex.playerSide,
        mode,
      });

      const correct = result.status === "correct";
      const next = applyJudgement(treeIndex, state, result, { hintUsed: hintUsedRef.current });

      // Queue the attempt for the server, which re-derives everything.
      queueRef.current?.push({
        sessionId: session?.id ?? "",
        lineId: state.lineId,
        positionId: state.positionId,
        move: uci,
        hintUsed: hintUsedRef.current,
        elapsedMs,
        attemptIndex: attemptCounter.current++,
      });

      setStats((prev) => {
        const streak = correct ? prev.streak + 1 : 0;
        return {
          ...prev,
          score:
            prev.score +
            scoreAttempt({ correct, elapsedMs, streakBefore: prev.streak }),
          streak,
          bestStreak: Math.max(prev.bestStreak, streak),
          correct: prev.correct + (correct ? 1 : 0),
          incorrect: prev.incorrect + (correct ? 0 : 1),
        };
      });

      setFeedback({
        tone: result.status === "correct" ? "correct" : result.status,
        message: result.feedback,
        expectedSan: result.expected?.san ?? null,
        explanation: result.explanation,
      });

      if (!correct) {
        // Wrong answer: stay on the same decision and let the learner retry.
        setTrainer(next);
        setLastMove(null);
        hintUsedRef.current = false;
        decisionStartedAt.current = Date.now();
        return;
      }

      setTrainer(next);
      setLastMove({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
      setHint(null);
      hintUsedRef.current = false;

      // Show the opponent's reply, then move on.
      const steps = treeIndex.steps(state.lineId);
      const reply = steps[decision.index + 1];
      if (reply && !reply.isDecision) {
        advanceTimer.current = setTimeout(
          () => setLastMove({ from: reply.move.uci.slice(0, 2), to: reply.move.uci.slice(2, 4) }),
          280,
        );
      }

      if (next.status === "complete") {
        setLocked(true);
        setStats((prev) => ({ ...prev, linesDone: prev.linesDone + 1 }));
        advanceTimer.current = setTimeout(() => {
          setLocked(false);
          setPhase("line-complete");
        }, ADVANCE_DELAY_MS);
      } else {
        decisionStartedAt.current = Date.now();
      }
    },
    [index, locked, mode, phase, session?.id, trainer],
  );

  const nextLine = useCallback(() => {
    const treeIndex = index;
    if (!treeIndex || !plan) return;
    const next = queueIndex + 1;
    setQueueIndex(next);
    const lineId = plan.lineIds[next];
    if (!lineId) {
      setPhase("session-complete");
      return;
    }
    beginLine(treeIndex, lineId);
  }, [beginLine, index, plan, queueIndex]);

  // Auto-advance between lines: a 10-line session should not need 10 clicks.
  useEffect(() => {
    if (phase !== "line-complete") return;
    const timer = setTimeout(() => nextLine(), 1400);
    return () => clearTimeout(timer);
  }, [nextLine, phase]);

  const revealHint = useCallback(() => {
    const treeIndex = index;
    const state = trainer;
    if (!treeIndex || !state || locked) return;
    const value = hintFor(treeIndex, state);
    if (!value) return;
    setHint(value);
    hintUsedRef.current = true;
    setStats((prev) => ({ ...prev, hints: prev.hints + 1 }));
  }, [index, locked, trainer]);

  const restartLine = useCallback(() => {
    const treeIndex = index;
    const state = trainer;
    if (!treeIndex || !state) return;
    beginLine(treeIndex, state.lineId);
  }, [beginLine, index, trainer]);

  const finish = useCallback(async () => {
    if (!session) return;
    setLocked(true);
    await queueRef.current?.flush();
    try {
      const response = await fetch("/api/training/session/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });
      if (!response.ok) throw new Error(`could not finish session (${response.status})`);
      const data = (await response.json()) as SessionCompleteResult;
      setSummary(data);
      setPhase("session-complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not finish session");
      setLocked(false);
    }
  }, [session]);

  /* ------------------------------------------------------------------ */
  /* Keyboard (PRD §63)                                                  */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      if (event.key === "h" || event.key === "H") {
        event.preventDefault();
        revealHint();
      } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        restartLine();
      } else if (event.key === "ArrowRight" || event.key === "Enter") {
        if (phase === "line-complete") {
          event.preventDefault();
          nextLine();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nextLine, phase, restartLine, revealHint]);

  const currentLine = useMemo(() => {
    if (!index || !plan) return null;
    return index.line(plan.lineIds[queueIndex] ?? "") ?? null;
  }, [index, plan, queueIndex]);

  const decision = useMemo(() => {
    if (!index || !trainer) return null;
    return currentDecision(index, trainer);
  }, [index, trainer]);

  const positionFen = useMemo(() => {
    if (!index || !trainer) return null;
    return index.position(trainer.positionId)?.fen ?? null;
  }, [index, trainer]);

  return {
    phase,
    error,
    index,
    session,
    plan,
    trainer,
    currentLine,
    decision,
    positionFen,
    feedback,
    hint,
    hintSquare: hint && decision ? decision.move.uci.slice(2, 4) : null,
    locked,
    lastMove,
    stats,
    sync,
    summary,
    queueIndex,
    playMove,
    revealHint,
    restartLine,
    nextLine,
    finish,
  };
}

export type TrainingSessionController = ReturnType<typeof useTrainingSession>;
