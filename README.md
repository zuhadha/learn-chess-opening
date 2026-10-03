# learn-chess-opening

An opening-repetition trainer. It teaches a chess opening the way ChessReps does: a repertoire
broken into lines, a board you play moves on instead of reading notation, and spaced repetition
deciding what you see next.

This repository contains the **§98 prototype** from the PRD — a working training engine with one
complete course, not a commercial product. Payment, accounts, leaderboards, Drill/Time Trial/
Puzzles, engine analysis and marketing polish are deliberately absent.

---

## Quick start

```bash
npm install
npm run prepare:db   # create data/learn-chess-opening.sqlite, apply migrations, seed the course
npm run dev          # http://localhost:3000
```

The dev server binds `0.0.0.0:3000`.

Walk the acceptance flow from PRD §102:

1. `/openings` → search **Caro-Kann** → one result.
2. `/opening/caro-kann-defense` → 17 lines, the main move at the root, per-line difficulty and
   estimated learning time.
3. **Start learning** → 10 lines unlocked. Play the first line, make a mistake on purpose. The
   opponent replies with the move you allowed; your line continues, not theirs.
4. Finish the session → score, accuracy, mastery.
5. `/dashboard` → the failed line is in the **Needs Work** bucket with a 10-minute review.
6. Start a practice session → that line is queued first, ahead of new material.
7. Refresh any page → progress is still there.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on `0.0.0.0:3000` |
| `npm run build` / `npm start` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (flat config) |
| `npm run test` | Vitest — 124 tests, unit + DB-backed integration + component |
| `npm run test:watch` | Watch mode |
| `npm run check` | typecheck + lint + test + content validation |
| `npm run format` / `format:check` | Prettier |
| `npm run db:migrate` | Apply SQL migrations |
| `npm run db:seed` | Seed the course catalogue (idempotent) |
| `npm run db:reset` | `migrate --fresh` (drop and recreate every table), then seed |
| `npm run db:inspect` | Print a summary of what is stored |
| `npm run validate:content` | Lint every line: legal moves, explanations present |

`prepare:db` is `db:migrate && db:seed`.

---

## Architecture

```
lib/
  types.ts              shared domain + wire types (safe to import from client code)
  content/              course data: types, the Caro-Kann repertoire, registry
  chess/                pure chess logic, no I/O
    zobrist.ts          FEN -> 64-bit position hash
    uci.ts              SAN / FEN / UCI helpers
    tree.ts             opening tree builder + TreeIndex lookup
    training-engine.ts  move judge + line walker (pure)
    board-utils.ts      chess.js-free board helpers for rendering
  training/             scheduling and scoring, no I/O
    scheduler.ts        spaced-repetition state machine
    difficulty.ts       line difficulty + personal difficulty
    scoring.ts          points, streaks, session score
    cohort.ts           which lines a session contains
    tree-cache.ts       memoised tree + index per course
    session-service.ts  the only module that writes progress
    progress-service.ts read models: due, weak, dashboard
  db/                   storage
    schema.ts           SQL DDL (mirrors supabase/migrations/0001_init.sql)
    local-store.ts      SQLite (node:sqlite) + in-memory store for tests
    repositories.ts     parameterised queries
    seed.ts             CourseSpec -> rows
  auth/current-user.ts  the single local learner
  api/http.ts           response/error helpers for route handlers
  client/               browser state (tree store, offline queue, session hook)

app/                    pages + API routes
components/             board, training UI, shared primitives
scripts/                migrate / seed / inspect / validate-content
supabase/migrations/    the PostgreSQL schema (source of truth)
tests/                  unit, integration, component
```

### The three layers

**Content** is plain TypeScript data (`lib/content/*.ts`), never fetched at runtime. A course is a
list of lines; a line is a list of `{ san, explanation?, frequency? }`. `buildCourseTree` turns
those lines into a merged position/move tree, deduplicating positions by Zobrist hash so a shared
prefix is stored once.

**Chess logic** (`lib/chess`, `lib/training`) is pure functions over plain data. No database, no
React, no timers. This is why the judge can be reused verbatim on the server to reject bad clients.

**Storage** (`lib/db`) is the only place that touches a database.

### Where the Postgres ↔ SQLite boundary is

`supabase/migrations/0001_init.sql` is the authoritative schema: 11 tables, foreign keys, RLS
policies, and the indexes PRD §100 calls critical.

