import { z } from "zod";

import { handle, json, parseBody } from "@/lib/api/http";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getStore } from "@/lib/db/local-store";
import { completeSession } from "@/lib/training/session-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sessionId: z.string().min(1),
});

/**
 * POST /api/training/session/complete
 *
 * Finalises a session. The score returned here is recomputed from the stored
 * attempt log — any score the client claimed is discarded (PRD §57, §86).
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseBody(bodySchema, request);
  if ("error" in parsed) return parsed.error;

  return handle(() => {
    const store = getStore();
    const result = completeSession(store, {
      userId: getCurrentUserId(),
      sessionId: parsed.data.sessionId,
      now: new Date(),
    });
    return json(result, { headers: { "cache-control": "no-store" } });
  });
}
