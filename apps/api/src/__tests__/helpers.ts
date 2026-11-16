/**
 * Test scaffolding: a real database, a real app, no network.
 *
 * Migrations run for real rather than a hand-built schema, so a test cannot pass against a
 * table definition that production does not have.
 *
 * **Which database**: Postgres, always (DECISIONS D1 — the application database is Postgres
 * everywhere, so a test on SQLite would be testing a driver the product no longer has).
 * `TEST_DATABASE_URL` is where it points; `DATABASE_URL` is deliberately **not** a fallback, because
 * a missing test variable must not quietly aim a destructive suite at the development database.
 *
 * That run **drops every table in the target database between files**, so it refuses a URL whose
 * database name does not contain `test` — a mistyped URL must not empty a company's data.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import {
  assertTestDatabase,
  createPostgresDb,
  dialectFolderFor,
  dropAllTablesForTests,
  migrate,
  newId,
  now,
} from '@sq/db';
import type { Db } from '@sq/db';
import type { ApiConfig } from '../config.js';
import { buildApp } from '../app.js';
import { hashPassword } from '../lib/password.js';
import type { TransactionalDeps } from '../lib/mail/transactional.js';

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
    // Short, so a device-idle test can move a timestamp a few days back rather than weeks.
    deviceIdleDays: 14,
    allowedOrigins: ['http://localhost:3061'],
    production: false,
    /*
     * `loopback`, and `app.inject()` connects from `127.0.0.1`, so a test may set
     * `X-Forwarded-For` and have it honoured — which is exactly what the client-IP tests need. A
     * remote address in a test is still untrusted, which is the other half of what those tests prove.
     */
    trustProxy: 'loopback',
    ...overrides,
  };
}

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  close: () => Promise<void>;
}

/**
 * The Postgres URL this suite runs against.
 *
 * Required, never defaulted. There is no SQLite branch to fall back to (DECISIONS D1), and
 * `DATABASE_URL` is not consulted: the development database is not a test database, and a missing
 * `TEST_DATABASE_URL` must fail loudly rather than empty it.
 */
function postgresUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined || url.trim() === '') {
    throw new Error(
      'The API suite needs TEST_DATABASE_URL (DECISIONS D1: the application database is Postgres ' +
        'everywhere). It drops every table in the target database between files, so the name must ' +
        'contain "test". Example: postgres://smartquote:…@localhost:5432/smartquote_test',
    );
  }
  assertTestDatabase(url, 'TEST_DATABASE_URL');
  return url;
}

/** Drop every table, so a file starts from nothing. Shared with `@sq/db`'s suite. */
async function resetPostgres(db: Db): Promise<void> {
  await dropAllTablesForTests(db);
}

/** Build an app over a fresh database. */
/**
 * Build an app over a fresh database.
 *
 * `mail` is what the reset and invite routes need. `null` means "this server has no SMTP", and the
 * routes answer 503 rather than pretending to send — a real state production can be in, so it is
 * reachable from a test rather than a flag only the shipping code knows about.
 */
export async function makeTestApp(
  config: ApiConfig = testConfig(),
  mail: TransactionalDeps | null = null,
): Promise<TestApp> {
  const url = postgresUrl();
  const db = createPostgresDb({ url });

  await resetPostgres(db);

  await migrate(db, MIGRATIONS, join(MIGRATIONS, dialectFolderFor()));

  const app = await buildApp({ db, config, mail });
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
/**
 * Sign in and return **both** cookies the API set.
 *
 * The device cookie is what makes the seat model testable at all: signing in again on the same
 * browser must reuse the seat, and the only way to say "same browser" in a test is to send the same
 * `sq_device` back (DECISIONS D3).
 *
 * `body` may be a device cookie from a previous call, and is forwarded as the request's `cookie`
 * header — which is exactly what a browser does.
 */
export async function signInWithDevice(
  app: FastifyInstance,
  companyCode: string,
  username: string,
  password: string,
  previousDeviceCookie?: string,
): Promise<{ sessionCookie: string; deviceCookie: string | null; statusCode: number; body: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    payload: { companyCode, username, password },
    ...(previousDeviceCookie === undefined ? {} : { headers: { cookie: previousDeviceCookie } }),
  });

  const raw = response.headers['set-cookie'];
  const cookies = (Array.isArray(raw) ? raw : [raw ?? '']) as string[];
  const pairOf = (name: string): string | null => {
    const found = cookies.find((value) => value.startsWith(`${name}=`));
    return found === undefined ? null : (found.split(';')[0] ?? null);
  };

  return {
    sessionCookie: pairOf('sq_session') ?? '',
    deviceCookie: pairOf('sq_device'),
    statusCode: response.statusCode,
    body: response.body,
  };
}

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
