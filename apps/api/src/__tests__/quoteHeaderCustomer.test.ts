import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { publishPriceBook } from '@sq/core/pricing';
import { DEFAULT_SHED, normaliseShedConfig } from '@sq/core/domain';
import { makeTestApp, seedCompany, signIn, testConfig, type TestApp } from './helpers';

/**
 * A quote's header describes its **newest** revision, customer included.
 *
 * ## The defect this pins
 *
 * `quotes.customer_id` was written when the quote was created and never again, while the two places a
 * person reads a quote disagree about where the name comes from: the **detail page and the editor** read
 * the revision's frozen `customer_json`, and the **list** reads the header column. Re-quoting for a
 * different person therefore produced two answers on screen at once, and the one a person scans a list
 * with was the stale one.
 *
 * Found in the dev database on Q-2026-0037: revision 1 `E2E Legacy`, revision 2 `E2E Smoke`. The
 * editor said Smoke; the list said Legacy.
 *
 * ## Why this goes through the route with the real book
 *
 * The obvious cheap test would write the two revisions itself and assert on the SQL it just wrote —
 * which proves nothing about the route that has to issue it. This file saves through `POST /quotes`
 * twice with the licensed dump published, so the change is exercised where it lives. It skips without
 * the dump, like `pricing.test.ts`.
 */

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

function config(): Record<string, unknown> {
  return normaliseShedConfig({
    ...DEFAULT_SHED,
    structureType: 'gable',
    span: 9000,
    length: 18000,
    height: 3000,
    roofPitchDeg: 10,
    bays: 3,
    windRegion: 'A',
    terrainCategory: 2.5,
    stateCode: 'QLD',
  }) as unknown as Record<string, unknown>;
}

const pricing = {
  quoteRatePct: 0,
  depositPct: 10,
  progressPct: 70,
  deliveryCents: 0,
  engineeringCents: 0,
  extraCents: 0,
  additionsCents: 0,
  contractOverrideCents: null,
  depositOverrideCents: null,
  progressOverrideCents: null,
};

describe.skipIf(!hasDump)('the quote header follows its newest revision', () => {
  let ctx: TestApp;
  let cookie: string;
  let booksDir: string;
  const originalBooks = process.env.PRICE_BOOKS;

  beforeAll(async () => {
    booksDir = mkdtempSync(join(tmpdir(), 'sq-header-books-'));
    process.env.PRICE_BOOKS = booksDir;
    publishPriceBook(DUMP, booksDir);

    ctx = await makeTestApp(testConfig());
    const company = await seedCompany(ctx.db, {
      name: 'Header Test Sheds',
      slug: 'header-test',
      email: 'owner@header.test',
      password: 'a-long-enough-password',
      role: 'company_admin',
    });
    cookie = await signIn(ctx.app, company.code, company.username, 'a-long-enough-password');

    const { publishAndActivate } = await import('../lib/priceBook');
    await publishAndActivate(ctx.db, {
      dumpDir: DUMP,
      publishedByUserId: 'test-admin',
      publishedByEmail: 'admin@vendor.test',
      note: 'test book',
    });
  });

  afterAll(async () => {
    await ctx.close();
    const { closeAllBooks } = await import('../lib/priceBook');
    closeAllBooks();
    if (originalBooks === undefined) delete process.env.PRICE_BOOKS;
    else process.env.PRICE_BOOKS = originalBooks;
    rmSync(booksDir, { recursive: true, force: true });
  });

  /** Price, then save. `quoteId` appends; absent creates. */
  async function save(input: {
    firstName: string;
    lastName: string;
    key: string;
    quoteId?: string;
    expectedRev: number;
  }): Promise<{ quoteId: string; revision: number }> {
    const evaluated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing },
    });
    expect(evaluated.statusCode).toBe(200);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: {
        ...(input.quoteId === undefined ? {} : { quoteId: input.quoteId }),
        evaluationId: evaluated.json().data.evaluationId,
        idempotencyKey: input.key,
        expectedRev: input.expectedRev,
        customer: {
          firstName: input.firstName,
          lastName: input.lastName,
          email: `${input.firstName.toLowerCase()}@example.com`,
          address: '1 Header Street',
        },
        site: { address: '1 Header Street', deliveryAcknowledged: true },
        config: config(),
        pricing,
      },
    });

    expect(response.statusCode, response.body).toBeLessThan(300);
    return response.json().data as { quoteId: string; revision: number };
  }

  /** The list row, as the quotes screen reads it. */
  async function listRowFor(quoteId: string): Promise<{ customerName: string } | null> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/quotes?limit=50',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const items = response.json().data.items as { id: string; customerName: string }[];
    return items.find((item) => item.id === quoteId) ?? null;
  }

  it('names the customer of the newest revision after a re-quote', async () => {
    const created = await save({ firstName: 'Old', lastName: 'Name', key: 'header-key-0001', expectedRev: 1 - 1 });
    expect(created.revision).toBe(1);

    // The list agrees with the only revision there is.
    expect((await listRowFor(created.quoteId))?.customerName).toBe('Old Name');

    // Re-quoted for somebody else: revision 2 names them in its frozen snapshot.
    const appended = await save({
      firstName: 'New',
      lastName: 'Person',
      key: 'header-key-0002',
      quoteId: created.quoteId,
      expectedRev: 1,
    });
    expect(appended.revision).toBe(2);

    /*
     * And the list says so too. Before the fix this answered "Old Name" forever, while the detail page
     * and the editor — which read the revision — said "New Person".
     */
    expect((await listRowFor(created.quoteId))?.customerName).toBe('New Person');

    // The frozen snapshots are untouched: revision 1 is still what was sent.
    const rows = await ctx.db.all<{ revision: number; customer_json: string }>(
      'SELECT revision, customer_json FROM quote_revisions WHERE quote_id = ? ORDER BY revision',
      [created.quoteId],
    );
    expect(rows.map((row) => ({ revision: Number(row.revision), ...JSON.parse(row.customer_json) }))).toEqual([
      expect.objectContaining({ revision: 1, firstName: 'Old', lastName: 'Name' }),
      expect.objectContaining({ revision: 2, firstName: 'New', lastName: 'Person' }),
    ]);
  });
});
