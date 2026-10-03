import { handle, json } from "@/lib/api/http";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getStore } from "@/lib/db/local-store";
import { getDueLines, getWeakLines } from "@/lib/training/progress-service";

export const dynamic = "force-dynamic";

/** GET /api/progress/due — today's repetitions and the weak-lines list. */
export async function GET(request: Request): Promise<Response> {
  return handle(() => {
    const params = new URL(request.url).searchParams;
    const limit = Math.min(200, Math.max(1, Number(params.get("limit") ?? 50) || 50));
    const store = getStore();
    const userId = getCurrentUserId();

    return json(
      {
        due: getDueLines(store, userId, new Date(), limit),
        weak: getWeakLines(store, userId, limit),
      },
      { headers: { "cache-control": "no-store" } },
    );
  });
}
