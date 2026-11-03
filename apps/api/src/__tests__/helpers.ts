/**
 * Test scaffolding: a real database, a real app, no network.
 *
 * Migrations run for real rather than a hand-built schema, so a test cannot pass against a
 * table definition that production does not have.
 *
 * **Which database**: SQLite by default — `:memory:`, so each file gets a clean one with no
 * cleanup step that can be forgotten. Set `TEST_DB_DRIVER=postgres` and the suite runs against
 * a real Postgres instead, which is the only way to know the portable SQL and the driver
 * adapter actually work there. That run **drops every table in the target database between
 * files**, so it refuses a URL whose database name does not contain `test` — a mistyped URL
 * must not empty a developer's development database.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { createPostgresDb, createSqliteDb, dialectFolderFor, migrate, newId, now } from '@sq/db';
import type { Db } from '@sq/db';
import type { ApiConfig } from '../config.js';
import { buildApp } from '../app.js';
import { hashPassword } from '../lib/password.js';

const MIGRATIONS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..', 'packages', 'db', 'migrations',
);

/**
 * The database behind each app `makeTestApp` built, keyed by the app.
 *
 * The sign-in key is now a company code plus a username, and 25 tests still call
 * `signIn(app, email, password)`. To send those through the real route without an in-memory
 * registry that would miss an account inserted by raw SQL, the helper reads the company from
 * here. Keyed on the app rather than kept as "the last one built", because a file can build more
 * than one app and close the earlier one while later tests still sign in against the first.
 */
const DB_BY_APP = new WeakMap<FastifyInstance, Db>();

/** A configuration that looks like production but is cheap to run. */
export function testConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    sessionSecret: 'test-secret-that-is-long-enough-to-be-accepted',
    sessionTtlHours: 8,
    sessionIdleHours: 1,
    allowedOrigins: ['http://localhost:3061'],
    production: false,
    ...overrides,
  };
}

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  close: () => Promise<void>;
}

/** The Postgres URL to test against, or `null` for SQLite. */
function postgresUrl(): string | null {
  if ((process.env.TEST_DB_DRIVER ?? '').toLowerCase() !== 'postgres') return null;

  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (url === undefined || url.trim() === '') {
    throw new Error('TEST_DB_DRIVER=postgres needs TEST_DATABASE_URL (or DATABASE_URL).');
  }

  // A suite that drops tables, pointed at a real database, is a destructive accident waiting
  // for a typo. The database name has to say `test`.
  const databaseName = url.split('/').pop()?.split('?')[0] ?? '';
  if (!/test/i.test(databaseName)) {
    throw new Error(
      `Refusing to run the destructive suite against a database named "${databaseName}". ` +
        'Point TEST_DATABASE_URL at a database whose name contains "test".',
    );
  }

  return url;
}

/**
 * Drop every table, so a file starts from nothing the way `:memory:` does.
 *
 * `CASCADE` takes dependent objects with their table, including the `quote_revisions` trigger
 * function, which the migration recreates.
 */
async function resetPostgres(db: Db): Promise<void> {
  const rows = await db.all<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );
  if (rows.length > 0) {
    const list = rows.map((row) => `"public"."${row.tablename}"`).join(', ');
    await db.exec(`DROP TABLE IF EXISTS ${list} CASCADE`);
  }
  await db.exec('DROP FUNCTION IF EXISTS quote_revisions_refuse_write() CASCADE');
}

/** Build an app over a fresh database. */
export async function makeTestApp(config: ApiConfig = testConfig()): Promise<TestApp> {
  const url = postgresUrl();
  const db = url === null ? createSqliteDb({ file: ':memory:' }) : createPostgresDb({ url });

  if (url !== null) await resetPostgres(db);

  await migrate(db, MIGRATIONS, join(MIGRATIONS, dialectFolderFor(db.driver)));

  const app = await buildApp({ db, config });
  DB_BY_APP.set(app, db);
  return {
    app,
    db,
    close: async () => {
      await app.close();
      await db.close();
    },
  };
}

/**
 * The code migration 009 would give a company seeded from this slug.
 *
 * `demo-sheds` → `DEMOSHEDS`: upper-cased, hyphens dropped, first ten characters. Kept identical
 * to the migration on purpose — a seeded company and a migrated one must be reachable the same
 * way, and a helper with its own rule would hide exactly the difference the migration test exists
 * to catch.
 */
function defaultCodeFromSlug(slug: string): string {
  return slug.replace(/-/g, '').slice(0, 10);
}

/**
 * Create a company with one user, at a known password.
 *
 * `code` defaults to what migration 009 would derive from the slug, and `username` to the local
 * part of the email — the same rules migration 009 applies to existing rows, so a seeded company
 * and a migrated one are reached the same way.
 */
