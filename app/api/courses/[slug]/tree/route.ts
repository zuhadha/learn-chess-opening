import { handle, json, jsonError } from "@/lib/api/http";
import { getCourseBySlug, getCourseTree } from "@/lib/db/repositories";
import { getStore } from "@/lib/db/local-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/courses/:slug/tree
 *
 * One request per course, then the browser holds the whole position graph in
 * memory and needs no further network access to train (PRD §41, §73, §74).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  return handle(async () => {
    const { slug } = await context.params;
    const store = getStore();
    const course = getCourseBySlug(store, slug);
    if (!course) return jsonError(`unknown course "${slug}"`, 404);

    const tree = getCourseTree(store, course.id);
    if (!tree) return jsonError(`course "${slug}" has no tree`, 409);

    return json(tree, {
      headers: {
        // Immutable content: safe to cache hard in the CDN and the browser.
        "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  });
}
