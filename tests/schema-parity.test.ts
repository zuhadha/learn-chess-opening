import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SCHEMA_STATEMENTS } from "@/lib/db/schema";

/**
 * The Postgres migration is the source of truth and the SQLite file is the
 * local-first adapter. They are two hand-maintained copies of the same model,
 * so this test fails the moment they drift — otherwise a column added in
 * Postgres silently disappears from local runs.
 */

const ROOT = process.cwd();
const MIGRATION = path.join(ROOT, "supabase", "migrations", "0001_init.sql");
const INDEXES = path.join(ROOT, "supabase", "migrations", "0001_init.sql");

interface Table {
  columns: string[];
}

/** Strip `--` line comments: they can contain commas and would corrupt parsing. */
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function parseTables(sql: string, prefix: string): Map<string, Table> {
  const tables = new Map<string, Table>();
  sql = stripComments(sql);
  const pattern = new RegExp(
    `create table (?:if not exists )?(?:${prefix}\\.)?(\\w+)\\s*\\(`,
    "gi",
  );

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    const name = match[1]!.toLowerCase();
    const bodyStart = match.index + match[0].length;
    const body = readBalanced(sql, bodyStart);
    tables.set(name, { columns: parseColumns(body) });
  }
  return tables;
}

/** Read from `start` (just after an opening paren) to its matching close. */
function readBalanced(sql: string, start: number): string {
  let depth = 1;
  for (let i = start; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return sql.slice(start, i);
    }
  }
  throw new Error("unbalanced parentheses in DDL");
}

function parseColumns(body: string): string[] {
  const items = splitTopLevel(body);
  const columns: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (/^(constraint|primary key|unique|check|foreign key)\b/i.test(trimmed)) continue;
    const name = trimmed.split(/\s+/)[0]?.replace(/[",]/g, "").toLowerCase();
    if (name) columns.push(name);
  }
  return columns;
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

const postgres = parseTables(fs.readFileSync(MIGRATION, "utf8"), "public");
const sqlite = parseTables(SCHEMA_STATEMENTS.join(";\n"), "");

describe("schema parity between Postgres and the local SQLite adapter", () => {
  it("found tables in both dialects", () => {
    expect(postgres.size).toBeGreaterThan(0);
    expect(sqlite.size).toBeGreaterThan(0);
  });

  it("defines the same set of tables", () => {
    expect([...sqlite.keys()].sort()).toEqual([...postgres.keys()].sort());
  });

  it("defines the same columns per table", () => {
    for (const [name, table] of sqlite) {
      const pg = postgres.get(name);
      expect(pg, `table ${name} missing from the migration`).toBeDefined();
      expect([...table.columns].sort(), `columns of ${name}`).toEqual(
        [...(pg?.columns ?? [])].sort(),
      );
    }
  });

  it("ships the indexes PRD §38 calls critical", () => {
    const sql = fs.readFileSync(INDEXES, "utf8");
    for (const index of [
      "idx_user_line_review",
      "idx_user_course",
      "idx_moves_position",
      "idx_positions_hash",
    ]) {
      expect(sql).toContain(index);
      expect(SCHEMA_STATEMENTS.join("\n")).toContain(index);
    }
  });

  it("enables row level security on every table", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    for (const name of postgres.keys()) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${name}\\s+enable row level security`));
    }
  });

  it("never lets users read or write another user's rows", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    for (const table of ["user_line_progress", "user_course_progress", "training_sessions", "training_attempts"]) {
      const policy = new RegExp(
        `on public\\.${table} for all\\s+using \\(auth\\.uid\\(\\) = user_id\\)`,
      );
      expect(sql, `${table} policy`).toMatch(policy);
    }
  });

  it("does not expose draft courses to the public", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    expect(sql).toContain("using (status = 'published')");
  });
});
