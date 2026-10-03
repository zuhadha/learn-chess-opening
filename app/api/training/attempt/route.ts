import { z } from "zod";

import { handle, json, parseBody } from "@/lib/api/http";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getStore } from "@/lib/db/local-store";
import { recordAttempts } from "@/lib/training/session-service";

export const dynamic = "force-dynamic";

const attemptSchema = z.object({
  sessionId: z.string().min(1),
  // Batched on purpose: correctness is judged locally for speed, and progress is
  // checkpointed every few attempts instead of streamed (PRD §75).
  attempts: z
    .array(
      z.object({
        sessionId: z.string().min(1),
        lineId: z.string().min(1),
        positionId: z.string().min(1),
        move: z.string().min(1).max(8),
        hintUsed: z.boolean().default(false),
        elapsedMs: z.number().int().min(0).max(600_000).default(0),
        attemptIndex: z.number().int().min(0).max(100_000).default(0),
      }),
    )
    .min(1)
    .max(50),
});

/**
 * POST /api/training/attempt
 *
 * The client sends what it *thinks* happened. The server re-derives correctness
 * from the course tree, recomputes the schedule, and returns the authoritative
 * result — so a tampered client cannot manufacture progress (PRD §57).
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseBody(attemptSchema, request);
  if ("error" in parsed) return parsed.error;

  return handle(() => {
    const store = getStore();
    const { results } = recordAttempts(store, {
      userId: getCurrentUserId(),
      sessionId: parsed.data.sessionId,
      attempts: parsed.data.attempts,
      now: new Date(),
    });
    return json({ results }, { headers: { "cache-control": "no-store" } });
  });
}
