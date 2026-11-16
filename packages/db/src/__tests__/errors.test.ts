import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createPostgresDb } from '@/postgres';
import type { Db } from '@/driver';
import { isForeignKeyViolation, isUniqueViolation } from '@/errors';

/**
 * Error classification, checked against a **real** driver error rather than a hand-made object.
 *
 * The point of `isUniqueViolation` is that seat claiming retries on a race. If it does not recognise
 * the error `pg` actually throws, the retry never happens and two simultaneous sign-ins on the last
 * seat answer 500 instead of "no seat" — which is exactly the defect (M3) the predicate exists for.
 * A synthetic `{ code: '23505' }` would prove the comparison, not the recognition.
 */

const url = (): string => {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.trim() === '') {
    throw new Error(
      'This suite needs TEST_DATABASE_URL (DECISIONS D1). Example: ' +
        'postgres://smartquote:…@localhost:5432/smartquote_test',
    );
  }
  if (!/test/i.test(value.split('/').pop()?.split('?')[0] ?? '')) {
    throw new Error('Refusing a destructive suite against a database whose name has no "test" in it.');
  }
  return value;
};

describe('isUniqueViolation', () => {
  let db: Db;

  /*
   * The probe tables are created **inside each test**, not in `beforeAll`.
   *
   * `db.test.ts` runs in the same process and resets the whole schema between its `describe` blocks,
   * which dropped these tables underneath this file — "relation probe_unique does not exist" on a test
   * that had just created it. A fixture that the other suite can delete is not a fixture.
   */
  const probe = async (name: string, sql: string): Promise<void> => {
    await db.exec(`DROP TABLE IF EXISTS ${name} CASCADE`);
    await db.exec(sql);
  };

  beforeAll(mockDb);
  afterAll(async () => {
    await db.exec('DROP TABLE IF EXISTS probe_child CASCADE');
    await db.exec('DROP TABLE IF EXISTS probe_unique CASCADE');
    await db.close();
  });

  function mockDb(): void {
    db = createPostgresDb({ url: url() });
  }

  it('recognises the error Postgres raises for a duplicate key', async () => {
    await probe('probe_unique', 'CREATE TABLE probe_unique (id TEXT PRIMARY KEY)');
    await db.run('INSERT INTO probe_unique (id) VALUES (?)', ['same']);

    const error = await db
      .run('INSERT INTO probe_unique (id) VALUES (?)', ['same'])
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).not.toBeNull();
    expect(isUniqueViolation(error)).toBe(true);
    // And the classification is specific: this is not a foreign-key violation.
    expect(isForeignKeyViolation(error)).toBe(false);
  });

  it('recognises a foreign-key violation as its own thing', async () => {
    await probe('probe_unique', 'CREATE TABLE probe_unique (id TEXT PRIMARY KEY)');
    await probe(
      'probe_child',
      'CREATE TABLE probe_child (id TEXT PRIMARY KEY, parent TEXT REFERENCES probe_unique(id))',
    );

    const error = await db
      .run('INSERT INTO probe_child (id, parent) VALUES (?, ?)', ['c1', 'missing'])
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).not.toBeNull();
    expect(isForeignKeyViolation(error)).toBe(true);
    expect(isUniqueViolation(error)).toBe(false);
  });

  it('is not fooled by unrelated values', () => {
    // Non-errors and error-shaped objects with a different code must answer false, so a call site does
    // not retry (or report a conflict) for a connection failure.
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation({ code: 23505 })).toBe(false);
  });
});
