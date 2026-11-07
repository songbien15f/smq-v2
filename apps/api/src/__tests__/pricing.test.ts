import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { publishPriceBook } from '@sq/core/pricing';
import { readLegacyPlan } from '@sq/core/quoteFile';
import { DEFAULT_SHED, normaliseShedConfig } from '@sq/core/domain';
import { makeTestApp, seedCompany, signIn, testConfig, type TestApp } from './helpers';

/** A roller door as the desktop writes one: a 3 000 × 2 800 series B. */
function rollerDoor(): Record<string, unknown> {
  return {
    OptionPart: { RelativeLocation: { X: 500, Y: 0, Z: 0 }, GroupId: null },
    RDoorType: 'B',
    PrepOnly: false,
    WindLock: true,
    Height: 2800,
    Width: 3000,
  };
}

/** A window as the desktop writes one: 589 × 790, sill 1 200. */
function window(): Record<string, unknown> {
  return {
    OptionPart: { RelativeLocation: { X: 1581, Y: 1200, Z: 0 }, GroupId: null },
    WindowType: 'H790xW589 AMI S-Win (N5)',
    PrepOnly: false,
    Height: 790,
    Width: 589,
  };
}

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

  /**
   * A building converted from a legacy `.sqd`, priced by this engine.
   *
   * The conversion has its own unit tests (`@sq/core`), and the route has its own; what neither can
   * prove is that the **converted building is a building the book can price**. A mapping that reads
   * every field correctly and still produces a skillion with no rafter row would pass both and fail
   * the only thing the operator cares about.
   */
  it('prices a building converted from a legacy .sqd file', async () => {
    const plan = readLegacyPlan({
      RevisionId: 1,
      RevisionName: 'Original',
      HousePlan: {
        Width: 6000,
        Height: 3000,
        BuildingPlan: {
          StructureType: 'GB_TH64',
          WindRegion: 'A',
          TerrainCategory: 2.5,
          ImportanceLevel: 2,
          StateCode: 'QLD',
          RoofPitch: 10,
          Width: 6000,
          Height: 3000,
          NormalBaySize: 4000,
          Bays: [
            { Index: 0, Length: 4000, Position: 0 },
            { Index: 1, Length: 4000, Position: 4000 },
            { Index: 2, Length: 4000, Position: 8000 },
            { Index: 2, Length: 0, Position: 12000 },
          ],
          EndWalls: [],
          // A roller door in the first bay of a long side, and a window in the last one.
          FrontWall: {
            Direction: 0,
            SubWalls: [
              { Index: 0, OptionParts: { RDoorOptions: [rollerDoor()] } },
              { Index: 1, OptionParts: {} },
              { Index: 2, OptionParts: { WindowOptions: [window()] } },
            ],
          },
          RearWall: { Direction: 1, SubWalls: [] },
        },
      },
      MiscOptions: [
        {
          Item: { Unit: 'm', Size: 'Ausmesh Safety Wire - 1800 per L/M', Price: 1.14 },
          Quantity: 5,
        },
      ],
    });

    expect(plan).not.toBeNull();

    // Exactly what the editor does with the converted config before it posts it.
    const converted = normaliseShedConfig(plan?.config) as unknown as Record<string, unknown>;

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: converted, pricing },
    });

    expect(response.statusCode).toBe(200);
    const view = response.json().data;
    expect(view.price.contractCents).toBeGreaterThan(0);
    expect(view.lines.length).toBeGreaterThan(10);
    // A placeholder line would mean the converted building asked the book for something it has.
    expect(view.lines.filter((line: { mocked: boolean }) => line.mocked)).toEqual([]);

    // The door and the window came across as openings the BOM prices, rather than as data on a
    // config nobody read.
    const descriptions = view.lines
      .map((line: { description: string }) => line.description)
      .join(' | ')
      .toLowerCase();
    expect(descriptions).toContain('roller');
    expect(descriptions).toContain('window');
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
  it('deletes a quote as a status, keeping the record', async () => {
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
        idempotencyKey: 'test-delete-quote',
        expectedRev: 0,
        customer: { firstName: 'Del', lastName: 'Eted', email: 'del@example.com', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: config(),
        pricing,
      },
    });
    const quoteId = saved.json().data.quoteId;

    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/quotes/${quoteId}`,
      headers: { cookie },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data.status).toBe('deleted');

    const reopened = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}`,
      headers: { cookie },
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().data.status).toBe('deleted');
    // The revision is still there: deleting a quote is not deleting the evidence.
    const revisions = await ctx.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM quote_revisions WHERE quote_id = ?',
      [quoteId],
    );
    expect(Number(revisions?.n)).toBe(1);
  });

  it('serves the plan as a drawing sheet with no money on it', async () => {
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
        idempotencyKey: 'test-plan-sheet',
        expectedRev: 0,
        customer: { firstName: 'Plan', lastName: 'Sheet', email: 'ps@example.com', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: config(),
        pricing,
      },
    });

    const plan = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${saved.json().data.quoteId}/revisions/1/plan`,
      headers: { cookie },
    });
    expect(plan.statusCode).toBe(200);
    expect(plan.headers['content-type']).toMatch(/text\/html/);
    expect(plan.body).toContain('<svg');
    expect(plan.body).toContain('A4 landscape');
    // A drawing a workshop pins up carries no price and no customer contact.
    expect(plan.body).not.toContain('Contract price');
    expect(plan.body).not.toContain('ps@example.com');
  });

  it('serves a supplier copy with no client price, and refuses an unknown kind', async () => {
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
        idempotencyKey: 'test-print-kinds',
        expectedRev: 0,
        customer: { firstName: 'Pri', lastName: 'Nted', email: 'pr@example.com', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: config(),
        pricing,
      },
    });
    const quoteId = saved.json().data.quoteId;
    const contract = (saved.json().data.contractCents / 100).toLocaleString('en-AU', {
      minimumFractionDigits: 2,
    });

    const client = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}/revisions/1/html`,
      headers: { cookie },
    });
    expect(client.statusCode).toBe(200);
    expect(client.body).toContain(contract);

    const supplier = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}/revisions/1/html?kind=order`,
      headers: { cookie },
    });
    expect(supplier.statusCode).toBe(200);
    // The margin is the difference between these two; a supplier copy must not show it.
    expect(supplier.body).not.toContain(contract);
    expect(supplier.body).toContain('<h1>Order</h1>');

    const bogus = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}/revisions/1/html?kind=payslip`,
      headers: { cookie },
    });
    expect(bogus.statusCode).toBe(422);
  });

  it('exports the desktop .vqu with colour names, not hex', async () => {
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
        idempotencyKey: 'test-vqu-export',
        expectedRev: 0,
        customer: { firstName: 'Vee', lastName: 'Queue', email: 'vq@example.com', address: 'x' },
        site: { address: '1 Site St', suburb: 'Brisbane', state: 'QLD', postcode: '4000', deliveryAcknowledged: true },
        config: config(),
        pricing,
      },
    });
    expect(saved.statusCode).toBe(201);

    const vqu = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${saved.json().data.quoteId}/revisions/1/export/vqu`,
      headers: { cookie },
    });
    expect(vqu.statusCode).toBe(200);
    expect(vqu.headers['content-type']).toMatch(/iso-8859-1/);

    const text = vqu.body;
    for (const section of ['[QUOTE DETAILS]', '[SHED DETAILS]', '[OPTIONS]']) {
      expect(text).toContain(section);
    }
    // The tool matches a colour by name; a hex would match nothing.
    expect(text).toMatch(/WallColour=[^#\r\n]+/);
    expect(text).not.toMatch(/WallColour=#/);
    expect(text).toMatch(/NumMiscOptions=\d+/);
  });

  it('exports the frozen BOM as CSV, with a header and a total', async () => {
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
        idempotencyKey: 'test-bom-csv',
        expectedRev: 0,
        customer: { firstName: 'Csv', lastName: 'Export', email: 'csv@example.com', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: config(),
        pricing,
      },
    });
    expect(saved.statusCode).toBe(201);

    const csv = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${saved.json().data.quoteId}/revisions/1/bom?format=csv`,
      headers: { cookie },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);

    const lines = csv.body.split('\r\n');
    expect(lines[0]).toBe('Group,Code,Description,Unit,Quantity,Unit cost,Mass (kg)');
    expect(lines.at(-1)).toMatch(/,Total,/);
    // A real BOM has material lines between the header and the total.
    expect(lines.length).toBeGreaterThan(3);
  });

  it('freezes the steelwork schedule with the revision', async () => {
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
        idempotencyKey: 'test-members',
        expectedRev: 0,
        customer: { firstName: 'Steel', lastName: 'Schedule', email: 'ss@example.com', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: config(),
        pricing,
      },
    });
    expect(saved.statusCode).toBe(201);

    const members = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${saved.json().data.quoteId}/revisions/1/members`,
      headers: { cookie },
    });
    expect(members.statusCode).toBe(200);
    const rows = members.json().data.members as {
      item: string;
      section: string;
      lengthMm: number;
      quantity: number;
    }[];

    // A workshop cannot build from an empty sheet, and every row has to be a real section with a
    // positive length and count.
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.section.length).toBeGreaterThan(0);
      expect(row.lengthMm).toBeGreaterThan(0);
      expect(row.quantity).toBeGreaterThan(0);
    }
    const items = rows.map((row) => row.item);
    expect(items).toContain('main_column');
    expect(items).toContain('main_rafter');
  });

  it('freezes the punching detail with the revision', async () => {
    /*
     * The book lists structure rows for bays of 3 000, 3 500 and 4 000 mm, so this
     * configuration — a 4 000 mm nominal bay — takes its sections from the structure
     * table and its connectors from the apex/haunch tables. A 6 000 mm bay has no
     * row, which is the `assumed` path tested below; both are real states of a quote.
     */
    const scheduled = () => ({
      ...config(),
      // Terrain 2, not the fixture's 2.5: this book lists no 9 000 × 4 000 row for
      // 2.5 in region A, and a missing row is the `assumed` path tested separately.
      terrainCategory: 2,
      nomBaySpacing: 4000,
      bays: 4,
      length: 16000,
    });
    const evaluated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: scheduled(), pricing },
    });
    const saved = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: {
        evaluationId: evaluated.json().data.evaluationId,
        idempotencyKey: 'test-punchings',
        expectedRev: 0,
        customer: { firstName: 'Punch', lastName: 'Detail', email: 'pd@example.com', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: scheduled(),
        pricing,
      },
    });
    expect(saved.statusCode).toBe(201);

    const punchings = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${saved.json().data.quoteId}/revisions/1/punchings`,
      headers: { cookie },
    });
    expect(punchings.statusCode).toBe(200);
    const pages = punchings.json().data.pages as {
      left: {
        mark: string;
        section: string;
        holeSize: string;
        centreMm: number;
        remainingMm: number;
        top: { positionMm: number; spacingMm: number }[];
        bottom: { positionMm: number }[];
      } | null;
      right: { mark: string } | null;
    }[];

    // Two frame sheets — the gable end (C2 meets R2) then the portal (C1 meets R1) — one
    // sheet per pair of infill columns, and a `DM`/`DH` sheet for the roller door's frame.
    // The fixture has one roller door and two infill columns per end.
    expect(pages.length).toBe(5);
    expect(pages[0].left?.mark).toBe('C2');
    expect(pages[1].left?.mark).toBe('C1');
    expect(pages[1].right?.mark).toBe('R1');
    expect(pages[1].left?.holeSize).toBe('18x22');
    expect(pages[2].left?.mark).toBe('M');
    expect(pages[3].left?.mark).toBe('M');
    // The door frame on its own sheet: a mullion post beside the header.
    const doorSheet = pages.find((page) => page.left?.mark === 'DM');
    expect(doorSheet).toBeDefined();
    expect(doorSheet?.right?.mark).toBe('DH');

    const portal = pages[1].left!;
    // The book's `kneeedge` at 22.5° is 73, then `HP20-22.5` contributes d1 = 73 and
    // d2 = 266 — and d3 = 0, so there is no fourth hole. A sheet with only the knee
    // hole would read as complete and be bolted with two holes missing.
    expect(portal.top.map((hole) => hole.spacingMm)).toEqual([73, 73, 266]);
    expect(portal.top[0]?.spacingMm).toBe(73);
    for (const hole of portal.top) {
      expect(hole.positionMm).toBeGreaterThan(0);
      expect(hole.positionMm).toBeLessThan(portal.remainingMm + hole.positionMm + 1);
    }
  });

  it('withholds the punching sheet when the book cannot name the connectors', async () => {
    /*
     * The default 6 000 mm bay has no structure row in this book, so every member is
     * priced from one assumed 100 × 100 SHS. There is no `HP100-22.5` plate, so no
     * sheet can be drawn — and an empty sheet is the right answer: showing only the
     * knee hole would tell a workshop a two-hole member is complete.
     */
    const assumed = () => ({ ...config(), nomBaySpacing: 6000, bays: 3, length: 18000 });
    const evaluated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: assumed(), pricing },
    });
    const saved = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: {
        evaluationId: evaluated.json().data.evaluationId,
        idempotencyKey: 'test-punchings-assumed',
        expectedRev: 0,
        customer: { firstName: 'No', lastName: 'Plate', email: 'np@example.com', address: 'x' },
        site: { address: 'x', deliveryAcknowledged: true },
        config: assumed(),
        pricing,
      },
    });
    expect(saved.statusCode).toBe(201);

    const punchings = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${saved.json().data.quoteId}/revisions/1/punchings`,
      headers: { cookie },
    });
    expect(punchings.statusCode).toBe(200);
    expect(punchings.json().data.pages).toEqual([]);
  });

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
