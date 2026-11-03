import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { publishPriceBook } from '@sq/core/pricing';
import { DEFAULT_SHED, normaliseShedConfig } from '@sq/core/domain';
import { makeTestApp, seedCompany, seedPlatformAdmin, signIn, testConfig, type TestApp } from './helpers';

/**
 * Usage tracking, releases and the template catalogue.
 *
 * The load-bearing assertions are that **usage is actually written** (the table had never been
 * touched), that a **replay is not a second quote**, and that a template **carries no identity** —
 * that last one is the rule the whole catalogue exists under.
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

describe.skipIf(!hasDump)('usage, releases and templates', () => {
  let ctx: TestApp;
  let companyCookie: string;
  let platformCookie: string;
  let booksDir: string;
  const originalBooks = process.env.PRICE_BOOKS;

  beforeAll(async () => {
    booksDir = mkdtempSync(join(tmpdir(), 'sq-usage-books-'));
    process.env.PRICE_BOOKS = booksDir;
    publishPriceBook(DUMP, booksDir);

    ctx = await makeTestApp(testConfig());
    await seedCompany(ctx.db, {
      name: 'Usage Test Sheds',
      slug: 'usage-test',
      email: 'owner@usage.test',
      password: 'a-long-enough-password',
      role: 'company_admin',
    });
    await seedPlatformAdmin(ctx.db, { email: 'ops@usage-vendor.test', password: 'a-long-enough-password' });

    companyCookie = await signIn(ctx.app, 'owner@usage.test', 'a-long-enough-password');
    platformCookie = await signIn(ctx.app, 'ops@usage-vendor.test', 'a-long-enough-password');

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

  /* -------------------------------------------------------------------- usage */

  it('records a quote_created when a quote is saved for the first time', async () => {
    const evaluated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie: companyCookie },
      payload: { config: config(), pricing },
    });
    expect(evaluated.statusCode).toBe(200);

    const saved = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie: companyCookie },
      payload: {
        evaluationId: evaluated.json().data.evaluationId,
        idempotencyKey: 'usage-test-0001',
        expectedRev: 0,
        customer: { firstName: 'A', lastName: 'B', email: 'a@b.test', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: config(),
        pricing,
      },
    });
    expect(saved.statusCode).toBe(201);

    // The table had never been written before this feature; the assertion is that it is now.
    const row = await ctx.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM usage_events WHERE kind = 'quote_created'",
    );
    expect(Number(row?.n ?? 0)).toBe(1);
  });

  it('does not count a replay as a second quote', async () => {
    // The same idempotency key is the operator double-clicking, not a second quote. Counting it twice
    // would overstate the one figure a vendor judges adoption by.
    const before = await ctx.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM usage_events WHERE kind = 'quote_created'",
    );

    const evaluated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie: companyCookie },
      payload: { config: config(), pricing },
    });

    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie: companyCookie },
      payload: {
        evaluationId: evaluated.json().data.evaluationId,
        idempotencyKey: 'usage-test-0001',
        expectedRev: 0,
        customer: { firstName: 'A', lastName: 'B', email: 'a@b.test', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: config(),
        pricing,
      },
    });

    const after = await ctx.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM usage_events WHERE kind = 'quote_created'",
    );
    expect(Number(after?.n ?? 0)).toBe(Number(before?.n ?? 0));
  });

  it('summarises usage for the company, and for the vendor across every company', async () => {
    const company = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/usage',
      headers: { cookie: companyCookie },
    });
    expect(company.statusCode).toBe(200);
    expect(company.json().data.scope).toBe('company');
    expect((company.json().data.summary as { kind: string }[]).some((row) => row.kind === 'quote_created')).toBe(true);

    const platform = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/usage',
      headers: { cookie: platformCookie },
    });
    expect(platform.statusCode).toBe(200);
    expect(platform.json().data.scope).toBe('platform');
  });

  it('refuses the vendor summary to a company user', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/usage',
      headers: { cookie: companyCookie },
    });
    expect(response.statusCode).toBe(403);
  });

  /* ----------------------------------------------------------------- releases */

  it('records a release and keeps exactly one current', async () => {
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/admin/releases',
      headers: { cookie: platformCookie },
      payload: { label: '2026.11.1', note: 'First', makeCurrent: true },
    });
    expect(first.statusCode).toBe(201);

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/admin/releases',
      headers: { cookie: platformCookie },
      payload: { label: '2026.11.2', note: 'Second', makeCurrent: true },
    });
    expect(second.statusCode).toBe(201);

    // Two "current" releases would make the one question this table answers unanswerable.
    const current = await ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM releases WHERE current = 1');
    expect(Number(current?.n ?? 0)).toBe(1);

    const row = await ctx.db.get<{ label: string }>('SELECT label FROM releases WHERE current = 1');
    expect(row?.label).toBe('2026.11.2');
  });

  it('refuses a duplicate release label', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/admin/releases',
      headers: { cookie: platformCookie },
      payload: { label: '2026.11.1', note: 'Again', makeCurrent: false },
    });
    expect(response.statusCode).toBe(409);
  });

  /* ---------------------------------------------------------------- templates */

  it('authors a template that carries the building and no identity', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/admin/templates',
      headers: { cookie: platformCookie },
      payload: { code: 'gable-9x18', name: 'Gable 9 × 18', typeCode: 'gable', config: config() },
    });
    expect(created.statusCode).toBe(201);

    const row = await ctx.db.get<{ config_json: string }>(
      "SELECT config_json FROM quote_templates WHERE code = 'gable-9x18'",
    );
    const stored = JSON.parse(row?.config_json as string) as Record<string, unknown>;

    // The building is there…
    expect(stored.span).toBe(9000);
    // …and nothing about a person or a site is. A clone must not inherit a customer.
    expect(stored).not.toHaveProperty('customer');
    expect(stored).not.toHaveProperty('siteCheckId');
    expect(JSON.stringify(stored)).not.toContain('@');
  });

  it('lists active templates to a company, with the building', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/templates',
      headers: { cookie: companyCookie },
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().data.items as { code: string; config: { span: number } | null }[];
    const template = items.find((item) => item.code === 'gable-9x18');
    expect(template?.config?.span).toBe(9000);
  });

  it('counts a clone separately from a read', async () => {
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/templates',
      headers: { cookie: companyCookie },
    });
    const found = (list.json().data.items as { id: string; code: string }[]).find(
      (item) => item.code === 'gable-9x18',
    );
    // A real guard rather than `expect(...).toBeDefined()`: the assertion does not narrow the type,
    // and the parameter list below needs a string.
    if (found === undefined) throw new Error('the template was not in the catalogue');
    const id = found.id;

    const before = await ctx.db.get<{ clone_count: number }>(
      'SELECT clone_count FROM quote_templates WHERE id = ?',
      [id],
    );

    await ctx.app.inject({ method: 'POST', url: `/api/v1/templates/${id}/cloned`, headers: { cookie: companyCookie } });

    const after = await ctx.db.get<{ clone_count: number }>(
      'SELECT clone_count FROM quote_templates WHERE id = ?',
      [id],
    );
    expect(Number(after?.clone_count ?? 0)).toBe(Number(before?.clone_count ?? 0) + 1);
  });

  it('hides an archived template from the company catalogue', async () => {
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/templates',
      headers: { cookie: companyCookie },
    });
    const id = (list.json().data.items as { id: string; code: string }[]).find(
      (item) => item.code === 'gable-9x18',
    )?.id;

    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/templates/${id}`,
      headers: { cookie: platformCookie },
      payload: { status: 'archived' },
    });

    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/templates',
      headers: { cookie: companyCookie },
    });
    const codes = (after.json().data.items as { code: string }[]).map((item) => item.code);
    expect(codes).not.toContain('gable-9x18');
  });
});
