-- =============================================================================
-- Learn Chess Opening — initial schema (PRD §35–§38)
--
-- This file is the source of truth for the data model. The local-first
-- development adapter (`lib/db/schema.ts`) mirrors it table-for-table; the test
-- in `tests/schema-parity.test.ts` fails if the two drift apart.
--
-- Architecture principle (PRD §92):
--   CONTENT         courses, course_authors, course_lines, course_line_moves,
--                   positions, moves                 -> immutable, generated
--   TRAINING STATE  training_sessions, training_attempts -> server-authoritative
--   USER STATE      profiles, user_course_progress, user_line_progress
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- User state
-- ---------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Content
-- ---------------------------------------------------------------------------

create table public.course_authors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  title       text,
  bio         text,
  created_at  timestamptz not null default now()
);

create table public.courses (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  description  text not null default '',
  side         text not null check (side in ('white', 'black')),
  eco          text,
  difficulty   integer not null default 1 check (difficulty between 1 and 5),
  status       text not null default 'draft'
                 check (status in ('draft', 'review', 'published', 'archived')),
  root_fen     text not null,
  author_id    uuid references public.course_authors (id) on delete set null,
  tags         text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_courses_status on public.courses (status);
create index idx_courses_side on public.courses (side);

-- One node per distinct position in a course. Transpositions collapse here.
create table public.positions (
  id                  uuid primary key default gen_random_uuid(),
  course_id           uuid not null references public.courses (id) on delete cascade,
  fen                 text not null,
  zobrist_hash        text not null,
  parent_position_id  uuid references public.positions (id) on delete set null,
  ply                 integer not null,
  side_to_move        text not null check (side_to_move in ('w', 'b')),
  depth               integer not null default 0,
  opening_name        text,
  eco                 text,
  evaluation          numeric,
  best_move           text,
  constraint uq_positions_course_hash unique (course_id, zobrist_hash)
);

create index idx_positions_hash on public.positions (zobrist_hash);
create index idx_positions_course on public.positions (course_id, depth);

create table public.moves (
  id                uuid primary key default gen_random_uuid(),
  course_id         uuid not null references public.courses (id) on delete cascade,
  position_id       uuid not null references public.positions (id) on delete cascade,
  next_position_id  uuid not null references public.positions (id) on delete cascade,
  uci               text not null,
  san               text not null,
  is_expected       boolean not null default true,
  frequency         numeric not null default 0 check (frequency between 0 and 1),
  priority          integer not null default 0,
  explanation       text,
  games             integer,
  constraint uq_moves_position_uci unique (position_id, uci)
);

create index idx_moves_position on public.moves (position_id);
create index idx_moves_next on public.moves (next_position_id);

create table public.course_lines (
  id                uuid primary key default gen_random_uuid(),
  course_id         uuid not null references public.courses (id) on delete cascade,
  root_position_id  uuid not null references public.positions (id) on delete cascade,
  name              text not null,
  description       text not null default '',
  move_count        integer not null,   -- learner decisions, not plies
  ply_count         integer not null,
  difficulty        integer not null default 1 check (difficulty between 1 and 5),
  sort_order        integer not null default 0,
  eco               text
);

create index idx_course_lines_course on public.course_lines (course_id, sort_order);

-- Ordered edge list for a line. Needed because a line is a *path* through the
-- shared graph: the opponent's replies are properties of the path, not of the
-- position. (Addition to PRD §37 — see README.)
create table public.course_line_moves (
  line_id     uuid not null references public.course_lines (id) on delete cascade,
  seq         integer not null,
  move_id     uuid not null references public.moves (id) on delete cascade,
  primary key (line_id, seq)
);

create index idx_course_line_moves_move on public.course_line_moves (move_id);

-- ---------------------------------------------------------------------------
-- User progress
-- ---------------------------------------------------------------------------

create table public.user_course_progress (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  course_id        uuid not null references public.courses (id) on delete cascade,
  unlocked_lines   integer not null default 10,
  lines_attempted  integer not null default 0,
  lines_mastered   integer not null default 0,
  total_sessions   integer not null default 0,
  last_trained_at  timestamptz,
  updated_at       timestamptz not null default now(),
  constraint uq_user_course unique (user_id, course_id)
);

create index idx_user_course on public.user_course_progress (user_id, course_id);

-- The spaced-repetition record (PRD §21–§22).
create table public.user_line_progress (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  line_id          uuid not null references public.course_lines (id) on delete cascade,
  status           text not null default 'NEW'
                     check (status in ('NEW', 'LEARNING', 'REVIEW', 'MASTERED')),
  repetitions      integer not null default 0,  -- lifetime correct answers
  correct_count    integer not null default 0,
  incorrect_count  integer not null default 0,
  lapses           integer not null default 0,
  streak           integer not null default 0,  -- consecutive correct: the clock
  ease_factor      numeric not null default 2.5,
  interval_seconds integer not null default 0,
  accuracy         numeric not null default 0,
  last_attempt_at  timestamptz,
  next_review_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint uq_user_line unique (user_id, line_id)
);

-- PRD §38: this is the query that drives "today's training".
create index idx_user_line_review on public.user_line_progress (user_id, next_review_at);
create index idx_user_line_status on public.user_line_progress (user_id, status);

-- ---------------------------------------------------------------------------
-- Training state
-- ---------------------------------------------------------------------------

create table public.training_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  course_id        uuid not null references public.courses (id) on delete cascade,
  mode             text not null check (mode in ('learn', 'practice', 'drill', 'time_trial')),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  score            integer not null default 0,
  accuracy         numeric not null default 0,
  lines_attempted  integer not null default 0,
  lines_completed  integer not null default 0,
  mistakes         integer not null default 0,
  hints_used       integer not null default 0
);