`lib/db/schema.ts` holds the same DDL in the SQLite dialect. `tests/schema-parity.test.ts` parses
both files and asserts they describe the same tables and the same columns, so the local schema
cannot drift from the Postgres one.

The swap boundary is **`lib/db/local-store.ts`** — a ~100-line `LocalStore` wrapper around
`node:sqlite` with `run` / `get` / `all` / `transaction`. `lib/db/repositories.ts` writes
SQL against that wrapper using `?` placeholders, which is the only placeholder syntax both
engines share. Moving to Supabase means replacing `LocalStore` with a Postgres client and
translating the handful of SQLite-specific bits that are already marked in the file:

| Local SQLite | Postgres |
| --- | --- |
| `PRAGMA user_version` for the migration cursor | `schema_migrations` table |
| `insert ... on conflict (col) do nothing` | same syntax, no change |
| `insert ... on conflict (user_id, line_id) do update` | same syntax, no change |
| timestamps stored as ISO-8601 text | `timestamptz` |
Nothing else in the codebase knows which engine is underneath.

RLS is defined in the migration and is **not** enforced locally (there is no auth). Read policies
are gated on `courses.status = 'published'`, user rows on `auth.uid() = user_id`, and there are
deliberately **no write policies on content** — only a service-role key can change a course
(PRD §116).

### The single write path

Every progress mutation goes through `lib/training/session-service.ts`. Route handlers validate
input with Zod and call it; nothing else writes `user_line_progress`, `user_course_progress`,
`training_sessions` or `training_attempts`.

---

## Training engine

### The unit of scheduling is the line, not the move

`user_line_progress` is keyed by `(user_id, line_id)`, so **one line = one scheduled review**
(PRD §21, §41). `recordAttempts` stores every individual attempt as an audit row, but advances the
schedule exactly once per completed line:

- a line is *completed* when the learner plays its last decision correctly;
- that review counts as **correct only if the whole line was recalled without a mistake**;
- a hint anywhere in the line counts as hinted, which blocks the ease-factor bonus;
- a line abandoned mid-way after a mistake takes a lapse, so skipping a line you cannot remember
  cannot hide the problem.

Getting this wrong is the classic bug in this product: scheduling per ply means a single pass of
an 11-move line awards an 11-review streak and instantly "masters" the line. There is a
regression test for exactly that (`does not master a line just because it is long`).

### Scheduler

SM-2-style, in seconds, so tests and the 10-minute lapse window are exact:

| Streak | Interval |
| --- | --- |
| 0 (lapse) | 10 minutes |
| 1 | 1 day |
| 2 | 3 days |
| 3 | 1 week |
| 4 | 2 weeks |
| 5+ | 30 days |

Beyond streak 5 the interval is multiplied by an ease factor per line, clamped to `[1.3, 3.0]`.
Correct reviews nudge it up by 0.05 (never hinted), failures drop it by 0.2. Status is derived
from streak: 0–2 `learning`, 3–5 `review`, 6+ `mastered`. A line is *weak* at ≥2 lapses or
accuracy < 60% after ≥3 reviews.

### What a session contains

`selectCohort` fills the session in priority order, with a floor of one slot per non-empty bucket
and an overflow pass so a large weak-line backlog can never be starved:

| Bucket | Share | Definition |
| --- | --- | --- |
| due | 40% | `next_review_at <= now` |
| weak | 25% | flagged weak by the rules above |
| failed | 10% | failed in the last 24 h |
| learning | 25% | in progress, not yet due |
| new | remainder | never attempted |
| mastered | top-up | only to fill an otherwise empty session |

### Progressive unlock

The course starts at 10 lines. Each line mastered unlocks the next one in difficulty order,
stopping at the next hard jump (a difficulty increase of ≥2) until the learner's average is high
enough. Unlocking is computed from stored progress on every session start — never counted
client-side.

### Difficulty and scoring

Line difficulty (1–5) is `0.35·depth + 0.25·branching + 0.25·rarity + 0.15·errorRate`. The rarity
term uses the authored `frequency` of each move, which is meant to be the share of human games
continuing that way — **not** a share of moves inside the course. Do not renormalise frequencies
per position; it inverts the term.

Personal difficulty adds 1 for ≥3 lapses and 1 for a sub-40% hit rate, and subtracts 1 once a
line is mastered.

Points: `100 × streakMultiplier + speedBonus` on a correct first try, 0 otherwise. The session
score is recomputed server-side from the stored attempt log at completion, so a tampered client
cannot inflate it.

### Server-side validation

