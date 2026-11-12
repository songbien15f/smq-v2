import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { publishPriceBook } from '@sq/core/pricing';
import { DEFAULT_SHED, normaliseShedConfig, TEST_SHED } from '@sq/core/domain';
import { makeTestApp, seedCompany, signIn, testConfig, type TestApp } from './helpers';

/**
 * The freight minimum, **enforced where the money is frozen**.
 *
 * The Cost step names the minimum and turns red below it, and that is a screen, not a rule: the same
 * request can be posted by anything that speaks to the API, and an operator who clicks past the
 * sentence issues a quote whose freight the company pays out of its margin. This file pins the rule
 * on the save, with the real price book — a mocked book would let the route pass while the base
 * (`total − delivery`) was arithmetic nobody had checked.
 *
 * Skips without the licensed dump, like `pricing.test.ts`, because the whole point is that the
 * engine, the book and the database agree.
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

/** A shed with nothing unusual in it, built through the normaliser like the editor does. */
function config(): Record<string, unknown> {
  return normaliseShedConfig({
    ...TEST_SHED,
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

/** The site block the save requires. */
function site(deliveryScope: string): Record<string, unknown> {
  return {
    address: '1 Test Street, Brisbane QLD 4000',
    deliveryScope,
    deliveryAcknowledged: true,
  };
}

const customer = {
  firstName: 'Jane',
  lastName: 'Citizen',
  email: 'jane@example.com',
  address: '1 Test Street',
};

describe.skipIf(!hasDump)('freight minimum, enforced on save', () => {
  let ctx: TestApp;
  let cookie: string;
  let booksDir: string;
  const originalBooks = process.env.PRICE_BOOKS;

  beforeAll(async () => {
    booksDir = mkdtempSync(join(tmpdir(), 'sq-freight-books-'));
    process.env.PRICE_BOOKS = booksDir;
    publishPriceBook(DUMP, booksDir);

    ctx = await makeTestApp(testConfig());
    const company = await seedCompany(ctx.db, {
      name: 'Freight Test Sheds',
      slug: 'freight-test',
      email: 'owner@freight.test',
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

    // A distributor minimum of $300 or 10% of the job, whichever is larger.
    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: { cookie },
      payload: {
        minimumFees: {
          distributorDollarCents: 30_000,
          distributorPercent: 10,
          carrierDollarCents: 0,
          carrierPercent: 0,
        },
      },
    });
    expect(patched.statusCode).toBe(200);
  });

  afterAll(async () => {
    await ctx.close();
    const { closeAllBooks } = await import('../lib/priceBook');
    closeAllBooks();
    if (originalBooks === undefined) delete process.env.PRICE_BOOKS;
    else process.env.PRICE_BOOKS = originalBooks;
    rmSync(booksDir, { recursive: true, force: true });
  });

  /** Evaluate with a given delivery figure, and return the evaluation id. */
  async function evaluate(deliveryCents: number): Promise<{ id: string; totalCents: number }> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing: { ...pricing, deliveryCents } },
    });
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    return { id: data.evaluationId, totalCents: data.price.totalCents };
  }

  /** Save the evaluation, with a scope on the site block. */
  async function save(input: { evaluationId: string; deliveryCents: number; scope: string; key: string }) {
    return ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: {
        evaluationId: input.evaluationId,
        idempotencyKey: input.key,
        expectedRev: 0,
        customer,
        site: site(input.scope),
        config: config(),
        pricing: { ...pricing, deliveryCents: input.deliveryCents },
      },
    });
  }

  it('refuses a distributor delivery below the agreed minimum', async () => {
    const { id } = await evaluate(25_000);
    const response = await save({
      evaluationId: id,
      deliveryCents: 25_000,
      scope: 'Delivered to Distributor',
      key: 'freight-below-0001',
    });

    expect(response.statusCode).toBe(422);
    const body = response.json() as {
      code: string;
      message: string;
      details?: { path: string; message: string }[];
    };
    expect(body.code).toBe('validation_failed');
    // The message names the scope, both figures, and what to do — not "invalid input".
    expect(body.message).toContain('Delivered to Distributor');
    expect(body.message).toContain('minimum freight');
    expect(body.message).toMatch(/\$\d/);
    // And it points at the field that has to change.
    expect(body.details?.[0]?.path).toBe('cost-delivery');
  });

  it('accepts the same quote at the minimum', async () => {
    /*
     * The minimum is 10% of the job. The job's value is only known after an evaluation, so it is read
     * back from one: this is the same figure the Cost step shows and the same one the route computes.
     */
    const probe = await evaluate(0);
    const base = probe.totalCents; // delivery is 0 here, so total is the job value
    const minimum = Math.round(Math.round((base * 0.1) / 5000) * 5000);

    const withMinimum = await evaluate(minimum);
    const response = await save({
      evaluationId: withMinimum.id,
      deliveryCents: minimum,
      scope: 'Delivered to Distributor',
      key: 'freight-at-min-0001',
    });

    expect(response.statusCode).toBe(201);
    const result = response.json().data as { quoteId: string; revision: number };
    expect(result.revision).toBe(1);

    // The frozen revision carries the figure that was accepted, not a recomputed one.
    const stored = await ctx.db.get<{ price_json: string }>(
      'SELECT price_json FROM quote_revisions WHERE quote_id = ?',
      [result.quoteId],
    );
    expect(JSON.parse(stored?.price_json as string).deliveryCents).toBe(minimum);
  });

  it('does not hold an ordinary distance scope to the minimum', async () => {
    // $650 for 301-400 km is the book's figure; the distributor minimum has nothing to do with it.
    const { id } = await evaluate(65_000);
    const response = await save({
      evaluationId: id,
      deliveryCents: 65_000,
      scope: 'Delivered to site 301-400km',
      key: 'freight-distance-0001',
    });

    expect(response.statusCode).toBe(201);
  });

  it('leaves a quote with no delivery scope alone', async () => {
    const { id } = await evaluate(0);
    const response = await save({
      evaluationId: id,
      deliveryCents: 0,
      scope: 'ex Works',
      key: 'freight-nowhere-0001',
    });

    expect(response.statusCode).toBe(201);
  });
});
