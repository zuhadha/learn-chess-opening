import { handle, json } from "@/lib/api/http";
import { getStore } from "@/lib/db/local-store";
import { listCourses } from "@/lib/db/repositories";

export const dynamic = "force-dynamic";

/**
 * GET /api/courses?search=&side=
 *
 * Course content is immutable, so the response is CDN-cacheable (PRD §46).
 */
export async function GET(request: Request): Promise<Response> {
  return handle(() => {
    const params = new URL(request.url).searchParams;
    const side = params.get("side");
    const store = getStore();
    const courses = listCourses(store, {
      search: params.get("search") ?? undefined,
      side: side === "white" || side === "black" ? side : undefined,
    });

    return json(
      { courses },
      {
        headers: {
          "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  });
}