create index idx_sessions_user on public.training_sessions (user_id, started_at desc);
create index idx_sessions_course on public.training_sessions (course_id, started_at desc);

-- The attempt log is what makes scoring server-verifiable (PRD §57): the score
-- is recomputed from these rows, never trusted from the client.
create table public.training_attempts (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.training_sessions (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  course_id      uuid not null references public.courses (id) on delete cascade,
  line_id        uuid not null references public.course_lines (id) on delete cascade,
  position_id    uuid not null references public.positions (id) on delete cascade,
  move_uci       text,                 -- null when the input was not even legal
  expected_uci   text,
  correct        boolean not null default false,
  legal          boolean not null default false,
  hint_used      boolean not null default false,
  elapsed_ms     integer not null default 0,
  attempt_index  integer not null default 0,
  created_at     timestamptz not null default now()
);

create index idx_attempts_session on public.training_attempts (session_id, attempt_index);
create index idx_attempts_user_line on public.training_attempts (user_id, line_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security (PRD §67, §68)
-- ---------------------------------------------------------------------------

alter table public.profiles             enable row level security;
alter table public.course_authors       enable row level security;
alter table public.courses              enable row level security;
alter table public.positions            enable row level security;
alter table public.moves                enable row level security;
alter table public.course_lines         enable row level security;
alter table public.course_line_moves    enable row level security;
alter table public.user_course_progress enable row level security;
alter table public.user_line_progress   enable row level security;
alter table public.training_sessions    enable row level security;
alter table public.training_attempts    enable row level security;

-- Everyone (including anonymous visitors) can read published course content.
create policy "published courses are public"
  on public.courses for select
  using (status = 'published');

create policy "course content is public"
  on public.positions for select
  using (exists (
    select 1 from public.courses c
    where c.id = course_id and c.status = 'published'
  ));

create policy "moves are public"
  on public.moves for select
  using (exists (
    select 1 from public.courses c
    where c.id = course_id and c.status = 'published'
  ));

create policy "lines are public"
  on public.course_lines for select
  using (exists (
    select 1 from public.courses c
    where c.id = course_id and c.status = 'published'
  ));

create policy "line moves are public"
  on public.course_line_moves for select
  using (exists (
    select 1 from public.course_lines l
    where l.id = line_id and exists (
      select 1 from public.courses c where c.id = l.course_id and c.status = 'published'
    )
  ));

create policy "authors are public"
  on public.course_authors for select
  using (true);

-- Users read and write only their own rows.
create policy "own profile"
  on public.profiles for all
  using (auth.uid() = id) with check (auth.uid() = id);

create policy "own course progress"
  on public.user_course_progress for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own line progress"
  on public.user_line_progress for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own sessions"
  on public.training_sessions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own attempts"
  on public.training_attempts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Course content is written only by the offline import pipeline / admin roles,
-- never by end users: there are deliberately no insert/update policies above.
-- Admin access is granted via a `service_role` bypass or an `is_admin` claim in
-- a later migration once the CMS in PRD §50 lands.
