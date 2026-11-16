/**
 * Test-only helpers for a Postgres database.
 *
 * ## Why this is in the package and not in each test folder
 *
 * Two packages run destructive suites against Postgres — `@sq/db` and `@sq/api` — and Turborepo runs
 * them **in parallel**. Both used to open SQLite `:memory:` and were therefore invisible to each
 * other; on Postgres they share a server, so a reset in one suite would empty tables under the other.
 *
 * The answer has two halves: each package gets its **own database name** (the API suite uses
 * `TEST_DATABASE_URL`, the `@sq/db` suite appends `_db` to it), and the destructive helper lives here
 * so both use one implementation that refuses a database whose name does not say `test`.
 */

import type { Db } from './driver.js';

/**
 * The database name inside a Postgres URL.
 *
 * `new URL` is used rather than string splitting because a URL may carry a query string, an IPv6
 * host or an encoded password — all of which break a naive `split('/').pop()`.
 */
export function databaseNameOf(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname.replace(/^\//, '');
}

/**
 * Refuse a URL whose database name does not contain `test`.
 *
 * This is the guard that makes "drop every table" safe to expose. A typo in an environment variable
 * is the realistic failure, and the difference between `smartquote_test` and `smartquote` is four
 * characters and every quote in the company.
 */
export function assertTestDatabase(url: string, variable: string): void {
  const name = databaseNameOf(url);
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run a destructive test suite against "${name}". ` +
        `Point ${variable} at a database whose name contains "test".`,
    );
  }
}

/**
 * The same URL with a different database name.
 *
 * Kept for a deployment that gives the test role `CREATEDB`; the shipped setup deliberately does
 * not (see below), so the suites use `withSchema` instead.
 */
export function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/**
 * The same URL with `search_path` pinned to `schema`, creating nothing.
 *
 * ## Why a schema and not a second database
 *
 * The plan for this work asked each destructive suite to use its own database (`<name>_db`), because
 * Turborepo runs `@sq/db` and `@sq/api` **in parallel** and both drop every table. A second database
 * needs `CREATEDB`, and the setup script deliberately does not grant it — a connection that can
 * create a database is worth far more than the data it guards, and the whole point of provisioning
 * being a superuser's job is that the application credential cannot reshape the server.
 *
 * A **schema** gives the same isolation with a grant the role already has: the two suites see
 * different sets of tables, both can drop theirs freely, and nothing about the server's security
 * changes. `search_path` travels on the connection, so no migration or repository has to know.
 *
 * The cost is that `public` in the test database is unused; the toys in it are the API suite's, which
 * passes its URL untouched.
 */
export function withSchema(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('options', `-c search_path=${schema}`);
  return parsed.toString();
}

/** The schema the current connection resolves unqualified names in. */
export async function currentSchemaName(db: Db): Promise<string> {
  const row = await db.get<{ schema: string }>('SELECT current_schema() AS schema');
  return row?.schema ?? 'public';
}

/**
 * Drop every table in the connection's own schema, and the trigger function the migrations create.
 *
 * **Schema-scoped, not database-scoped.** Both destructive suites share one database and are told
 * apart by `search_path` (`withSchema`), so dropping `public` would drop the other suite's tables.
 * `current_schema()` is the answer to "which tables are mine" and it needs no configuration.
 *
 * `CASCADE` takes dependent objects with its table. The quote-revision trigger function is dropped
 * explicitly because it is not owned by a table — leaving it behind makes the next migration run fail
 * with "function already exists" on a schema that looks empty.
 */
export async function dropAllTablesForTests(db: Db): Promise<void> {
  const schema = await currentSchemaName(db);
  const rows = await db.all<{ tablename: string }>(
    'SELECT tablename FROM pg_tables WHERE schemaname = ?',
    [schema],
  );
  if (rows.length > 0) {
    const list = rows.map((row) => `"${schema}"."${row.tablename}"`).join(', ');
    await db.exec(`DROP TABLE IF EXISTS ${list} CASCADE`);
  }
  await db.exec('DROP FUNCTION IF EXISTS quote_revisions_refuse_write() CASCADE');
}

/**
 * Create `schema` if it is absent. Safe to call on every run.
 *
 * Idempotent by `IF NOT EXISTS` rather than by checking first: two suites starting at once would
 * otherwise both see "absent" and one would fail on the duplicate.
 */
export async function ensureSchema(db: Db, schema: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error(`Refusing an unexpected schema name: ${schema}`);
  }
  await db.exec(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
}
