import { handle, json, jsonError } from "@/lib/api/http";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getCourseBySlug, getLineProgressMap, listLines } from "@/lib/db/repositories";
import { getStore } from "@/lib/db/local-store";

export const dynamic = "force-dynamic";

/** GET /api/courses/:slug — course page payload: metadata, lines, and progress. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  return handle(async () => {
    const { slug } = await context.params;
    const store = getStore();
    const course = getCourseBySlug(store, slug);
    if (!course) return jsonError(`unknown course "${slug}"`, 404);

    const userId = getCurrentUserId();
    const lines = listLines(store, course.id);
    const progress = getLineProgressMap(store, userId, course.id);

    return json({
      course,
      lines: lines.map((line) => ({
        ...line,
        progress: progress.get(line.id) ?? null,
      })),
    });
  });
}
