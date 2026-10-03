/**
 * Local-first SQLite adapter.
 *
 * Uses Node's built-in `node:sqlite` so the prototype needs no native modules
 * and no external database service. The rest of the app talks to `LocalStore`
 * only — swapping in Supabase means implementing the same handful of methods
 * against `supabase-js` (see README → "Swapping in Supabase").
 *
 * The handle is a process-wide singleton: Next.js route handlers, the seed
 * scripts and the tests all share one connection per process.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from "@/lib/db/schema";

export type SqlParam = string | number | bigint | boolean | null | undefined | Uint8Array;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/** SQLite has no boolean affinity — coerce on the way in. */
function bind(params: SqlParam[]): (string | number | bigint | null | Uint8Array)[] {
  return params.map((param) => {
    if (param === undefined || param === null) return null;
    if (typeof param === "boolean") return param ? 1 : 0;
    return param;
  });
}

export class LocalStore {
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  readonly path: string;

  constructor(file: string) {
    this.path = file;
    if (file !== ":memory:") {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    this.db = new DatabaseSync(file);
    this.db.exec("pragma journal_mode = wal");
    this.db.exec("pragma foreign_keys = on");
    this.db.exec("pragma busy_timeout = 5000");
  }

  private prepare(sql: string): StatementSync {
    const cached = this.statements.get(sql);
    if (cached) return cached;
    const statement = this.db.prepare(sql);
    this.statements.set(sql, statement);
    return statement;
  }

  run(sql: string, params: SqlParam[] = []): RunResult {
    const result = this.prepare(sql).run(...bind(params));
    return {
      changes: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  get<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): T | undefined {
    const row = this.prepare(sql).get(...bind(params));
    return row === undefined ? undefined : ({ ...row } as T);
  }

  all<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): T[] {
    return this.prepare(sql)
      .all(...bind(params))
      .map((row) => ({ ...row }) as T);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  /** Run `fn` inside a transaction; nested calls join the outer transaction. */
  transaction<T>(fn: () => T): T {
    this.db.exec("begin");
    try {
      const result = fn();
      this.db.exec("commit");
      return result;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  /** PRAGMA user_version doubles as the migration marker. */
  userVersion(): number {
    const row = this.get<{ user_version: number }>("pragma user_version");
    return row?.user_version ?? 0;
  }

  migrate(): { applied: number; version: number } {
    const before = this.userVersion();
    if (before >= SCHEMA_VERSION) return { applied: 0, version: before };
    this.transaction(() => {
      for (const statement of SCHEMA_STATEMENTS) this.db.exec(statement);
      this.db.exec(`pragma user_version = ${SCHEMA_VERSION}`);
    });
    return { applied: SCHEMA_STATEMENTS.length, version: SCHEMA_VERSION };
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }
}

/* -------------------------------------------------------------------------- */
/* Singleton                                                                   */
/* -------------------------------------------------------------------------- */

export const DATABASE_FILE =
  process.env.DATABASE_FILE ?? path.join(process.cwd(), "data", "learn-chess-opening.sqlite");

// Next.js reloads modules on hot-reload; hanging the handle off globalThis keeps
// one connection (and one set of prepared statements) per dev-server process.
const globalForStore = globalThis as unknown as {
  __learnChessStore?: LocalStore;
};

export function getStore(): LocalStore {
  if (!globalForStore.__learnChessStore) {
    const store = new LocalStore(DATABASE_FILE);
    // Idempotent: a no-op once `user_version` is current, so a fresh clone works
    // without a separate setup step.
    store.migrate();
    globalForStore.__learnChessStore = store;
  }
  return globalForStore.__learnChessStore;
}

/**
 * Convenience for tests and scripts: an in-memory store with the schema applied.
 */
export function createMemoryStore(): LocalStore {
  const store = new LocalStore(":memory:");
  store.migrate();
  return store;
}
