/**
 * SQLite mirror of `supabase/migrations/0001_init.sql`.
 *
 * The Postgres migration is the source of truth; this is the local-first
 * development adapter so the prototype runs with zero external services.
 * `tests/schema-parity.test.ts` parses both files and fails if the table or
 * column sets drift.
 *
 * Type mapping: uuid/timestamptz -> TEXT (ISO-8601 UTC), numeric -> REAL,
 * boolean -> INTEGER 0/1, text[] -> TEXT (JSON).
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_STATEMENTS: string[] = [
  `create table if not exists profiles (
    id          text primary key,
    username    text unique,
    created_at  text not null,
    updated_at  text not null
  )`,

  `create table if not exists course_authors (
    id          text primary key,
    name        text not null,
    title       text,
    bio         text,
    created_at  text not null
  )`,

  `create table if not exists courses (
    id           text primary key,
    slug         text not null unique,
    name         text not null,
    description  text not null default '',
    side         text not null check (side in ('white', 'black')),
    eco          text,
    difficulty   integer not null default 1 check (difficulty between 1 and 5),
    status       text not null default 'draft'
                   check (status in ('draft', 'review', 'published', 'archived')),
    root_fen     text not null,
    author_id    text references course_authors (id) on delete set null,
    tags         text not null default '[]',
    created_at   text not null,
    updated_at   text not null
  )`,

  `create table if not exists positions (
    id                  text primary key,
    course_id           text not null references courses (id) on delete cascade,
    fen                 text not null,
    zobrist_hash        text not null,
    parent_position_id  text references positions (id) on delete set null,
    ply                 integer not null,
    side_to_move        text not null check (side_to_move in ('w', 'b')),
    depth               integer not null default 0,
    opening_name        text,
    eco                 text,
    evaluation          real,
    best_move           text,
    constraint uq_positions_course_hash unique (course_id, zobrist_hash)
  )`,

  `create table if not exists moves (
    id                text primary key,
    course_id         text not null references courses (id) on delete cascade,
    position_id       text not null references positions (id) on delete cascade,
    next_position_id  text not null references positions (id) on delete cascade,
    uci               text not null,
    san               text not null,
    is_expected       integer not null default 1,
    frequency         real not null default 0 check (frequency between 0 and 1),
    priority          integer not null default 0,
    explanation       text,
    games             integer,
    constraint uq_moves_position_uci unique (position_id, uci)
  )`,

  `create table if not exists course_lines (
    id                text primary key,
    course_id         text not null references courses (id) on delete cascade,
    root_position_id  text not null references positions (id) on delete cascade,
    name              text not null,
    description       text not null default '',
    move_count        integer not null,
    ply_count         integer not null,
    difficulty        integer not null default 1 check (difficulty between 1 and 5),
    sort_order        integer not null default 0,
    eco               text
  )`,

  `create table if not exists course_line_moves (
    line_id  text not null references course_lines (id) on delete cascade,
    seq      integer not null,
    move_id  text not null references moves (id) on delete cascade,
    primary key (line_id, seq)
  )`,

  `create table if not exists user_course_progress (
    id               text primary key,
    user_id          text not null references profiles (id) on delete cascade,
    course_id        text not null references courses (id) on delete cascade,
    unlocked_lines   integer not null default 10,
    lines_attempted  integer not null default 0,
    lines_mastered   integer not null default 0,
    total_sessions   integer not null default 0,
    last_trained_at  text,
    updated_at       text not null,
    constraint uq_user_course unique (user_id, course_id)
  )`,

  `create table if not exists user_line_progress (
    id               text primary key,
    user_id          text not null references profiles (id) on delete cascade,
    line_id          text not null references course_lines (id) on delete cascade,
    status           text not null default 'NEW'
                       check (status in ('NEW', 'LEARNING', 'REVIEW', 'MASTERED')),
    repetitions      integer not null default 0,
    correct_count    integer not null default 0,
    incorrect_count  integer not null default 0,
    lapses           integer not null default 0,
    streak           integer not null default 0,
    ease_factor      real not null default 2.5,
    interval_seconds integer not null default 0,
    accuracy         real not null default 0,
    last_attempt_at  text,
    next_review_at   text,
    created_at       text not null,
    updated_at       text not null,
    constraint uq_user_line unique (user_id, line_id)
  )`,

  `create table if not exists training_sessions (
    id               text primary key,
    user_id          text not null references profiles (id) on delete cascade,
    course_id        text not null references courses (id) on delete cascade,
    mode             text not null check (mode in ('learn', 'practice', 'drill', 'time_trial')),
    started_at       text not null,
    ended_at         text,
    score            integer not null default 0,
    accuracy         real not null default 0,
    lines_attempted  integer not null default 0,
    lines_completed  integer not null default 0,
    mistakes         integer not null default 0,
    hints_used       integer not null default 0
  )`,

  `create table if not exists training_attempts (
    id             text primary key,
    session_id     text not null references training_sessions (id) on delete cascade,
    user_id        text not null references profiles (id) on delete cascade,
    course_id      text not null references courses (id) on delete cascade,
    line_id        text not null references course_lines (id) on delete cascade,
    position_id    text not null references positions (id) on delete cascade,
    move_uci       text,
    expected_uci   text,
    correct        integer not null default 0,
    legal          integer not null default 0,
    hint_used      integer not null default 0,
    elapsed_ms     integer not null default 0,
    attempt_index  integer not null default 0,
    created_at     text not null
  )`,

  // Indexes (PRD §38). These are the queries that drive "today's training".
  `create index if not exists idx_courses_status on courses (status)`,
  `create index if not exists idx_courses_side on courses (side)`,
  `create index if not exists idx_positions_hash on positions (zobrist_hash)`,
  `create index if not exists idx_positions_course on positions (course_id, depth)`,
  `create index if not exists idx_moves_position on moves (position_id)`,
  `create index if not exists idx_moves_next on moves (next_position_id)`,
  `create index if not exists idx_course_lines_course on course_lines (course_id, sort_order)`,
  `create index if not exists idx_course_line_moves_move on course_line_moves (move_id)`,
  `create index if not exists idx_user_course on user_course_progress (user_id, course_id)`,
  `create index if not exists idx_user_line_review on user_line_progress (user_id, next_review_at)`,
  `create index if not exists idx_user_line_status on user_line_progress (user_id, status)`,
  `create index if not exists idx_sessions_user on training_sessions (user_id, started_at desc)`,
  `create index if not exists idx_sessions_course on training_sessions (course_id, started_at desc)`,
  `create index if not exists idx_attempts_session on training_attempts (session_id, attempt_index)`,
  `create index if not exists idx_attempts_user_line on training_attempts (user_id, line_id, created_at desc)`,
];
