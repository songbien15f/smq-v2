import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { publishPriceBook } from '@sq/core/pricing';
import { DEFAULT_SHED, normaliseShedConfig } from '@sq/core/domain';
import { makeTestApp, seedCompany, signIn, testConfig, type TestApp } from './helpers';

/**
 * The document and the share link, end to end.
 *
 * Against the **real** price book, because the point of this file is that a customer can actually be
 * sent something: a mocked lookup would let the route pass while producing a page nobody could use.
 *
 * The one assertion that matters most is the leak check — a quote is the only artefact of this
 * product that leaves the building, and a material cost on it hands a customer the company's margin.
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

/** A shed, as the editor posts it. */
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
    openings: [
      { id: 'o1', type: 'roller_door', wall: 'front', u: 4500, width: 3000, height: 2400 },
      { id: 'o2', type: 'window', wall: 'left', u: 3000, width: 1200, height: 900 },
    ],
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

describe.skipIf(!hasDump)('the quote document and the share link', () => {
  let ctx: TestApp;
  let cookie: string;
  let booksDir: string;
  let quoteId: string;
  let revisionId: string;
  let contractCents: number;
  const originalBooks = process.env.PRICE_BOOKS;
  const originalCache = process.env.PDF_CACHE;

  beforeAll(async () => {
    booksDir = mkdtempSync(join(tmpdir(), 'sq-doc-books-'));
    process.env.PRICE_BOOKS = booksDir;
    // A scratch cache, so a test never reads a PDF rendered by an earlier run.
    process.env.PDF_CACHE = mkdtempSync(join(tmpdir(), 'sq-doc-cache-'));
    publishPriceBook(DUMP, booksDir);

    ctx = await makeTestApp(testConfig());
    await seedCompany(ctx.db, {
      name: 'Document Test Sheds',
      slug: 'document-test',
      email: 'estimator@doc.test',
      password: 'a-long-enough-password',
      role: 'company_admin',
    });
    cookie = await signIn(ctx.app, 'estimator@doc.test', 'a-long-enough-password');

    const { publishAndActivate } = await import('../lib/priceBook');
    await publishAndActivate(ctx.db, {
      dumpDir: DUMP,
      publishedByUserId: 'test',
      publishedByEmail: 'test@vendor',
    });

    const evaluated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing },
    });
    contractCents = evaluated.json().data.price.contractCents;

    const saved = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: {
        evaluationId: evaluated.json().data.evaluationId,
        idempotencyKey: 'document-test-1',
        expectedRev: 0,
        customer: {
          firstName: 'Jane',
          lastName: 'Citizen',
          email: 'jane@example.com',
          address: '12 Test Road',
          suburb: 'Brisbane',
          state: 'QLD',
          postcode: '4000',
        },
        site: { address: '12 Test Road, Brisbane QLD 4000', deliveryAcknowledged: true },
        config: config(),
        pricing,
      },
    });

    quoteId = saved.json().data.quoteId;
    revisionId = saved.json().data.revisionId;
  });

  afterAll(async () => {
    await ctx.close();
    // The price books are held open for the processs life; an open SQLite handle makes the
    // directory undeletable on Windows, so they are closed before the scratch directory goes.
    const { closeAllBooks } = await import('../lib/priceBook');
    closeAllBooks();
    if (originalBooks === undefined) delete process.env.PRICE_BOOKS;
    else process.env.PRICE_BOOKS = originalBooks;
    if (originalCache === undefined) delete process.env.PDF_CACHE;
    else process.env.PDF_CACHE = originalCache;
    rmSync(booksDir, { recursive: true, force: true });
  });

  /** The document's visible text, with the stylesheet and tags removed. */
  async function documentText(): Promise<string> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}/revisions/1/html`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);

    return response.body
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  it('serves the HTML as a page, not as a download prompt', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}/revisions/1/html`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    // `inline`, so an operator who opens it in a tab reads it instead of downloading it.
    expect(String(response.headers['content-disposition'])).toContain('inline');
  });

  it('names the colours in words, never in hex', async () => {
    const text = await documentText();
    expect(text).toMatch(/Shale Grey/);
    expect(text).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('prints the contract price and stages that sum to it', async () => {
    const text = await documentText();
    const printed = (text.match(/\$[\d,]+\.\d\d/g) ?? []).map((value) =>
      Number(value.replace(/[$,]/g, '')),
    );

    expect(printed).toContain(contractCents / 100);

    // The last three money figures on the page are the three stages.
    const stages = printed.slice(-3);
    const sum = stages.reduce((total, value) => total + value, 0);
    expect(Math.round(sum * 100)).toBe(contractCents);
  });

  it('leaks no cost, no margin and no internal code', async () => {
    const text = await documentText();

    // The material cost of the sample building in the browser run was $12,556.30. Nothing resembling
    // it may appear, and neither may the words that would explain it.
    expect(text).not.toMatch(/\bmaterial cost\b/i);
    expect(text).not.toMatch(/\bmargin\b/i);
    expect(text).not.toMatch(/\bkit price\b/i);
    expect(text).not.toMatch(/\bBOM\b/);
    expect(text).not.toMatch(/UNIT_ASSUMED|FRAME_SECTION_ASSUMED|GIRT_PRICE_FROM_PURLIN/);
    // A warning describes how a price-book row was read; a buyer learns nothing from it.
    expect(text).not.toMatch(/\bprice book\b/i);
  });

  it('carries no advertising for another product', async () => {
    const text = await documentText();
    expect(text).not.toMatch(/Demo quotation/);
    expect(text).not.toMatch(/WhatsApp/);
    expect(text).not.toMatch(/NOT FOR CONSTRUCTION/);
  });

  it('states the site conditions an Australian quote must show', async () => {
    const text = await documentText();
    for (const label of ['Wind region', 'Terrain category', 'Importance level']) {
      expect(text).toContain(label);
    }
  });

  it('mints a link whose token is in the fragment, never in the path', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/quotes/${quoteId}/shares`,
      headers: { cookie },
      payload: { revisionId, expiresInDays: 30 },
    });

    expect(response.statusCode).toBe(201);
    const { url } = response.json().data;

    // A fragment is never sent to a server, so the token stays out of proxy logs and Referer headers.
    expect(url).toContain('/s#');
    expect(url.split('#')[1]?.length).toBeGreaterThan(30);
    // The path itself must not carry it.
    expect(url.split('#')[0]).not.toMatch(/[A-Za-z0-9_-]{30,}/);
  });

  it('redeems a link into a cookie, and serves the same page the operator sees', async () => {
    const minted = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/quotes/${quoteId}/shares`,
      headers: { cookie },
      payload: { revisionId, expiresInDays: 30 },
    });
    const token = (minted.json().data.url as string).split('#')[1] as string;

    // No session: the token is the credential.
    const redeemed = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/share/redeem',
      payload: { token },
    });
    expect(redeemed.statusCode).toBe(200);

    const raw = redeemed.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : [raw ?? ''];
    const shareCookie = (cookies.find((value) => value.startsWith('sq_share=')) ?? '').split(';')[0];

    const shared = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/share/document',
      headers: { cookie: shareCookie as string },
    });
    expect(shared.statusCode).toBe(200);

    const operator = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}/revisions/1/html`,
      headers: { cookie },
    });

    // The customer's copy and the operator's copy are the same page.
    expect(shared.body).toBe(operator.body);

    // A shared quote is private: no caching by a proxy, no indexing by a crawler.
    expect(String(shared.headers['cache-control'])).toContain('no-store');
    expect(String(shared.headers['x-robots-tag'])).toContain('noindex');
  });

  it('refuses an unknown token and a forged share cookie identically', async () => {
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/share/redeem',
      payload: { token: 'z'.repeat(43) },
    });
    expect(unknown.statusCode).toBe(404);

    const forged = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/share/document',
      headers: { cookie: 'sq_share=not-a-real-share' },
    });
    expect(forged.statusCode).toBe(404);

    // The same message, so neither answer tells a stranger whether that link ever existed.
    expect(unknown.json().message).toBe(forged.json().message);
  });

  it('refuses to open the document without a session or a share', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}/revisions/1/html`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a revision that does not exist', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}/revisions/99/html`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
  });

  it('revokes a link, and the revoked link stops working', async () => {
    const minted = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/quotes/${quoteId}/shares`,
      headers: { cookie },
      payload: { revisionId, expiresInDays: 30 },
    });
    const { id, url } = minted.json().data;
    const token = (url as string).split('#')[1] as string;

    const revoked = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/quotes/${quoteId}/shares/${id}`,
      headers: { cookie },
    });
    expect(revoked.statusCode).toBe(200);

    const after = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/share/redeem',
      payload: { token },
    });
    expect(after.statusCode).toBe(404);
  });

  it('records the platform logo hash on the revision it saves', async () => {
    /*
     * The freeze half of the logo feature. `logoDocument.test.ts` proves a document renders the logo
     * its revision recorded; this proves the revision records one in the first place, which can only
     * be checked where a real save happens.
     */
    const logoDir = mkdtempSync(join(tmpdir(), 'sq-doc-logo-'));
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082',
      'hex',
    );
    const file = join(logoDir, 'logo.png');
    writeFileSync(file, png);
    const original = process.env.LOGO_FILE;
    process.env.LOGO_FILE = file;

    try {
      const evaluated = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/evaluate',
        headers: { cookie },
        payload: { config: config(), pricing },
      });

      const saved = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        headers: { cookie },
        payload: {
          quoteId,
          evaluationId: evaluated.json().data.evaluationId,
          idempotencyKey: 'document-test-logo',
          expectedRev: 1,
          customer: {
            firstName: 'Jane',
            lastName: 'Citizen',
            email: 'jane@example.com',
            address: '12 Test Road',
            suburb: 'Brisbane',
            state: 'QLD',
            postcode: '4000',
          },
          site: { address: '12 Test Road, Brisbane QLD 4000', deliveryAcknowledged: true },
          config: config(),
          pricing,
        },
      });
      // 201: appending a revision to an existing quote is still a created resource.
      expect(saved.statusCode).toBe(201);
      expect(saved.json().ok).toBe(true);

      const row = await ctx.db.get<{ company_json: string }>(
        'SELECT company_json FROM quote_revisions WHERE quote_id = ? AND revision = 2',
        [quoteId],
      );
      const company = JSON.parse(row?.company_json ?? '{}') as { logoHash?: string | null };
      expect(company.logoHash).toBe(createHash('sha256').update(png).digest('hex'));

      // And the document served for that revision carries the image.
      const html = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/quotes/${quoteId}/revisions/2/html`,
        headers: { cookie },
      });
      expect(html.body).toContain('data:image/png;base64,');
    } finally {
      if (original === undefined) delete process.env.LOGO_FILE;
      else process.env.LOGO_FILE = original;
      rmSync(logoDir, { recursive: true, force: true });
    }
  });
});
