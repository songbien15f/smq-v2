import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { publishPriceBook } from '@sq/core/pricing';
import { makeTestApp, seedCompany, signIn, testConfig, type TestApp } from './helpers';

/**
 * The catalogues endpoint, against the real licensed price book.
 *
 * The desktop's Step 1 and Step 2 dropdowns come from the book, so the test that
 * matters is the one that reads the book the product will actually price from — a
 * fixture would prove the route works and nothing about the data.
 */

/** The workspace root, so the dump path means the same thing wherever the test starts. */
function workspaceRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const cut = dir.lastIndexOf(sep);
    if (cut <= 0) return process.cwd();
    dir = dir.slice(0, cut);
  }
}

const ROOT = workspaceRoot();
const DUMP = resolve(ROOT, 'tools', 'price-dump', 'out');
const hasDump = existsSync(join(DUMP, 'cost_frame.json'));

describe.skipIf(!hasDump)('price book catalogues', () => {
  let ctx: TestApp;
  let cookie: string;
  let booksDir: string;
  const originalBooks = process.env.PRICE_BOOKS;

  beforeAll(async () => {
    booksDir = mkdtempSync(join(tmpdir(), 'sq-api-catalogues-'));
    process.env.PRICE_BOOKS = booksDir;
    publishPriceBook(DUMP, booksDir);

    ctx = await makeTestApp(testConfig());
    await seedCompany(ctx.db, {
      name: 'Catalogue Test Sheds',
      slug: 'catalogue-test',
      email: 'estimator@catalogue.test',
      password: 'a-long-enough-password',
      role: 'company_admin',
    });
    cookie = await signIn(ctx.app, 'estimator@catalogue.test', 'a-long-enough-password');
  });

  afterAll(async () => {
    await ctx.close();
    const { closeAllBooks } = await import('../lib/priceBook');
    closeAllBooks();
    if (originalBooks === undefined) delete process.env.PRICE_BOOKS;
    else process.env.PRICE_BOOKS = originalBooks;
    rmSync(booksDir, { recursive: true, force: true });
  });

  it('refuses before a book is active, as a deployment step not a bad request', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/price-books/active/catalogues',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('not_configured');
  });

  it('returns the catalogues the editor needs from the active book', async () => {
    const { publishAndActivate } = await import('../lib/priceBook');
    await publishAndActivate(ctx.db, {
      dumpDir: DUMP,
      publishedByUserId: 'test-admin',
      publishedByEmail: 'admin@vendor.test',
      note: 'catalogue test',
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/price-books/active/catalogues',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);

    const { bookHash, catalogue } = response.json().data;
    expect(bookHash).toMatch(/^[0-9a-f]{64}$/);

    // Colours come from the book, not a hardcoded Colorbond table.
    expect(catalogue.colours.length).toBeGreaterThan(20);
    expect(catalogue.colours.map((c: { name: string }) => c.name)).toContain('Shale Grey');

    // The two commercial catalogues are separated by type, not by name.
    expect(catalogue.miscOptions.length).toBe(55);
    expect(catalogue.engineeringCharges.length).toBe(5);

    // The Options dock order and limits come from the book.
    expect(catalogue.structureOptions.map((row: { code: string }) => row.code)).toContain('WINDOW');

    // Step 1's dropdown sources.
    expect(catalogue.windRegions.map((row: { value: string }) => row.value)).toEqual(['A', 'B', 'C', 'D']);
    expect(catalogue.footingTypes.length).toBeGreaterThan(0);
    expect(catalogue.spanHints.length).toBeGreaterThan(0);
    expect(catalogue.deliveryScopes.length).toBeGreaterThan(0);
  });

  it('answers 409 for a book that is not on disk', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/price-books/${'0'.repeat(64)}/catalogues`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('conflict');
  });
});
