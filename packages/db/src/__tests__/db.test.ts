import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresDb } from '@/postgres';
import { migrate } from '@/migrate';
import { toPostgresPlaceholders } from '@/driver';
import type { Db } from '@/driver';
import { assertTestDatabase, dropAllTablesForTests, ensureSchema, withSchema } from '@/testing';

/** The migrations ship with the package, next to `src`. */
const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
/** The dialect folder. There is one dialect now (DECISIONS D1). */
const PG = join(MIGRATIONS, 'pg');

/**
 * The URL this suite runs against: `TEST_DATABASE_URL`, pinned to its **own schema**.
 *
 * `@sq/api` uses the same database's `public` schema; this suite uses `db_suite`. Turborepo runs the
 * two packages' tests **in parallel** and both drop every table, so sharing a schema means one suite
 * empties the tables under the other — which looks like a random failure in whichever ran second.
 *
 * A schema rather than a second database because the application role deliberately has no
 * `CREATEDB` (see `scripts/postgres-setup.sql`); it does have the right to create a schema, and that
 * gives the same isolation without changing what the credential can do to the server.
 *
 * Missing `TEST_DATABASE_URL` throws rather than skipping. A suite that silently skips is a suite
 * whose absence nobody notices.
 */
const TEST_SCHEMA = 'db_suite';

function testUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined || url.trim() === '') {
    throw new Error(
      'The @sq/db suite needs TEST_DATABASE_URL (DECISIONS D1: the application database is Postgres ' +
        'everywhere). Example: postgres://smartquote:…@localhost:5432/smartquote_test — this suite ' +
        'drops every table in its own schema there.',
    );
  }
  assertTestDatabase(url, 'TEST_DATABASE_URL');
  return withSchema(url, TEST_SCHEMA);
}

/**
 * Open the suite's database and empty its schema.
 *
 * The schema is created on the plain URL first (no `search_path` in force yet), then every later
 * connection sees it through the URL.
 */
async function freshDb(): Promise<Db> {
  const base = process.env.TEST_DATABASE_URL as string;
  const bootstrap = createPostgresDb({ url: base });
  try {
    await ensureSchema(bootstrap, TEST_SCHEMA);
  } finally {
    await bootstrap.close();
  }

  const db = createPostgresDb({ url: testUrl() });
  await reset(db);
  return db;
}

/** Drop everything in this suite's schema, so each `describe` starts from nothing. */
async function reset(db: Db): Promise<void> {
  await dropAllTablesForTests(db);
}

describe('the migration runner', () => {
  let db: Db;

  beforeAll(async () => {
    db = await freshDb();
    await migrate(db, MIGRATIONS, PG);
  });

  afterAll(async () => {
    await db.close();
  });

  it('applies the portable file and the dialect extras', async () => {
    const rows = await db.all<{ version: string }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    const versions = rows.map((row) => row.version);
    expect(versions).toContain('001_init');
    // The dialect file is recorded under a namespaced version so it can never
    // collide with the portable file of the same prefix.
    expect(versions).toContain('001_revision_immutable@postgres');
  });

  it('creates the tables the API needs', async () => {
    for (const table of [
      'tenants',
      'users',
      'memberships',
      'sessions',
      'invitations',
      'company_settings',
      'customers',
      'quotes',
      'quote_revisions',
      'evaluations',
      'price_books',
      'price_row_overrides',
      'company_catalogue_rows',
      'quote_shares',
      'send_jobs',
      'quote_templates',
      'enquiries',
      'audit_events',
      'rate_limits',
    ]) {
      const row = await db.get<{ name: string }>(
        "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename = ?",
        [table],
      );
      expect(row, `table ${table} should exist`).not.toBeNull();
    }
  });

  it('is idempotent: a second run applies nothing and does not throw', async () => {
    const report = await migrate(db, MIGRATIONS, PG);
    expect(report.applied).toEqual([]);
    expect(report.alreadyApplied.length).toBeGreaterThan(0);
  });

  it('refuses to edit a migration that has already run', async () => {
    // Simulating the dangerous case directly: the recorded checksum no longer
    // matches the file. Two databases would otherwise hold different schemas under
    // one version number.
    await db.run("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '001_init'");
    await expect(migrate(db, MIGRATIONS, PG)).rejects.toThrow(
      /has changed since it was applied/,
    );
  });
});

