import { z } from "zod";

import { handle, json, jsonError, parseBody } from "@/lib/api/http";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getStore } from "@/lib/db/local-store";
import { planSession } from "@/lib/training/progress-service";
import { startSession } from "@/lib/training/session-service";
import { DEFAULT_SESSION_SIZE } from "@/lib/training/cohort";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  courseId: z.string().min(1),
  mode: z.enum(["learn", "practice"]),
  /** Server-side id so the client and the log agree on the session key. */
  sessionId: z.string().min(1).max(120).optional(),
  sessionSize: z.number().int().min(1).max(50).optional(),
});

/**
 * POST /api/training/session
 *
 * Starts a session and returns the adaptive cohort (PRD §23). The cohort is
 * computed server-side: the learner does not get to pick only easy lines.
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseBody(bodySchema, request);
  if ("error" in parsed) return parsed.error;

  return handle(() => {
    const userId = getCurrentUserId();
    const store = getStore();
    const now = new Date();

    const { session } = startSession(store, {
      userId,
      courseId: parsed.data.courseId,
      mode: parsed.data.mode,
      sessionId: parsed.data.sessionId ?? crypto.randomUUID(),
      now,
    });

    const plan = planSession(store, userId, parsed.data.courseId, {
      now,
      sessionSize: parsed.data.sessionSize ?? DEFAULT_SESSION_SIZE,
    });

    if (plan.lineIds.length === 0) {
      return jsonError("this course has no lines to train yet", 409);
    }

    return json({ session, plan }, { headers: { "cache-control": "no-store" } });
  });
}
