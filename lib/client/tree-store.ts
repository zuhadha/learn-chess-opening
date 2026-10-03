/**
 * Client-side course tree cache (PRD §41, §73).
 *
 * A course tree is downloaded once and then held in memory for the rest of the
 * visit. Every move during training is resolved against this object, so the
 * training loop performs zero network requests.
 */

import { TreeIndex } from "@/lib/chess/tree";
import type { CourseTree } from "@/lib/types";

const cache = new Map<string, { tree: CourseTree; index: TreeIndex }>();
const inflight = new Map<string, Promise<{ tree: CourseTree; index: TreeIndex }>>();

export async function loadCourseTree(slug: string): Promise<{
  tree: CourseTree;
  index: TreeIndex;
}> {
  const cached = cache.get(slug);
  if (cached) return cached;

  const pending = inflight.get(slug);
  if (pending) return pending;

  const promise = fetch(`/api/courses/${encodeURIComponent(slug)}/tree`, {
    // The CDN may cache this for an hour; the browser revalidates.
    cache: "force-cache",
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`failed to load course tree (${response.status})`);
      }
      return (await response.json()) as CourseTree;
    })
    .then((tree) => {
      const entry = { tree, index: new TreeIndex(tree) };
      cache.set(slug, entry);
      inflight.delete(slug);
      return entry;
    })
    .catch((error) => {
      inflight.delete(slug);
      throw error;
    });

  inflight.set(slug, promise);
  return promise;
}

export function peekCourseTree(slug: string): TreeIndex | undefined {
  return cache.get(slug)?.index;
}

export function clearCourseTreeCache(): void {
  cache.clear();
}
