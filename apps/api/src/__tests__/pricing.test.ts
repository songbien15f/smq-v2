import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { publishPriceBook } from '@sq/core/pricing';
import { DEFAULT_SHED, normaliseShedConfig } from '@sq/core/domain';
import { makeTestApp, seedCompany, signIn, testConfig, type TestApp } from './helpers';

/**
 * Pricing and saving, against the **real** licensed price book.
 *
 * Not a fixture: the whole point of this file is that the engine, the book and the database
 * agree. A mocked lookup would let the route pass while the product priced nothing.
 *
 * The dump is git-ignored and may be absent on a fresh clone, so the whole file skips in that
 * case rather than failing — but it is run whenever the dump is there, which is whenever anyone
 * can actually use the product.
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

/**
 * A shed config, as the editor would send it.
 *
 * Built through `normaliseShedConfig`, exactly as the client does, rather than hand-written.
 * A hand-written literal misses the fields the schema requires — an opening's `track`, `sill`
 * and `align` among them — and the failure is a 422 that reads like a bug in the route. The
 * normaliser is the one place that knows every default, so using it here means the test cannot
 * drift from what the product actually posts.
 */
function config(): Record<string, unknown> {
  return normaliseShedConfig({
    ...DEFAULT_SHED,
    structureType: 'gable',
    span: 9000,
    length: 18000,
    height: 3000,
    roofPitchDeg: 22.5,
    bays: 3,
    windRegion: 'A',
    terrainCategory: 2.5,
    stateCode: 'QLD',
    openings: [
      { id: 'o1', type: 'roller_door', wall: 'front', u: 4500, width: 3000, height: 2400 },
    ],
  }) as unknown as Record<string, unknown>;
}

/**
 * The money an operator controls.
 *
 * The three overrides are given as `null` rather than omitted, because the contract
 * distinguishes "the operator typed this" from "the engine worked it out" — and a request that
 * omits them would not exercise the default that produces that distinction.
 */
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

