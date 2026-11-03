/**
 * One database interface, two drivers.
 *
 * ## Why the interface is async
 *
 * SQLite's built-in driver is synchronous and Postgres is not. An interface that
 * pretended otherwise would either force every call site to be synchronous (which
 * Postgres cannot satisfy) or hide a `Promise` behind a synchronous signature
 * (which is how a transaction quietly stops being one). So every method returns a
 * promise, and the SQLite driver simply resolves immediately.
 *
 * ## Why the SQL is written once
 *
 * Parameters are always `?`. The Postgres driver rewrites them to `$1…$n`, which
 * is the only difference that would otherwise force every statement to exist
 * twice. Types are restricted to a portable subset — `TEXT`, `INTEGER`,
 * `REAL` — identifiers are application-generated UUIDs, timestamps are ISO-8601
 * text and booleans are `0`/`1` integers. Nothing needs `SERIAL`, `uuid`,
 * `jsonb` or `timestamptz`, so there is one set of migrations rather than two.
 *
 * The trade-off is deliberate: Postgres-native types would be marginally faster
 * and would need a second migration set plus a second migration runner, and the
 * two would drift.
 *
 * ## What this interface deliberately does not do
 *
 * - No ORM. The queries are SQL because half of them are reporting queries that an
 *   ORM expresses badly, and because a wrong join should be visible in review.
 * - No connection-pool management beyond what the driver does. One `Db` is one
 *   pool.
 * - No nested transactions. `transaction()` runs a callback inside one
 *   transaction and refuses to start another while one is open, because a silent
 *   savepoint is how a partial write looks like a complete one.
 */

/** A value that may be bound as a parameter. */
export type SqlValue = string | number | null | boolean;

/** The result of a statement that changes rows. */
export interface RunResult {
  /** Rows affected. 0 for an `UPDATE … WHERE` that matched nothing. */
  changes: number;
}

/** The database, whichever driver is behind it. */
export interface Db {
  readonly driver: 'sqlite' | 'postgres';

  /** Every row the query returns. */
  all<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;

  /** The first row, or `null`. */
  get<T = Record<string, unknown>>(
    sql: string,
    params?: readonly SqlValue[],
  ): Promise<T | null>;

  /** Run a statement and report how many rows it changed. */
  run(sql: string, params?: readonly SqlValue[]): Promise<RunResult>;

  /** Run one or more statements with no parameters. Used by migrations only. */
  exec(sql: string): Promise<void>;

  /**
   * Run `fn` inside a transaction: commit if it resolves, roll back if it throws.
   *
   * The callback receives the same `Db`, so a repository method written against the
   * interface composes without knowing whether it is inside a transaction.
   */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;

  /** Release the connection or pool. */
  close(): Promise<void>;
}

/**
 * Rewrite `?` placeholders to Postgres `$1…$n`.
 *
 * A `?` inside a string literal or a quoted identifier is not a placeholder, so the
 * scan tracks quotes. Postgres also accepts `??` and `?|` operators on `jsonb`; the
 * portable subset this project restricts itself to never uses them, and if one
 * appears the scan would corrupt it — which is why the restriction is stated in the
 * module comment rather than assumed.
 */
export function toPostgresPlaceholders(sql: string): string {
  let out = '';
  let index = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];

    if (ch === "'" && !inDouble) {
      // A doubled quote inside a literal is an escaped quote, not a close.
      if (inSingle && sql[i + 1] === "'") {
        out += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      out += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      out += ch;
      continue;
    }
    if (ch === '?' && !inSingle && !inDouble) {
      index += 1;
      out += `$${index}`;
      continue;
    }
    out += ch;
  }
  return out;
}
