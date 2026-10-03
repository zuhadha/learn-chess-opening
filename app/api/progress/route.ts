import { handle, json } from "@/lib/api/http";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getStore } from "@/lib/db/local-store";
import { getProgressSnapshot } from "@/lib/training/progress-service";

export const dynamic = "force-dynamic";

/** GET /api/progress — the dashboard payload. Never cached (PRD §46). */
export async function GET(): Promise<Response> {
  return handle(() => {
    const store = getStore();
    const snapshot = getProgressSnapshot(store, getCurrentUserId());
    return json(snapshot, { headers: { "cache-control": "no-store" } });
  });
}
