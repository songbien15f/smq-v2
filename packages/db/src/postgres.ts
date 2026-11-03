/**
 * The Postgres driver, over `pg`.
 *
 * Statements written with `?` placeholders are rewritten to `$1…$n` before they
 * are sent, so the migrations and the repositories are one set of SQL.
 *
 * `INTEGER` booleans arrive from Postgres as `0`/`1` because the column type is
 * `INTEGER`, not `BOOLEAN` — that is the portable choice made in `driver.ts`, and
 * it means a repository reads a flag as a number in both drivers rather than
 * handling `true` in one place and `1` in another.
 */

import { Pool } from 'pg';
import type { Db, RunResult, SqlValue } from './driver.js';
import { toPostgresPlaceholders } from './driver.js';

/** Options for opening a Postgres connection. */
export interface PostgresOptions {
  /** A `postgres://` URL. */
  url: string;
  /** Pool size. Default 10, which is well under a default `max_connections`. */
  max?: number;
  /** Refuse to wait forever for a connection. Default 5000 ms. */
  connectionTimeoutMs?: number;
}

/** Normalise a bound value into something `pg` accepts. */
function bind(value: SqlValue): string | number | null {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/** Open a Postgres pool as a `Db`. */
export function createPostgresDb(options: PostgresOptions): Db {
  const pool = new Pool({
    connectionString: options.url,
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5000,
  });

  let inTransaction = false;

  const db: Db = {
    driver: 'postgres',

    async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
      const result = await pool.query(toPostgresPlaceholders(sql), params.map(bind));
      return result.rows as T[];
    },

    async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
      const result = await pool.query(toPostgresPlaceholders(sql), params.map(bind));
      return (result.rows[0] ?? null) as T | null;
    },

    async run(sql: string, params: readonly SqlValue[] = []): Promise<RunResult> {
      const result = await pool.query(toPostgresPlaceholders(sql), params.map(bind));
      return { changes: result.rowCount ?? 0 };
    },

    async exec(sql: string): Promise<void> {
      await pool.query(sql);
    },

    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      if (inTransaction) {
        throw new Error(
          'A transaction is already open. Nested transactions are refused: compose the operations into one transaction instead of nesting them.',
        );
      }
      inTransaction = true;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Run the callback against the *same client*, so every statement in the
        // transaction is on the connection that holds the transaction. Using the
        // pool here would put the writes on other connections and commit them
        // individually — the exact defect the old server shipped.
        const tx: Db = {
          driver: 'postgres',
          async all<R>(sql: string, params: readonly SqlValue[] = []): Promise<R[]> {
            const result = await client.query(toPostgresPlaceholders(sql), params.map(bind));
            return result.rows as R[];
          },
          async get<R>(sql: string, params: readonly SqlValue[] = []): Promise<R | null> {
            const result = await client.query(toPostgresPlaceholders(sql), params.map(bind));
            return (result.rows[0] ?? null) as R | null;
          },
          async run(sql: string, params: readonly SqlValue[] = []): Promise<RunResult> {
            const result = await client.query(toPostgresPlaceholders(sql), params.map(bind));
            return { changes: result.rowCount ?? 0 };
          },
          async exec(sql: string): Promise<void> {
            await client.query(sql);
          },
          transaction: () => {
            throw new Error('Nested transactions are refused.');
          },
          close: async () => {
            /* the outer transaction owns the client */
          },
        };
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        inTransaction = false;
        client.release();
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };

  return db;
}