export async function seedCompany(
  db: Db,
  input: {
    name: string;
    slug: string;
    code?: string;
    username?: string;
    seats?: number;
    role?: 'company_admin' | 'estimator' | 'viewer';
    email: string;
    password: string;
  },
): Promise<{ tenantId: string; userId: string; code: string; username: string }> {
  const tenantId = newId();
  const userId = newId();
  const at = now();
  const hash = await hashPassword(input.password);
  const code = (input.code ?? defaultCodeFromSlug(input.slug)).toUpperCase().slice(0, 16);
  const username = input.username ?? input.email.split('@')[0] ?? 'user';

  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO tenants (id, name, slug, code, status, seats, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
      [tenantId, input.name, input.slug, code, input.seats ?? 3, at, at],
    );
    await tx.run(
      `INSERT INTO users (id, email, display_name, password_hash, must_change_password, password_set_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
      [userId, input.email, input.name, hash, at, at, at],
    );
    await tx.run(
      `INSERT INTO memberships (tenant_id, user_id, role, status, created_at, updated_at, username)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      [tenantId, userId, input.role ?? 'company_admin', at, at, username],
    );
    await tx.run(
      `INSERT INTO company_settings (id, tenant_id, version, settings_json, created_at, created_by)
       VALUES (?, ?, 1, '{}', ?, ?)`,
      [newId(), tenantId, at, userId],
    );
  });

  return { tenantId, userId, code, username };
}

/** Create a platform administrator. */
export async function seedPlatformAdmin(
  db: Db,
  input: { email: string; password: string; role?: 'platform_admin' | 'platform_support' },
): Promise<{ userId: string }> {
  const userId = newId();
  const at = now();
  const hash = await hashPassword(input.password);
  await db.run(
    `INSERT INTO users (id, email, display_name, password_hash, must_change_password, password_set_at, platform_role, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [userId, input.email, 'Platform Admin', hash, at, input.role ?? 'platform_admin', at, at],
  );
  return { userId };
}

/** Pull the session cookie out of a sign-in response, or explain what came back instead. */
function sessionCookieFrom(response: {
  statusCode: number;
  body: string;
  headers: Record<string, unknown>;
}): string {
  if (response.statusCode !== 200) {
    throw new Error(`sign-in failed (${response.statusCode}): ${response.body}`);
  }

  const raw = response.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw ?? ''];
  const session = (cookies as string[]).find((value) => value.startsWith('sq_session='));
  if (session === undefined) throw new Error('no session cookie was set');
  // Only the `name=value` pair is needed for a subsequent request.
  return (session.split(';')[0] as string) ?? '';
}

/**
 * Sign in for a test.
 *
 * Two shapes, because the sign-in key changed from an email to a company plus a username and
 * **25 existing tests** call the old one:
 *
 * - `signIn(app, companyCode, username, password)` — the path a real user takes. **New tests must
 *   use this**: a test that skips the company code is not testing the route a person hits.
 * - `signIn(app, email, password)` — kept so those 25 tests still run. It is not a bypass: the
 *   latest `seedCompany`/`seedPlatformAdmin` result for that address supplies the company and
 *   username, and the request goes through the real route. A test that needs a code of its own
 *   should pass one explicitly.
 */
export async function signIn(
  app: FastifyInstance,
  codeOrEmail: string,
  usernameOrPassword: string,
  password?: string,
): Promise<string> {
  if (password !== undefined) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      payload: { companyCode: codeOrEmail, username: usernameOrPassword, password },
    });
    return sessionCookieFrom(response as never);
  }

  // The three-argument form: resolve the company and username this address signs in with.
  const db = DB_BY_APP.get(app);
  if (db === undefined) {
    throw new Error('signIn(app, email, password) needs an app from makeTestApp().');
  }

  const account = await db.get<{ code: string; username: string }>(
    `SELECT t.code, m.username
       FROM users u
       JOIN memberships m ON m.user_id = u.id
       JOIN tenants t ON t.id = m.tenant_id
      WHERE u.email = ? AND m.status = 'active' AND t.status = 'active'
      LIMIT 1`,
    [codeOrEmail.toLowerCase()],
  );
  if (account === null) {
    throw new Error(
      `signIn(app, "${codeOrEmail}", password): no company holds that address. ` +
        'Seed it first, or sign in with the company code: signIn(app, code, username, password).',
    );
  }

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    payload: { companyCode: account.code, username: account.username, password: usernameOrPassword },
  });
  return sessionCookieFrom(response as never);
}

/** Sign in as licence-vendor staff, who belong to no company. */
export async function signInPlatform(
  app: FastifyInstance,
  email: string,
  password: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in-platform',
    payload: { email, password },
  });
  return sessionCookieFrom(response as never);
}
