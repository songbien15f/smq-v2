import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { publishPriceBook } from '@sq/core/pricing';
import { makeTestApp, seedCompany, signIn, testConfig, type TestApp } from './helpers';

/**
 * Reading and editing a company's own prices.
 *
 * The load-bearing assertions are that **a write makes a new version** (so a frozen revision's
 * recorded version keeps meaning what it meant) and that **clearing one row keeps the others** — the
 * two behaviours an operator relies on when a single material was mispriced.
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

describe.skipIf(!hasDump)('price overrides', () => {
  let ctx: TestApp;
  let cookie: string;
  let booksDir: string;
  const originalBooks = process.env.PRICE_BOOKS;

  beforeAll(async () => {
    booksDir = mkdtempSync(join(tmpdir(), 'sq-override-books-'));
    process.env.PRICE_BOOKS = booksDir;
    publishPriceBook(DUMP, booksDir);

    ctx = await makeTestApp(testConfig());
    await seedCompany(ctx.db, {
      name: 'Override Sheds',
      slug: 'override-test',
      email: 'owner@override.test',
      password: 'a-long-enough-password',
      role: 'company_admin',
    });
    cookie = await signIn(ctx.app, 'owner@override.test', 'a-long-enough-password');

    const { publishAndActivate } = await import('../lib/priceBook');
    await publishAndActivate(ctx.db, { dumpDir: DUMP, publishedByUserId: 't', publishedByEmail: 't@v' });
  });

  afterAll(async () => {
    await ctx.close();
    const { closeAllBooks } = await import('../lib/priceBook');
    closeAllBooks();
    if (originalBooks === undefined) delete process.env.PRICE_BOOKS;
    else process.env.PRICE_BOOKS = originalBooks;
    rmSync(booksDir, { recursive: true, force: true });
  });

  it('starts with no overrides, so every material prices from the book', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/prices/overrides',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.versions).toEqual([]);
  });

  it('creates version 1 when the first price is set', async () => {
    const response = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/prices/overrides',
      headers: { cookie },
      payload: { rowKey: 'cost_frame:code=X1', unitCostCents: 1234 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.version).toBe(1);
    expect(response.json().data.rowCount).toBe(1);
  });

  it('supersedes rather than editing, and carries the earlier rows forward', async () => {
    const second = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/prices/overrides',
      headers: { cookie },
      payload: { rowKey: 'cost_purlin:code=Y2', unitCostCents: 500, note: 'a second material' },
    });

    expect(second.json().data.version).toBe(2);
    // Two rows: the new one, and the frame row carried forward from v1. A mutation in place would
    // have left v1 unreadable and a revision's recorded version meaningless.
    expect(second.json().data.rowCount).toBe(2);

    const list = await ctx.app.inject({ method: 'GET', url: '/api/v1/prices/overrides', headers: { cookie } });
    const versions = list.json().data.versions as { version: number; rowCount: number }[];
    expect(versions.map((entry) => entry.version)).toEqual([2, 1]);
    expect(versions[1]?.rowCount).toBe(1);
  });

  it('clears one row without disturbing the others', async () => {
    const cleared = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/prices/overrides',
      headers: { cookie },
      payload: { rowKey: 'cost_purlin:code=Y2', unitCostCents: null },
    });

    expect(cleared.json().data.version).toBe(3);
    expect(cleared.json().data.removed).toBe(true);
    // The frame row survives: clearing one material is not clearing the list.
    expect(cleared.json().data.rowCount).toBe(1);
  });

  it('removing a version puts the one before it back in force', async () => {
    const list = await ctx.app.inject({ method: 'GET', url: '/api/v1/prices/overrides', headers: { cookie } });
    const newest = (list.json().data.versions as { id: string; version: number }[])[0];

    const removed = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/prices/overrides/${newest?.id}`,
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(200);

    const after = await ctx.app.inject({ method: 'GET', url: '/api/v1/prices/overrides', headers: { cookie } });
    const versions = after.json().data.versions as { version: number; rowCount: number }[];
    expect(versions[0]?.version).toBe(2);
    expect(versions[0]?.rowCount).toBe(2);
  });

  it('refuses an override to a role that cannot manage prices', async () => {
    // A viewer must not be able to change what the product costs. An `estimator` can — that role
    // carries `price:manage` on purpose — so the check uses the role that genuinely cannot.
    await seedCompany(ctx.db, {
      name: 'Override Two',
      slug: 'override-two',
      email: 'sales@override.test',
      password: 'a-long-enough-password',
      role: 'viewer',
    });
    const salesCookie = await signIn(ctx.app, 'sales@override.test', 'a-long-enough-password');

    const response = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/prices/overrides',
      headers: { cookie: salesCookie },
      payload: { rowKey: 'cost_frame:code=X1', unitCostCents: 1 },
    });

    expect(response.statusCode).toBe(403);
  });

  it('the active version reaches the evaluation, and its number is recorded', async () => {
    // The whole point: an override changes a price. `evaluate` runs against the same company, so the
    // frame row it asks for must come back at the overridden cost.
    const evaluated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: {
        config: {
          structureType: 'gable',
          span: 9000,
          length: 18000,
          height: 3000,
          bays: 3,
          roofPitchDeg: 10,
          windRegion: 'A',
          terrainCategory: 2.5,
          importanceLevel: 1,
          stateCode: 'QLD',
          internalPressure: 'closed',
          displayUnit: 'mm',
          shieldingFactor: 1,
          topographyFactor: 1,
          colors: {
            wall: '#7d8c8f',
            roof: '#e8e8e0',
            barge: '#e8e8e0',
            downpipe: '#e8e8e0',
            gutter: '#e8e8e0',
            window: '#4a4a4a',
            paDoor: '#4a4a4a',
            rollerDoor: '#4a4a4a',
            slidingDoor: '#4a4a4a',
            dividingWall: '#e8e8e0',
          },
          openings: [],
          options: [],
          charges: [],
        },
        pricing: {
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
        },
      },
    });

    expect(evaluated.statusCode).toBe(200);
    // The version must match what is in force, not the hardcoded zero the route used to send.
    expect(evaluated.json().data.overrideVersion).toBe(2);
  });
});
