/**
 * Seed the content set from `lib/content`.
 *
 *   npm run db:seed
 */
import { LOCAL_USER_ID } from "@/lib/auth/current-user";
import { courseSpecs } from "@/lib/content/registry";
import { getStore } from "@/lib/db/local-store";
import { seedCourses } from "@/lib/db/seed";
import { getCourseTree } from "@/lib/db/repositories";

const store = getStore();
store.migrate();

const result = seedCourses(store, courseSpecs, { ensureUserId: LOCAL_USER_ID });

console.log("seeded:");
console.log(`  courses    ${result.courses}`);
console.log(`  positions  ${result.positions}`);
console.log(`  moves      ${result.moves}`);
console.log(`  lines      ${result.lines}`);
console.log(`  line moves ${result.lineMoves}`);

for (const spec of courseSpecs) {
  const tree = getCourseTree(store, `course:${spec.slug}`);
  if (!tree) continue;
  const decisions = tree.lines.reduce((sum, l) => sum + l.moveCount, 0);
  console.log(
    `  ${spec.slug}: ${tree.lines.length} lines, ${tree.positions.length} positions, ` +
      `${tree.moves.length} moves, ${decisions} decisions`,
  );
}

store.close();
