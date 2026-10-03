/**
 * Content seeding (PRD §49, §91).
 *
 * Idempotent and progress-preserving: content rows are upserted on their
 * deterministic ids, so reseeding after editing a line never orphans a
 * learner's `user_line_progress`. Illegal lines abort the seed — a broken course
 * must never reach the database (PRD §90).
 */

import { buildCourseTree } from "@/lib/chess/tree";
import type { CourseSpec } from "@/lib/content/types";
import type { LocalStore } from "@/lib/db/local-store";
import { ensureProfile } from "@/lib/training/session-service";

export interface SeedResult {
  courses: number;
  positions: number;
  moves: number;
  lines: number;
  lineMoves: number;
}

export function seedCourses(
  store: LocalStore,
  specs: CourseSpec[],
  options: { now?: string; ensureUserId?: string } = {},
): SeedResult {
  const now = options.now ?? new Date().toISOString();
  const result: SeedResult = { courses: 0, positions: 0, moves: 0, lines: 0, lineMoves: 0 };

  if (options.ensureUserId) ensureProfile(store, options.ensureUserId, now);

  for (const spec of specs) {
    const courseId = `course:${spec.slug}`;
    const built = buildCourseTree(spec, courseId);

    if (built.errors.length > 0) {
      const detail = built.errors
        .map((e) => `    [${e.lineId}] ply ${e.ply} "${e.san}": ${e.message}`)
        .join("\n");
      throw new Error(
        `Refusing to seed "${spec.slug}": ${built.errors.length} illegal move(s).\n${detail}`,
      );
    }

    store.transaction(() => {
      const authorId = `author:${spec.slug}`;
      store.run(
        `insert into course_authors (id, name, title, bio, created_at)
         values (?, ?, ?, ?, ?)
         on conflict (id) do update set name = excluded.name, title = excluded.title`,
        [authorId, spec.authorName, spec.authorName, null, now],
      );

      store.run(
        `insert into courses (
           id, slug, name, description, side, eco, difficulty, status, root_fen,
           author_id, tags, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update set
           slug = excluded.slug, name = excluded.name, description = excluded.description,
           side = excluded.side, eco = excluded.eco, difficulty = excluded.difficulty,
           status = excluded.status, root_fen = excluded.root_fen,
           author_id = excluded.author_id, tags = excluded.tags, updated_at = excluded.updated_at`,
        [
          courseId,
          spec.slug,
          built.course.name,
          built.course.description,
          built.course.side,
          built.course.eco,
          built.course.difficulty,
          built.course.status,
          built.course.rootFen,
          authorId,
          JSON.stringify(spec.tags ?? []),
          now,
          now,
        ],
      );
      result.courses += 1;

      // Parents before children: positions reference their parent position.
      const ordered = [...built.positions].sort((a, b) => a.depth - b.depth);
      for (const position of ordered) {
        store.run(
          `insert into positions (
             id, course_id, fen, zobrist_hash, parent_position_id, ply, side_to_move,
             depth, opening_name, eco
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict (id) do update set
             fen = excluded.fen, zobrist_hash = excluded.zobrist_hash,
             parent_position_id = excluded.parent_position_id, ply = excluded.ply,
             side_to_move = excluded.side_to_move, depth = excluded.depth,
             opening_name = excluded.opening_name, eco = excluded.eco`,
          [
            position.id,
            position.courseId,
            position.fen,
            position.zobristHash,
            position.parentPositionId,
            position.ply,
            position.sideToMove,
            position.depth,
            position.openingName,
            position.eco,
          ],
        );
        result.positions += 1;
      }

      for (const move of built.moves) {
        store.run(
          `insert into moves (
             id, course_id, position_id, next_position_id, uci, san, is_expected,
             frequency, priority, explanation, games
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict (id) do update set
             next_position_id = excluded.next_position_id, san = excluded.san,
             is_expected = excluded.is_expected, frequency = excluded.frequency,
             priority = excluded.priority, explanation = excluded.explanation,
             games = excluded.games`,
          [
            move.id,
            move.courseId,
            move.positionId,
            move.nextPositionId,
            move.uci,
            move.san,
            move.isExpected,
            move.frequency,
            move.priority,
            move.explanation,
            move.games,
          ],
        );
        result.moves += 1;
      }

      for (const line of built.lines) {
        store.run(
          `insert into course_lines (
             id, course_id, root_position_id, name, description, move_count, ply_count,
             difficulty, sort_order, eco
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict (id) do update set
             root_position_id = excluded.root_position_id, name = excluded.name,
             description = excluded.description, move_count = excluded.move_count,
             ply_count = excluded.ply_count, difficulty = excluded.difficulty,
             sort_order = excluded.sort_order, eco = excluded.eco`,
          [
            line.id,
            line.courseId,
            line.rootPositionId,
            line.name,
            line.description,
            line.moveCount,
            line.plyCount,
            line.difficulty,
            line.sortOrder,
            line.eco,
          ],
        );
        result.lines += 1;

        // The ordered edge list is content, not user state, so it is rebuilt.
        store.run(`delete from course_line_moves where line_id = ?`, [line.id]);
        line.moveIds.forEach((moveId, seq) => {
          store.run(
            `insert into course_line_moves (line_id, seq, move_id) values (?, ?, ?)`,
            [line.id, seq, moveId],
          );
          result.lineMoves += 1;
        });
      }

      // Drop lines that no longer exist in the spec. Their progress rows go with
      // them (FK cascade) — an orphaned schedule for a deleted line is worse.
      const lineIds = built.lines.map((l) => l.id);
      const stale = store
        .all<{ id: string }>(`select id from course_lines where course_id = ?`, [courseId])
        .filter((row) => !lineIds.includes(row.id));
      for (const row of stale) {
        store.run(`delete from user_line_progress where line_id = ?`, [row.id]);
        store.run(`delete from course_lines where id = ?`, [row.id]);
      }
    });
  }

  return result;
}
