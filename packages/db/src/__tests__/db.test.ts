import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteDb } from '@/sqlite';
import { migrate } from '@/migrate';
import { toPostgresPlaceholders } from '@/driver';
import type { Db } from '@/driver';

/** The migrations ship with the package, next to `src`. */
const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

describe('the migration runner', () => {
  let db: Db;

  beforeAll(async () => {
    db = createSqliteDb({ file: ':memory:' });
    await migrate(db, MIGRATIONS, join(MIGRATIONS, 'sqlite'));
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
    expect(versions).toContain('001_revision_immutable@sqlite');
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
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table],
      );
      expect(row, `table ${table} should exist`).not.toBeNull();
    }
  });

  it('is idempotent: a second run applies nothing and does not throw', async () => {
    const report = await migrate(db, MIGRATIONS, join(MIGRATIONS, 'sqlite'));
    expect(report.applied).toEqual([]);
    expect(report.alreadyApplied.length).toBeGreaterThan(0);
  });

  it('refuses to edit a migration that has already run', async () => {
    // Simulating the dangerous case directly: the recorded checksum no longer
    // matches the file. Two databases would otherwise hold different schemas under
    // one version number.
    await db.run("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '001_init'");
    await expect(migrate(db, MIGRATIONS, join(MIGRATIONS, 'sqlite'))).rejects.toThrow(
      /has changed since it was applied/,
    );
  });
});

describe('a saved revision cannot be changed', () => {
  let db: Db;

  beforeAll(async () => {
    db = createSqliteDb({ file: ':memory:' });
    await migrate(db, MIGRATIONS, join(MIGRATIONS, 'sqlite'));

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
    db = createSqliteDb({ file: ':memory:' });
    await migrate(db, MIGRATIONS, join(MIGRATIONS, 'sqlite'));
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