describe.skipIf(!hasDump)('pricing and saving with the real price book', () => {
  let ctx: TestApp;
  let cookie: string;
  let booksDir: string;
  const originalBooks = process.env.PRICE_BOOKS;

  beforeAll(async () => {
    booksDir = mkdtempSync(join(tmpdir(), 'sq-api-books-'));
    // The API reads the book from here, so the test publishes into it first.
    process.env.PRICE_BOOKS = booksDir;
    publishPriceBook(DUMP, booksDir);

    ctx = await makeTestApp(testConfig());
    await seedCompany(ctx.db, {
      name: 'Pricing Test Sheds',
      slug: 'pricing-test',
      email: 'estimator@pricing.test',
      password: 'a-long-enough-password',
      role: 'company_admin',
    });
    cookie = await signIn(ctx.app, 'estimator@pricing.test', 'a-long-enough-password');
  });

  afterAll(async () => {
    await ctx.close();
    // The books are held open for the process's life; on Windows an open handle makes the
    // directory undeletable, so a test that published into a temp dir must close them first.
    const { closeAllBooks } = await import('../lib/priceBook');
    closeAllBooks();
    if (originalBooks === undefined) delete process.env.PRICE_BOOKS;
    else process.env.PRICE_BOOKS = originalBooks;
    rmSync(booksDir, { recursive: true, force: true });
  });

  it('refuses to price before a book is published', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing },
    });

    // A deployment step, not a bad request: the operator cannot fix this by editing the form.
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('not_configured');
    expect(response.json().message).toMatch(/price book/i);
  });

  it('prices a shed through the real book, and reports what it does not know', async () => {
    // Publishing through the API, as an administrator would.
    const { publishAndActivate } = await import('../lib/priceBook');
    const company = await ctx.db.get<{ id: string }>("SELECT id FROM tenants WHERE slug = 'pricing-test'");
    await publishAndActivate(ctx.db, {
      dumpDir: DUMP,
      publishedByUserId: 'test-admin',
      publishedByEmail: 'admin@vendor.test',
      note: 'test book',
    });
    expect(company).not.toBeNull();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing },
    });

    expect(response.statusCode).toBe(200);
    const view = response.json().data;

    // The price chain is complete and internally consistent.
    expect(view.price.contractCents).toBeGreaterThan(0);
    expect(view.price.contractCents).toBe(
      view.price.totalCents + Math.round(view.price.totalCents * (view.price.quoteRatePct / 100)) + view.price.additionsCents,
    );
    // The three stages sum to the contract exactly — the balance is the remainder, never a
    // fourth rounding.
    expect(view.price.depositCents + view.price.progressCents + view.price.balanceCents).toBe(
      view.price.contractCents,
    );

    // The BOM has lines and no placeholders: a mocked line would mean the book is missing data
    // the engine asked for.
    expect(view.lines.length).toBeGreaterThan(10);
    expect(view.lines.filter((line: { mocked: boolean }) => line.mocked)).toEqual([]);

    // The girt caveat is present, because the reference book lists no girt material. This is the
    // reason the quote reads as *indicative* rather than firm.
    const codes = view.issues.map((issue: { code: string }) => issue.code);
    expect(codes).toContain('GIRT_PRICE_FROM_PURLIN');
    expect(view.status).toBe('indicative');

    // And it carries a preview id and an expiry, because a preview is not a quote.
    expect(view.evaluationId).toBeTruthy();
    expect(Date.parse(view.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('saves the price the operator saw, as an immutable revision', async () => {
    const evaluated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing },
    });
    expect(evaluated.statusCode).toBe(200);
    const view = evaluated.json().data;

    const saved = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: {
        evaluationId: view.evaluationId,
        idempotencyKey: 'test-key-0001',
        expectedRev: 0,
        customer: {
          firstName: 'Jane',
          lastName: 'Citizen',
          email: 'jane@example.com',
          address: '1 Test Street',
        },
        site: {
          address: '1 Test Street, Brisbane QLD 4000',
          deliveryScope: 'Delivered to site',
          deliveryAcknowledged: true,
        },
        config: config(),
        pricing,
      },
    });

    expect(saved.statusCode).toBe(201);
    const result = saved.json().data;
    expect(result.quoteNumber).toMatch(/^Q-\d{4}-0001$/);
    expect(result.revision).toBe(1);
    // The saved figure is the one that was on screen, not a recomputation.
    expect(result.contractCents).toBe(view.price.contractCents);

    // The revision is frozen: its stored price equals what was shown.
    const stored = await ctx.db.get<{ price_json: string; config_json: string; contract_cents: number }>(
      'SELECT price_json, config_json, contract_cents FROM quote_revisions WHERE id = ?',
      [result.revisionId],
    );
    expect(stored?.contract_cents).toBe(view.price.contractCents);
    expect(JSON.parse(stored?.price_json as string).contractCents).toBe(view.price.contractCents);
  });

  it('treats a repeated save with the same key as one revision', async () => {
    const evaluated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing },
    });

    const payload = {
      evaluationId: evaluated.json().data.evaluationId,
      idempotencyKey: 'test-key-double-click',
      expectedRev: 0,
      customer: {
        firstName: 'Jane',
        lastName: 'Citizen',
        email: 'jane@example.com',
        address: '1 Test Street',
      },
      site: { address: '1 Test Street', deliveryAcknowledged: true },
      config: config(),
      pricing,
    };

    const first = await ctx.app.inject({ method: 'POST', url: '/api/v1/quotes', headers: { cookie }, payload });
    const second = await ctx.app.inject({ method: 'POST', url: '/api/v1/quotes', headers: { cookie }, payload });

    expect(first.statusCode).toBe(201);
    // The replay is a 200, not a second 201: the caller can tell a new revision from a repeat.
    expect(second.statusCode).toBe(200);
    expect(second.json().data.replayed).toBe(true);
    expect(second.json().data.revisionId).toBe(first.json().data.revisionId);

    const count = await ctx.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM quote_revisions WHERE idempotency_key = 'test-key-double-click'",
    );
    expect(Number(count?.n)).toBe(1);
  });

  /**
   * The three editable figures — the whole of the Cost step.
   *
   * The desktop lets an operator change exactly three things: the contract price, the deposit
   * and the progress payment. Everything else is derived, and letting anything else be typed
   * would let a quote be presented at a loss without anybody deciding to.
   *
   * They are applied on top of the computed chain rather than inside the engine, which is what
   * keeps a discounted quote reporting the same building cost — the reason "why did we sell that
   * at a loss" stays answerable from the revision.
   */
  it('applies the operator contract price and re-derives the payment stages', async () => {
    const evaluated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing },
    });
    const computed = evaluated.json().data;
    expect(computed.price.overridden).toEqual({ contract: false, deposit: false, progress: false });

    // A negotiated total below the computed one — the case a discount produces.
    const negotiated = computed.price.contractCents - 250_000;
    const overridden = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing: { ...pricing, contractOverrideCents: negotiated } },
    });

    expect(overridden.statusCode).toBe(200);
    const price = overridden.json().data.price;

    expect(price.contractCents).toBe(negotiated);
    expect(price.overridden.contract).toBe(true);
    // The stages follow the percentages, applied to the negotiated total.
    expect(price.depositCents).toBe(Math.round(negotiated * 0.1));
    expect(price.progressCents).toBe(Math.round(negotiated * 0.7));
    // The balance is the remainder, so the three sum exactly — a 10/70 split of an odd number of
    // cents would otherwise leave a one-cent hole.
    expect(price.depositCents + price.progressCents + price.balanceCents).toBe(negotiated);

    // The material cost is untouched: an override is a commercial decision, not a cheaper shed.
    expect(price.buildingCostCents).toBe(computed.price.buildingCostCents);
    expect(price.margin).toBe(computed.price.margin);
  });

  it('accepts a typed deposit and progress, and still sums to the contract', async () => {
    const evaluated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing },
    });
    const contract = evaluated.json().data.price.contractCents;

    const staged = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: {
        config: config(),
        pricing: {
          ...pricing,
          // Typed rather than expressed as percentages, the way an operator agrees it in the room.
          depositOverrideCents: Math.round(contract * 0.05),
          progressOverrideCents: Math.round(contract * 0.65),
        },
      },
    });

    expect(staged.statusCode).toBe(200);
    const price = staged.json().data.price;
    expect(price.overridden).toEqual({ contract: false, deposit: true, progress: true });
    expect(price.depositCents + price.progressCents + price.balanceCents).toBe(price.contractCents);
    expect(price.balanceCents).toBe(price.contractCents - price.depositCents - price.progressCents);
  });

  it('saves the negotiated total, not the computed one', async () => {
    // The defect the single shared pricing schema closed: the evaluation accepted an override and
    // the save did not, so an operator could type a negotiated price, see it, press Save, and
    // have it silently replaced by the computed figure.
    const evaluated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing },
    });
    const negotiated = evaluated.json().data.price.contractCents - 100_000;
    const negotiatedPricing = { ...pricing, contractOverrideCents: negotiated };

    const overridden = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing: negotiatedPricing },
    });

    const saved = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: {
        evaluationId: overridden.json().data.evaluationId,
        idempotencyKey: 'test-override-save',
        expectedRev: 0,
        customer: { firstName: 'Neg', lastName: 'Otiated', email: 'neg@example.com', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: config(),
        pricing: negotiatedPricing,
      },
    });

    expect(saved.statusCode).toBe(201);
    expect(saved.json().data.contractCents).toBe(negotiated);

    const stored = await ctx.db.get<{ price_json: string }>(
      'SELECT price_json FROM quote_revisions WHERE id = ?',
      [saved.json().data.revisionId],
    );
    const storedPrice = JSON.parse(stored?.price_json as string);
    expect(storedPrice.contractCents).toBe(negotiated);
    expect(storedPrice.overridden.contract).toBe(true);
  });

  it('refuses a save whose negotiated total changed after the preview', async () => {
    const evaluated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing },
    });
    const view = evaluated.json().data;

    // The operator re-negotiated after the preview was taken. The screen showed a different
    // number, so saving would record a figure nobody looked at.
    const saved = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: {
        evaluationId: view.evaluationId,
        idempotencyKey: 'test-override-changed',
        expectedRev: 0,
        customer: { firstName: 'A', lastName: 'B', email: 'oc@example.com', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: config(),
        pricing: { ...pricing, contractOverrideCents: view.price.contractCents - 500_000 },
      },
    });

    expect(saved.statusCode).toBe(409);
    expect(saved.json().message).toMatch(/changed/i);
  });

  it('refuses a save whose config changed after the price was calculated', async () => {
    const evaluated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing },
    });
    const view = evaluated.json().data;

    // The operator widened the shed after seeing the price. The number on screen is no longer
    // this building, so saving it would send a customer the wrong figure.
    const changed = { ...config(), span: 12000 };

    const saved = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: {
        evaluationId: view.evaluationId,
        idempotencyKey: 'test-key-changed',
        expectedRev: 0,
        customer: { firstName: 'A', lastName: 'B', email: 'ab@example.com', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: changed,
        pricing,
      },
    });

    expect(saved.statusCode).toBe(409);
    expect(saved.json().message).toMatch(/changed/i);
  });

  it('refuses a second save of the same preview', async () => {
    const evaluated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing },
    });
    const view = evaluated.json().data;

    const base = {
      evaluationId: view.evaluationId,
      expectedRev: 0,
      customer: { firstName: 'A', lastName: 'B', email: 'twice@example.com', address: 'x' },
      site: { address: 'x', deliveryAcknowledged: true },
      config: config(),
      pricing,
    };

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: { ...base, idempotencyKey: 'test-key-once-a' },
    });
    expect(first.statusCode).toBe(201);

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: { ...base, idempotencyKey: 'test-key-once-b' },
    });

    // A different idempotency key is a different *intent*, but the preview has already been
    // spent. Saving it again would create a second revision from one price the operator saw
    // once, which is how a quote quietly duplicates.
    expect(second.statusCode).toBe(409);
    expect(second.json().message).toMatch(/already been saved/i);
  });

  it('appends a revision to an existing quote, refusing a stale expected revision', async () => {
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing },
    });
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: {
        evaluationId: first.json().data.evaluationId,
        idempotencyKey: 'test-rev-base',
        expectedRev: 0,
        customer: { firstName: 'Rev', lastName: 'Cust', email: 'rev@example.com', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: config(),
        pricing,
      },
    });
    const quoteId = created.json().data.quoteId;

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing },
    });
    const appended = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: {
        quoteId,
        evaluationId: second.json().data.evaluationId,
        idempotencyKey: 'test-rev-two',
        expectedRev: 1,
        customer: { firstName: 'Rev', lastName: 'Cust', email: 'rev@example.com', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: config(),
        pricing,
        revisionName: 'Bigger door',
      },
    });

    expect(appended.statusCode).toBe(201);
    expect(appended.json().data.revision).toBe(2);

    // A third save that still believes it is appending after revision 1 is refused: two tabs
    // must not both claim revision 2.
    const stale = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing },
    });
    const refused = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: {
        quoteId,
        evaluationId: stale.json().data.evaluationId,
        idempotencyKey: 'test-rev-stale',
        expectedRev: 1,
        customer: { firstName: 'Rev', lastName: 'Cust', email: 'rev@example.com', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: config(),
        pricing,
      },
    });

    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toMatch(/revision 2/);
  });

  /**
   * The factory method a company chose must actually price the quote.
   *
   * `bomProfileId` was stored on the settings row and read by nothing: the evaluate route built its
   * policy without a `bom`, so every quote in the product used `DEFAULT_BOM_RULES` and the control
   * on the settings screen was decorative. This asserts the wiring end to end — a company that
   * switches to "heavy fixing" gets more bolts per column, more screws per crossing and a bigger
   * footing allowance, and therefore a different contract price.
   */
  it('prices under the factory method the company chose', async () => {
    type Line = { description: string; quantity: number };
    const evaluate = async (): Promise<{ price: { contractCents: number }; lines: Line[] }> => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/evaluate',
        headers: { cookie },
        payload: { config: config(), pricing },
      });
      expect(response.statusCode).toBe(200);
      return response.json().data;
    };

    const standard = await evaluate();

    // Switch the company to the heavy-fixing profile through the settings route, as an operator
    // would, rather than writing the row behind the API's back.
    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: { cookie },
      payload: { bomProfileId: 'heavy-fixing' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.bomProfileId).toBe('heavy-fixing');

    const heavy = await evaluate();

    // The two profiles differ in bolts, screws and footings, so the money must move. A profile that
    // changed nothing would satisfy a weaker test while leaving the setting inert.
    expect(heavy.price.contractCents).not.toBe(standard.price.contractCents);

    // And the difference is in the fixing lines, not an accident of rounding.
    const bolts = (lines: Line[]): number =>
      lines.filter((line) => /bolt/i.test(line.description)).reduce((total, line) => total + line.quantity, 0);
    expect(bolts(heavy.lines)).toBeGreaterThan(bolts(standard.lines));

    // Put it back, so a later test in this file is not priced under a profile it did not choose.
    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: { cookie },
      payload: { bomProfileId: 'default' },
    });
  });

  /**
   * A site check pinned before the quote existed is linked on the first save.
   *
   * The desktop pins while Step 1 is still being filled; the check therefore has no quote
   * to belong to yet. This is the half that makes that flow work — the pin route itself is
   * exercised against ShedSafe's own transport tests.
   */
  it('links a site check that was pinned before the quote was saved', async () => {
    const tenant = await ctx.db.get<{ id: string }>("SELECT id FROM tenants WHERE slug = 'pricing-test'");
    expect(tenant).not.toBeNull();

    const checkId = 'chk-pre-save-1';
    await ctx.db.run(
      `INSERT INTO site_checks (id, tenant_id, reference, status, pinned_at, updated_at)
       VALUES (?, ?, 'REF-PRE-SAVE', 'pinned', ?, ?)`,
      [checkId, tenant!.id, new Date().toISOString(), new Date().toISOString()],
    );

    const evaluated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing },
    });
    expect(evaluated.statusCode).toBe(200);

    const saved = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: {
        evaluationId: evaluated.json().data.evaluationId,
        idempotencyKey: 'test-site-check-link',
        expectedRev: 0,
        siteCheckId: checkId,
        customer: { firstName: 'Site', lastName: 'Check', email: 'sc@example.com', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: config(),
        pricing,
      },
    });
    expect(saved.statusCode).toBe(201);

    const stored = await ctx.db.get<{ site_check_id: string | null }>(
      'SELECT site_check_id FROM quotes WHERE id = ?',
      [saved.json().data.quoteId],
    );
    expect(stored?.site_check_id).toBe(checkId);
  });

  /**
   * A revision's label may change; its content may not.
   *
   * The append-only trigger refused every UPDATE. `010_revision_label` narrows it to the frozen
   * columns, so a rename lands and a changed contract still aborts.
   */
  it('copies a quote into an independent quote with its own number', async () => {
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
        evaluationId: evaluated.json().data.evaluationId,
        idempotencyKey: 'test-copy-source',
        expectedRev: 0,
        customer: { firstName: 'Copy', lastName: 'Source', email: 'cp@example.com', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: config(),
        pricing,
      },
    });
    expect(saved.statusCode).toBe(201);
    const source = saved.json().data;

    const copied = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/quotes/${source.quoteId}/copy`,
      headers: { cookie },
    });
    expect(copied.statusCode).toBe(201);
    const copy = copied.json().data;

    expect(copy.quoteId).not.toBe(source.quoteId);
    expect(copy.quoteNumber).not.toBe(source.quoteNumber);
    expect(copy.revision).toBe(1);

    const row = await ctx.db.get<{ contract_cents: number }>(
      'SELECT contract_cents FROM quote_revisions WHERE quote_id = ? AND revision = 1',
      [copy.quoteId],
    );
    expect(row?.contract_cents).toBe(source.contractCents);
  });

  it('renames a revision without touching its frozen content', async () => {
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
        evaluationId: evaluated.json().data.evaluationId,
        idempotencyKey: 'test-rename-revision',
        expectedRev: 0,
        customer: { firstName: 'Re', lastName: 'Name', email: 'rn@example.com', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: config(),
        pricing,
      },
    });
    expect(saved.statusCode).toBe(201);
    const quoteId = saved.json().data.quoteId;
    const before = await ctx.db.get<{ config_json: string; contract_cents: number }>(
      'SELECT config_json, contract_cents FROM quote_revisions WHERE quote_id = ? AND revision = 1',
      [quoteId],
    );

    const renamed = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/quotes/${quoteId}/revisions/1`,
      headers: { cookie },
      payload: { name: 'Option B — bigger door' },
    });
    expect(renamed.statusCode).toBe(200);

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}/revisions`,
      headers: { cookie },
    });
    const row = list.json().data.items.find((item: { revision: number }) => item.revision === 1);
    expect(row.name).toBe('Option B — bigger door');

    const after = await ctx.db.get<{ config_json: string; contract_cents: number }>(
      'SELECT config_json, contract_cents FROM quote_revisions WHERE quote_id = ? AND revision = 1',
      [quoteId],
    );
    expect(after?.config_json).toBe(before?.config_json);
    expect(after?.contract_cents).toBe(before?.contract_cents);
  });

  /**
   * The internal breakdown is a capability, not a screen preference.
   *
   * `cost:read` lets an estimator quote from the sell price; the material cost, the
   * margin and the kit price belong to `cost:margin`. Hiding the rows in the UI while
   * the API still returned them would be a courtesy — this asserts the server removes
   * them, and that the sell side survives.
   */
  it('hides the internal cost breakdown from an estimator', async () => {
    await seedCompany(ctx.db, {
      name: 'Estimator Sheds',
      slug: 'estimator-test',
      email: 'est@estimator.test',
      password: 'a-long-enough-password',
      role: 'estimator',
    });
    const estimatorCookie = await signIn(ctx.app, 'est@estimator.test', 'a-long-enough-password');

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie: estimatorCookie },
      payload: { config: config(), pricing },
    });

    expect(response.statusCode).toBe(200);
    const view = response.json().data;
    expect(view.price.margin).toBeUndefined();
    expect(view.price.buildingCostCents).toBeUndefined();
    expect(view.price.totalCostCents).toBeUndefined();
    expect(view.price.kitCents).toBeUndefined();
    expect(view.lines).toEqual([]);
    // The figures an estimator quotes from are still there.
    expect(view.price.contractCents).toBeGreaterThan(0);
    expect(view.price.depositCents).toBeGreaterThan(0);
  });
});
