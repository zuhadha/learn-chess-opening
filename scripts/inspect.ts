/**
 * Dump what the local database currently holds.
 *
 *   npm run db:inspect
 */
import { LOCAL_USER_ID } from "@/lib/auth/current-user";
import { getStore } from "@/lib/db/local-store";
import {
  getAllLineProgress,
  getCourseTree,
  listCourses,
  listLines,
} from "@/lib/db/repositories";
import { countByStatus } from "@/lib/training/session-service";

const store = getStore();
store.migrate();

const courses = listCourses(store);
console.log(`courses: ${courses.length}`);
for (const course of courses) {
  console.log(
    `  ${course.slug} — ${course.name} (${course.side}, ${course.lineCount} lines, ` +
      `${course.decisionCount} decisions, difficulty ${course.difficulty})`,
  );
  const tree = getCourseTree(store, course.id);
  if (tree) {
    console.log(
      `    tree: ${tree.positions.length} positions, ${tree.moves.length} moves, root=${tree.rootPositionId}`,
    );
  }
  for (const line of listLines(store, course.id)) {
    console.log(
      `    · ${line.name} — ${line.moveCount} decisions / ${line.plyCount} plies, difficulty ${line.difficulty}`,
    );
  }
  const byStatus = countByStatus(store, LOCAL_USER_ID, course.id);
  console.log(
    `    progress: NEW=${byStatus.NEW} LEARNING=${byStatus.LEARNING} ` +
      `REVIEW=${byStatus.REVIEW} MASTERED=${byStatus.MASTERED}`,
  );
}

const progress = getAllLineProgress(store, LOCAL_USER_ID);
console.log(`\nline progress rows: ${progress.length}`);
for (const row of progress.slice(0, 20)) {
  console.log(
    `  ${row.lineId} status=${row.status} streak=${row.streak} lapses=${row.lapses} ` +
      `acc=${row.accuracy} next=${row.nextReviewAt ?? "-"}`,
  );
}

const sessions = store.all<{ id: string; mode: string; score: number; accuracy: number }>(
  `select id, mode, score, accuracy from training_sessions order by started_at desc limit 10`,
);
console.log(`\nrecent sessions: ${sessions.length}`);
for (const session of sessions) {
  console.log(`  ${session.id} mode=${session.mode} score=${session.score} acc=${session.accuracy}`);
}

store.close();