describe('a saved revision cannot be changed', () => {
  let db: Db;

  beforeAll(async () => {
    db = await freshDb();
    await migrate(db, MIGRATIONS, PG);

    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO tenants (id, name, slug, status, seats, created_at, updated_at)
       VALUES ('t1', 'Acme Sheds', 'acme', 'active', 3, ?, ?)`,
      [now, now],
    );
    await db.run(
      `INSERT INTO quotes (id, tenant_id, number, status, current_revision, site_json, created_at, updated_at)
       VALUES ('q1', 't1', 'Q-1001', 'draft', 1, '{}', ?, ?)`,
      [now, now],
    );
    await db.run(
      `INSERT INTO quote_revisions (
         id, quote_id, tenant_id, revision, config_json, bom_json, price_json, issues_json,
         customer_json, company_json, provenance_json, config_hash, result_hash, bom_hash,
         price_book_hash, engine_version, contract_cents, total_cost_cents, total_mass_kg,
         idempotency_key, created_by_email, created_at
       ) VALUES ('r1', 'q1', 't1', 1, '{}', '{}', '{}', '[]', '{}', '{}', '{}',
                 'c', 'r', 'b', 'p', 1, 100000, 60000, 120.5, 'seed-1', 'a@b.c', ?)`,
      [now],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('refuses an UPDATE', async () => {
    await expect(
      db.run("UPDATE quote_revisions SET contract_cents = 1 WHERE id = 'r1'"),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses a DELETE', async () => {
    await expect(db.run("DELETE FROM quote_revisions WHERE id = 'r1'")).rejects.toThrow(
      /append-only/,
    );
  });

  it('still reads', async () => {
    const row = await db.get<{ contract_cents: number }>(
      "SELECT contract_cents FROM quote_revisions WHERE id = 'r1'",
    );
    expect(row?.contract_cents).toBe(100000);
  });
});

describe('transactions', () => {
  let db: Db;

  beforeAll(async () => {
    db = await freshDb();
    await migrate(db, MIGRATIONS, PG);
  });

  afterAll(async () => {
    await db.close();
  });

  it('rolls back every write when the callback throws', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO tenants (id, name, slug, status, seats, created_at, updated_at)
           VALUES ('t9', 'Rollback Ltd', 'rollback', 'active', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        );
        throw new Error('deliberate');
      }),
    ).rejects.toThrow('deliberate');

    const row = await db.get("SELECT id FROM tenants WHERE id = 't9'");
    expect(row).toBeNull();
  });

  it('refuses a nested transaction rather than opening a savepoint', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.transaction(async () => undefined);
      }),
    ).rejects.toThrow(/Nested transactions are refused/);
  });
});

describe('placeholder rewriting', () => {
  it('numbers placeholders in order', () => {
    expect(toPostgresPlaceholders('SELECT * FROM t WHERE a = ? AND b = ?')).toBe(
      'SELECT * FROM t WHERE a = $1 AND b = $2',
    );
  });

  it('leaves a question mark inside a string literal alone', () => {
    expect(toPostgresPlaceholders("SELECT 'what?' AS q, x FROM t WHERE id = ?")).toBe(
      "SELECT 'what?' AS q, x FROM t WHERE id = $1",
    );
  });

  it('handles an escaped quote inside a literal', () => {
    expect(toPostgresPlaceholders("SELECT 'it''s ?' AS q WHERE id = ?")).toBe(
      "SELECT 'it''s ?' AS q WHERE id = $1",
    );
  });
});

/**
 * Migration 009: a business code per company, and a sign-in name per company.
 *
 * Asserted against a database that **holds data before 009 runs**, because that is the only state
 * in which a backfill can fail. A migration tested on empty tables proves the SQL parses, not that
 * it does the job — and 009's whole job is to give existing rows a value.
 *
 * The migrations are copied to a scratch directory without 009, applied, seeded with a deliberate
 * username collision, and then 009 is executed. That is the production sequence.
 */
describe('migration 009 — company code and per-company username', () => {
  let db: Db;
  let scratch: string;

  beforeAll(async () => {
    db = await freshDb();
    scratch = mkdtempSync(join(tmpdir(), 'sq-m009-'));

    // Everything before 009, so the backfill has real rows to work on.
    for (const name of readdirSync(MIGRATIONS)) {
      const number = Number(name.slice(0, 3));
      if (name.endsWith('.sql') && Number.isFinite(number) && number < 9) {
        copyFileSync(join(MIGRATIONS, name), join(scratch, name));
      }
    }

    await migrate(db, scratch, PG);

    await db.run(
      `INSERT INTO tenants (id, name, slug, status, seats, created_at, updated_at)
       VALUES ('t-a', 'Alpha Sheds', 'demo-sheds', 'active', 5, '2026-01-01', '2026-01-01'),
              ('t-b', 'Beta Sheds', 'beta-sheds', 'active', 5, '2026-01-01', '2026-01-01')`,
    );
    await db.run(
      `INSERT INTO users (id, email, display_name, created_at, updated_at)
       VALUES ('u1', 'owner@demo-sheds.test', 'Owner', '2026-01-01', '2026-01-01'),
              ('u2', 'owner@beta-sheds.test', 'Owner Two', '2026-01-01', '2026-01-01'),
              ('u3', 'owner@third.test', 'Third', '2026-01-01', '2026-01-01')`,
    );
    // u1 and u3 share the local part `owner`, both inside company t-a: the collision the
    // backfill has to resolve before its unique index can be created.
    await db.run(
      `INSERT INTO memberships (tenant_id, user_id, role, status, created_at, updated_at)
       VALUES ('t-a', 'u1', 'company_admin', 'active', '2026-01-01', '2026-01-01'),
              ('t-a', 'u3', 'viewer',        'active', '2026-01-02', '2026-01-02'),
              ('t-b', 'u2', 'company_admin', 'active', '2026-01-01', '2026-01-01')`,
    );
  });

  afterAll(async () => {
    await db.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  it('has neither column before 009 runs', async () => {
    /*
     * Scoped to the connection's own schema. Two suites share this database, told apart by
     * `search_path`, and `information_schema.columns` is **not** schema-scoped: without the filter it
     * returns the other suite's `tenants` too — which is how this assertion first failed with
     * `['seats', 'seats', 'slug', …]`, the same columns twice.
     */
    const columnsOf = async (table: string) =>
      (await db.all<{ name: string }>(
        `SELECT column_name AS name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = ?`,
        [table],
      )) as { name: string }[];
    const tenantCols = await columnsOf('tenants');
    const memberCols = await columnsOf('memberships');
    expect(tenantCols.map((c) => c.name)).not.toContain('code');
    expect(memberCols.map((c) => c.name)).not.toContain('username');
  });

  it('gives every existing company a code from its slug, and every membership a username', async () => {
    // The production sequence: the portable file, then the dialect extras for the same prefix.
    await db.exec(readFileSync(join(MIGRATIONS, '009_company_code_and_username.sql'), 'utf8'));
    await db.exec(readFileSync(join(MIGRATIONS, 'pg', '009_company_code_and_username.sql'), 'utf8'));

    const codes = (await db.all('SELECT code FROM tenants ORDER BY code')) as { code: string }[];
    // `demo-sheds` → `DEMOSHEDS`: upper, hyphens dropped, first ten characters.
    expect(codes.map((row) => row.code)).toEqual(['BETASHEDS', 'DEMOSHEDS']);

    const names = (await db.all('SELECT username FROM memberships ORDER BY username')) as { username: string }[];
    for (const row of names) expect(row.username).toBeTruthy();
  });

  it('gives the two people called owner in one company distinct usernames', async () => {
    const rows = (await db.all(
      "SELECT username FROM memberships WHERE tenant_id = 't-a' ORDER BY ctid",
    )) as { username: string }[];

    // The earliest keeps the plain name; the later one is suffixed, so the unique index can exist.
    expect(rows[0]?.username).toBe('owner');
    expect(rows[1]?.username).toMatch(/^owner\d+$/);
  });

  it('lets the same username exist in two companies', async () => {
    const rows = (await db.all(
      "SELECT tenant_id, username FROM memberships WHERE username = 'owner' ORDER BY tenant_id",
    )) as { tenant_id: string }[];
    expect(rows.map((row) => row.tenant_id)).toEqual(['t-a', 't-b']);
  });

  it('refuses a duplicate username inside one company', async () => {
    await expect(
      db.run(
        `INSERT INTO memberships (tenant_id, user_id, role, status, created_at, updated_at, username)
         VALUES ('t-a', 'u2', 'viewer', 'active', '2026-01-03', '2026-01-03', 'owner')`,
      ),
    ).rejects.toThrow();
  });

  it('refuses a duplicate company code', async () => {
    await expect(
      db.run(
        `INSERT INTO tenants (id, name, slug, status, seats, created_at, updated_at, code)
         VALUES ('t-c', 'Gamma', 'gamma', 'active', 5, '2026-01-01', '2026-01-01', 'DEMOSHEDS')`,
      ),
    ).rejects.toThrow();
  });
});
