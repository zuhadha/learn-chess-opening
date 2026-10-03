/**
 * Server-side course-tree cache (PRD §46).
 *
 * Course content is immutable, so building a `TreeIndex` once per course per
 * process is safe and keeps attempt validation off the hot path. User progress
 * is never cached here.
 */

import { getCourseTree } from "@/lib/db/repositories";
import type { LocalStore } from "@/lib/db/local-store";
import { TreeIndex } from "@/lib/chess/tree";

const cache = new Map<string, TreeIndex>();

export function getTreeIndex(store: LocalStore, courseId: string): TreeIndex | undefined {
  const cached = cache.get(courseId);
  if (cached) return cached;
  const tree = getCourseTree(store, courseId);
  if (!tree) return undefined;
  const index = new TreeIndex(tree);
  cache.set(courseId, index);
  return index;
}

export function clearTreeCache(): void {
  cache.clear();
}