The client judges moves for instant feedback, then replays each attempt to the server. The server
re-derives every SAN/UCI from the authoritative tree and rejects, with a 400:

- a move that is not legal in that position;
- a legal move that is not in the repertoire;
- an attempt at a position that is not a decision for the learner's colour;
- a `positionId` that does not belong to the claimed line;
- an unknown line, session or course.

Batch attempts are keyed by `(sessionId, lineId, attemptIndex)` and inserted with
`on conflict do nothing`, so a client retry after a dropped response is idempotent rather than
double-counting.

---

## Performance rules that are enforced

PRD §99 requires 10 lines in under 10 minutes, no per-move server requests, no page reloads.

- The whole opening tree is served once per course by `GET /api/courses/[slug]/tree`
  (`Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`) and cached in
  `localStorage` under `tree:v1:<courseId>`.
- Move validation and board rendering use `chess.js` in the browser. **No move validation happens
  on the server in the hot path.**
- Training is a single client component; advancing a line never navigates.
- Attempts are batched and retried from an in-memory queue, so a brief network drop does not lose
  a session.

---

## API

| Route | Purpose |
| --- | --- |
| `GET /api/courses?search=&side=` | catalogue, summaries only |
| `GET /api/courses/[slug]` | one course + line summaries |
| `GET /api/courses/[slug]/tree` | full opening tree for offline play |
| `GET /api/progress` | dashboard snapshot |
| `GET /api/progress/due?limit=` | due + weak lines, worst first |
| `POST /api/training/session` | start a session; returns the cohort plan |
| `POST /api/training/attempt` | batch of 1–50 judged attempts |
| `POST /api/training/session/complete` | finish; recomputes the score server-side |

Errors are `{ "error": { "code", "message", "details?" } }` with 400 / 404 / 409 / 500.

---

## Course content

`lib/content/caro-kann.ts` defines one course: 17 original lines, 178 positions, 126 decisions,
~31 minutes of estimated study. Every line was written for this project — no copied explanations.

```ts
{
  id: "advance-main",
  name: "Advance: the main line",
  description: "…",
  eco: "B12",
  difficulty: 3,
  moves: [
    { san: "c6", explanation: "…", frequency: 0.42 },
    { san: "d5", explanation: "…", frequency: 0.62 },
    // …
  ],
}
```

Lines must be legal in *their own* move order — the validator replays every line with `chess.js`.
It also fails a course if any move lacks an explanation, or if a repeated position has two moves
that claim to be the main line. Run `npm run validate:content` after editing content.

`explanation` is attached to a *move edge*, which is shared by every line passing through it, so
the builder merges explanations across lines. To give one line its own wording, add an
`id`-specific override in `lib/content/caro-kann.ts` rather than editing the shared object.

---

## Testing

```
tests/zobrist.test.ts              hash stability, castling/en-passant sensitivity
tests/tree.test.ts                 tree building, transposition dedup, illegal-line handling
tests/training-engine.test.ts      move judging, hints, alternatives, learner colour
tests/scheduler.test.ts            intervals, status transitions, lapses, ease factor
tests/cohort.test.ts               bucket shares, starvation, unlock gating
tests/scoring.test.ts              streaks, speed bonus, session score
tests/difficulty.test.ts           weights, personal difficulty, labels
tests/schema-parity.test.ts        SQLite DDL matches the Postgres migration
tests/integration/training-flow.test.ts
                                   the PRD §102 flow against a real in-memory database
tests/components/ChessBoard.test.tsx
                                   click-to-move, drag, promotion, orientation, inertness
```

Integration tests run against `createMemoryStore()` with the real seeded course, so they exercise
the actual repositories and SQL rather than mocks.

The component tests found a real off-by-one in the pointer-to-square mapping (drag was computing
`7 - row` instead of `8 - row`), which click-to-move could not catch because clicks read the
square from the DOM.

---

## Known limitations

- **No authentication.** `lib/auth/current-user.ts` returns one fixed local UUID. The function
  boundary is the only thing that has to change to add real auth; the RLS policies are already
  written for it.
- **One course.** The registry is a list; adding a course is a new file in `lib/content/`.
- **Unicode chess glyphs, not an image set.** Legible at every size with zero assets, but not
  tournament-style pieces.
- **No Playwright.** Client behaviour is covered by component tests plus `curl` against the
  running SSR routes.
- `node:sqlite` prints an `ExperimentalWarning` on Node 22. It is stable for this use.
