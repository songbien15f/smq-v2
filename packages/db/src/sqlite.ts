/**
 * The SQLite driver, over Node's built-in `node:sqlite`.
 *
 * `node:sqlite` is synchronous, so nothing here is faked: each method resolves
 * immediately with the value the driver returned. The promise wrapper exists only
 * to satisfy the shared interface.
 *
 * WAL mode and foreign keys are set on open. Both matter:
 *
 * - WAL lets a read run while a write is in flight, which is what a second browser
 *   tab does on every quote screen.
 * - Foreign keys are **off by default** in SQLite. Without the pragma, a cascade
 *   the schema declares silently does nothing, and an orphan row looks like data.
 */

import { DatabaseSync } from './sqliteRuntime.js';
import type { Db, RunResult, SqlValue } from './driver.js';

/** Options for opening a SQLite database. */
export interface SqliteOptions {
  /** Path to the file, or `:memory:` for a throwaway database in a test. */
  file: string;
  /** Milliseconds to wait for a lock before failing. Default 5000. */
  busyTimeoutMs?: number;
}

/** Normalise a bound value into something `node:sqlite` accepts. */
function bind(value: SqlValue): string | number | null {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/** Open a SQLite database as a `Db`. */
export function createSqliteDb(options: SqliteOptions): Db {
  const sqlite = new DatabaseSync(options.file);

  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(`PRAGMA busy_timeout = ${Math.max(0, options.busyTimeoutMs ?? 5000)}`);

  let inTransaction = false;

  const db: Db = {
    driver: 'sqlite',

    async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
      const statement = sqlite.prepare(sql);
      return statement.all(...params.map(bind)) as T[];
    },

    async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
      const statement = sqlite.prepare(sql);
      const row = statement.get(...params.map(bind));
      return (row ?? null) as T | null;
    },

    async run(sql: string, params: readonly SqlValue[] = []): Promise<RunResult> {
      const statement = sqlite.prepare(sql);
      const result = statement.run(...params.map(bind));
      return { changes: Number(result.changes) };
    },

    async exec(sql: string): Promise<void> {
      sqlite.exec(sql);
    },

    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      // Refusing a nested transaction rather than opening a savepoint: a caller
      // that thinks it started a transaction but only got a savepoint will not see
      // its earlier writes rolled back when it fails.
      if (inTransaction) {
        throw new Error(
          'A transaction is already open. Nested transactions are refused: compose the operations into one transaction instead of nesting them.',
        );
      }
      inTransaction = true;
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(db);
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      } finally {
        inTransaction = false;
      }
    },

    async close(): Promise<void> {
      sqlite.close();
    },
  };

  return db;
}
