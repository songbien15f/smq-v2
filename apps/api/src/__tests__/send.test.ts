import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { publishPriceBook } from '@sq/core/pricing';
import { DEFAULT_SHED, normaliseShedConfig } from '@sq/core/domain';
import { newId, now } from '@sq/db';
import { hashPassword } from '../lib/password';
import { enqueueSend, claimJob, dispatchNextJob } from '../lib/mail/queue';
import { makeTestApp, seedCompany, signIn, testConfig, type TestApp } from './helpers';

/**
 * Sending, status, settings and the team — the decisions around a send, not the relay.
 *
 * The mail transport is **injected**: a test that opened an SMTP connection would be a test that
 * fails without network, and this file is about what is refused, what the status becomes, and what
 * a second click does. The queue's refusals are exercised against hand-made revisions so the
 * condition under test is the one we built, not whatever the sample book happens to produce today.
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
    openings: [{ id: 'o1', type: 'roller_door', wall: 'front', u: 4500, width: 3000, height: 2400 }],
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

/** Set or clear the SMTP variables around one test, and always put them back. */
async function withEnv(
  overrides: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const keys = ['SMTP2GO_USER', 'SMTP2GO_PASS', 'SMTP2GO_HOST', 'SMTP2GO_PORT', 'MAIL_FROM'];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe.skipIf(!hasDump)('settings, the team, sending and the quote status', () => {
  let ctx: TestApp;
  let cookie: string;
  let booksDir: string;
  let quoteId: string;
  let revisionId: string;
  let tenantId: string;
  let userId: string;
  const originalBooks = process.env.PRICE_BOOKS;
  const originalCache = process.env.PDF_CACHE;

  beforeAll(async () => {
    booksDir = mkdtempSync(join(tmpdir(), 'sq-send-books-'));
    process.env.PRICE_BOOKS = booksDir;
    // A scratch PDF cache so a test never reads a document rendered by an earlier run.
    process.env.PDF_CACHE = mkdtempSync(join(tmpdir(), 'sq-send-cache-'));
    publishPriceBook(DUMP, booksDir);

    ctx = await makeTestApp(testConfig());
    const seeded = await seedCompany(ctx.db, {
      name: 'Send Test Sheds',
      slug: 'send-test',
      email: 'sender@send.test',
      password: 'a-long-enough-password',
      role: 'company_admin',
    });
    tenantId = seeded.tenantId;
    userId = seeded.userId;
    cookie = await signIn(ctx.app, 'sender@send.test', 'a-long-enough-password');

    const { publishAndActivate } = await import('../lib/priceBook');
    await publishAndActivate(ctx.db, {
      dumpDir: DUMP,
      publishedByUserId: userId,
      publishedByEmail: 'sender@send.test',
    });

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
        idempotencyKey: 'send-test-happy-1',
        expectedRev: 0,
        customer: {
          firstName: 'Jo',
          lastName: 'Bloggs',
          email: 'jo@example.com',
          address: '1 Test Road',
          suburb: 'Brisbane',
          state: 'QLD',
          postcode: '4000',
        },
        site: { address: '1 Test Road, Brisbane QLD 4000', deliveryAcknowledged: true },
        config: config(),
        pricing,
      },
    });
    expect(saved.statusCode).toBe(201);
    quoteId = saved.json().data.quoteId;
    revisionId = saved.json().data.revisionId;
  });

  afterAll(async () => {
    await ctx.close();
    const { closeAllBooks } = await import('../lib/priceBook');
    closeAllBooks();
    if (originalBooks === undefined) delete process.env.PRICE_BOOKS;
    else process.env.PRICE_BOOKS = originalBooks;
    if (originalCache === undefined) delete process.env.PDF_CACHE;
    else process.env.PDF_CACHE = originalCache;
    rmSync(booksDir, { recursive: true, force: true });
  });

  /* ------------------------------------------------------------------ helpers */

  /**
   * Insert a revision by hand.
   *
   * The immutability triggers refuse UPDATE and DELETE, not INSERT — which is exactly what makes
   * this possible, and exactly why it is safe: the row is as frozen as any the real flow writes.
   * It is how a refusal that depends on the *contents* of a revision (mocked lines, an allowance)
   * is tested without the result depending on what the sample price book covers this month.
   */
  async function insertRevision(input: {
    quote: string;
    revision: number;
    key: string;
    issues?: unknown[];
    mockedLines?: number;
  }): Promise<string> {
    const id = newId();
    await ctx.db.run(
      `INSERT INTO quote_revisions
         (id, quote_id, tenant_id, revision, config_json, bom_json, price_json, issues_json,
          customer_json, company_json, provenance_json, config_hash, result_hash, bom_hash,
          price_book_hash, engine_version, contract_cents, total_cost_cents, total_mass_kg,
          mocked_lines, idempotency_key, created_by, created_by_email, created_at)
       VALUES (?, ?, ?, ?, '{}', '[]', '{}', ?, '{}', '{"name":"Send Test Sheds"}', '{}',
               'x', 'x', 'x', 'x', 1, 0, 0, 0, ?, ?, ?, ?, ?)`,
      [
        id,
        input.quote,
        tenantId,
        input.revision,
        JSON.stringify(input.issues ?? []),
        input.mockedLines ?? 0,
        input.key,
        userId,
        'sender@send.test',
        now(),
      ],
    );
    return id;
  }

  /** A fresh quote in `draft`, with one blank revision, for the dispatch test. */
  async function insertQuote(): Promise<{ quoteId: string; revisionId: string }> {
    const quote = newId();
    const at = now();
    await ctx.db.run(
      `INSERT INTO quotes (id, tenant_id, number, status, current_revision, incomplete, site_json, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', 1, 0, '{}', ?, ?)`,
      [quote, tenantId, `Q-SYN-${quote.slice(0, 6)}`, at, at],
    );
    const rev = await insertRevision({ quote, revision: 1, key: `syn-rev-${quote}` });
    return { quoteId: quote, revisionId: rev };
  }

  /* ---------------------------------------------------------------- settings */

  it('starts at version 1 and writes a new version on every save', async () => {
    const first = await ctx.app.inject({ method: 'GET', url: '/api/v1/settings', headers: { cookie } });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.version).toBe(1);

    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: { cookie },
      payload: { abn: '12 345 678 901', terms: ['A deposit is required on signing.'] },
    });
    expect(patched.statusCode).toBe(200);
    // A new row, not an update: a revision records the version it was priced under, so overwriting
    // would make "this quote used these terms" unanswerable.
    expect(patched.json().data.version).toBe(2);
    expect(patched.json().data.terms).toEqual(['A deposit is required on signing.']);
  });

  it('tolerates a settings blob written before a field existed', async () => {
    // The shape an older row has: no address, no terms, no logo. Reading it must produce defaults,
    // not a 500 — the upstream project took every quote down this way while its tests passed.
    await ctx.db.run(
      `INSERT INTO company_settings (id, tenant_id, version, settings_json, created_at, created_by)
       SELECT ?, id, 99, '{"name":"Send Test Sheds"}', ?, ? FROM tenants LIMIT 1`,
      [newId(), now(), userId],
    );

    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/settings', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.version).toBe(99);
    expect(response.json().data.address).toBeNull();
    expect(response.json().data.terms).toEqual([]);
    // The logo falls back to the company name rather than printing blank.
    expect(response.json().data.logoText).toBe('Send Test Sheds');

    await ctx.db.run('DELETE FROM company_settings WHERE version = 99');
  });

  it('refuses a margin outside the allowed range', async () => {
    const before = await ctx.app.inject({ method: 'GET', url: '/api/v1/settings', headers: { cookie } });
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: { cookie },
      payload: { margin: 99 },
    });
    // The schema refuses the value outright, which is better than storing it.
    expect(response.statusCode).toBe(422);
    const after = await ctx.app.inject({ method: 'GET', url: '/api/v1/settings', headers: { cookie } });
    expect(after.json().data.version).toBe(before.json().data.version);
  });

  /* -------------------------------------------------------------------- team */

  it('lists the company members with their seat state', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/team', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    const items = response.json().data.items;
    expect(items).toHaveLength(1);
    expect(items[0].email).toBe('sender@send.test');
    expect(items[0].role).toBe('company_admin');
    // The caller has a live session, so they hold the seat they are using.
    expect(items[0].active).toBe(true);
  });

  it('refuses to remove the only administrator', async () => {
    const response = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/v1/team/sender@send.test',
      headers: { cookie },
    });

    // A company with no administrator cannot be administered, so the last one cannot leave.
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toMatch(/only administrator/i);
  });

  it('refuses a role the policy does not define', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/team/sender@send.test/role',
      headers: { cookie },
      payload: { role: 'superuser' },
    });
    expect(response.statusCode).toBe(422);
  });

  /* -------------------------------------------------------------------- send */

  it('refuses a send when mail is not configured, and says so plainly', async () => {
    await withEnv({}, async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/quotes/${quoteId}/send`,
        headers: { cookie },
        payload: {
          revisionId,
          to: 'jo@example.com',
          subject: 'Your quotation',
          body: 'Attached.',
          acknowledgeIndicative: true,
          idempotencyKey: 'send-unconfigured-1',
        },
      });

      // A deployment fact, not a bad request: the operator fixes it by setting the credentials.
      expect(response.statusCode).toBe(503);
      expect(response.json().message).toMatch(/mail is not configured/i);
    });
  });

  it('refuses a bad address before anything is queued', async () => {
    await withEnv({ SMTP2GO_USER: 'test-user', SMTP2GO_PASS: 'test-pass' }, async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/quotes/${quoteId}/send`,
        headers: { cookie },
        payload: {
          revisionId,
          to: 'not-an-address',
          subject: 'Your quotation',
          body: '',
          acknowledgeIndicative: true,
          idempotencyKey: 'send-bad-address-1',
        },
      });

      // Zod accepts any string of 3+ chars, so an address-shaped-but-wrong value reaches the queue,
      // which refuses it as a conflict — the request was well-formed, the address was not.
      expect(response.statusCode).toBe(409);
      expect(response.json().message).toMatch(/not an email/i);
    });

    // The refusal happened before the queue, so nothing was written.
    const jobs = await ctx.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM send_jobs WHERE idempotency_key = 'send-bad-address-1'",
    );
    expect(Number(jobs?.n ?? 0)).toBe(0);
  });

  it('refuses a send whose revision has unpriced lines', async () => {
    const mocked = await insertRevision({
      quote: quoteId,
      revision: 90,
      key: 'rev-mocked-lines',
      mockedLines: 3,
    });

    await withEnv({ SMTP2GO_USER: 'test-user', SMTP2GO_PASS: 'test-pass' }, async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/quotes/${quoteId}/send`,
        headers: { cookie },
        payload: {
          revisionId: mocked,
          to: 'jo@example.com',
          subject: 'Your quotation',
          body: '',
          acknowledgeIndicative: true,
          idempotencyKey: 'send-mocked-lines-1',
        },
      });

      // A quote with an unpriced line has a total that is not a total: sending it turns a
      // placeholder into an offer.
      expect(response.statusCode).toBe(409);
      expect(response.json().message).toMatch(/no price/i);
    });
  });

  it('refuses an indicative send until the allowances are acknowledged', async () => {
    const indicative = await insertRevision({
      quote: quoteId,
      revision: 91,
      key: 'rev-indicative',
      issues: [{ severity: 'assumption', code: 'GIRT_PRICE_FROM_PURLIN' }],
    });

    await withEnv({ SMTP2GO_USER: 'test-user', SMTP2GO_PASS: 'test-pass' }, async () => {
      const blocked = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/quotes/${quoteId}/send`,
        headers: { cookie },
        payload: {
          revisionId: indicative,
          to: 'jo@example.com',
          subject: 'Your quotation',
          body: '',
          acknowledgeIndicative: false,
          idempotencyKey: 'send-indicative-unacked',
        },
      });

      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().message).toMatch(/indicative/i);
    });
  });

  /* ------------------------------------------------------------------ status */

  it('moves a quote through the states a person may set, and refuses the rest', async () => {
    const toIssued = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/quotes/${quoteId}/status`,
      headers: { cookie },
      payload: { to: 'issued' },
    });
    expect(toIssued.statusCode).toBe(200);

    const toAccepted = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/quotes/${quoteId}/status`,
      headers: { cookie },
      payload: { to: 'accepted', note: 'confirmed by phone' },
    });
    expect(toAccepted.statusCode).toBe(200);

    // A terminal state is a record, not a toggle: it is never re-opened.
    const reopen = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/quotes/${quoteId}/status`,
      headers: { cookie },
      payload: { to: 'issued' },
    });
    expect(reopen.statusCode).toBe(409);

    const audit = await ctx.db.all<{ summary: string }>(
      "SELECT summary FROM audit_events WHERE action = 'quote.status'",
    );
    expect(audit.map((row) => row.summary).join(' ')).toMatch(/accepted/);
  });

  it('refuses a status jump that is not a move a person may make', async () => {
    // A fresh quote in draft: draft → accepted is not in the table, so it is refused.
    const other = await insertQuote();
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/quotes/${other.quoteId}/status`,
      headers: { cookie },
      payload: { to: 'accepted' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toMatch(/cannot be moved/i);
  });

  /* --------------------------------------------------------------- the BOM */

  it('serves the materials workbook as a real xlsx', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}/revisions/1/bom`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(String(response.headers['content-type'])).toContain('spreadsheetml');
    // An .xlsx is a zip, so the payload starts 'PK'. A text error page would not.
    expect(response.body.slice(0, 2)).toBe('PK');
    expect(String(response.headers['content-disposition'])).toMatch(/-rev1-bom\.xlsx/);
  });

  it('refuses the cost-bearing workbook to a viewer', async () => {
    // A viewer reads a quote but the policy says they see no cost — and this sheet is cost.
    await ctx.db.run(
      `INSERT INTO users (id, email, display_name, password_hash, must_change_password, password_set_at, created_at, updated_at)
       VALUES ('viewer-1', 'viewer@send.test', 'Viewer', ?, 0, ?, ?, ?)`,
      [await hashPassword('a-long-enough-password'), now(), now(), now()],
    );
    await ctx.db.run(
      `INSERT INTO memberships (tenant_id, user_id, role, status, created_at, updated_at)
       VALUES (?, 'viewer-1', 'viewer', 'active', ?, ?)`,
      [tenantId, now(), now()],
    );

    const viewerCookie = await signIn(ctx.app, 'viewer@send.test', 'a-long-enough-password');
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}/revisions/1/bom`,
      headers: { cookie: viewerCookie },
    });

    expect(response.statusCode).toBe(403);

    // The customer document carries no cost, so the same viewer may still read it.
    const document = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}/revisions/1/html`,
      headers: { cookie: viewerCookie },
    });
    expect(document.statusCode).toBe(200);
  });

  /* --------------------------------------------------------------- re-opening for revision 2 */

  it('returns the frozen building and pricing so a quote can be re-opened for editing', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const data = response.json().data as Record<string, unknown>;
    // Both fields are present for a writer; without them the editor would open on a blank shed
    // and a save would silently replace the real building.
    expect(data.config).toBeDefined();
    expect(data.pricing).toBeDefined();
    expect((data.config as Record<string, unknown>).span).toBeTypeOf('number');
    expect((data.pricing as Record<string, unknown>).quoteRatePct).toBeTypeOf('number');
  });

  it('omits config and pricing for a viewer, even though the quote itself is readable', async () => {
    // Reuse the viewer created above — they may read the quote header but not the cost that
    // lives inside `config` (the building) and `pricing` (the negotiated contract).
    const viewerCookie = await signIn(ctx.app, 'viewer@send.test', 'a-long-enough-password');
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}`,
      headers: { cookie: viewerCookie },
    });

    expect(response.statusCode).toBe(200);
    const data = response.json().data as Record<string, unknown>;
    expect(data.id).toBe(quoteId);
    expect(data).not.toHaveProperty('config');
    expect(data).not.toHaveProperty('pricing');
    expect(data).not.toHaveProperty('contractCents');
  });

  it('appends revision 2 when the re-opened quote is saved with the expected revision', async () => {
    // Read the frozen draft back, then save it unchanged. The only thing that must move is the
    // revision counter — everything else stays identical, which is what "amend" means.
    const read = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}`,
      headers: { cookie },
    });
    expect(read.statusCode).toBe(200);
    const draft = read.json().data as {
      revision: number;
      config: Record<string, unknown>;
      pricing: Record<string, unknown>;
      customer: Record<string, string>;
      site: Record<string, unknown>;
    };

    const evaluation = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: draft.config, pricing: draft.pricing },
    });
    expect(evaluation.statusCode).toBe(200);
    const evalId = (evaluation.json().data as { evaluationId: string }).evaluationId;

    const save = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: {
        quoteId,
        expectedRev: draft.revision,
        evaluationId: evalId,
        customer: draft.customer,
        site: draft.site,
        pricing: draft.pricing,
        config: draft.config,
        idempotencyKey: `edit-rev2-${Date.now()}`,
      },
    });

    expect(save.statusCode).toBe(201);
    expect((save.json().data as { revision: number }).revision).toBe(draft.revision + 1);

    // Revision 1 is still there and unchanged — the whole point of appending rather than overwriting.
    // (Other tests in this file insert synthetic revisions on the same quote, so this asserts the
    // two real ones rather than an exact list.)
    const revisions = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}/revisions`,
      headers: { cookie },
    });
    const items = (revisions.json().data as { items: { revision: number }[] }).items;
    const numbers = items.map((r) => r.revision);
    expect(numbers).toContain(1);
    expect(numbers).toContain(2);
  });

  /* --------------------------------------------------------------- the queue */

  it('answers a second send with the same key with the first job, not a second email', async () => {
    await ctx.db.run('DELETE FROM send_jobs');
    const key = 'queue-idempotency-1';

    const first = await enqueueSend(ctx.db, {
      tenantId,
      userId,
      quoteId,
      revisionId,
      to: 'jo@example.com',
      subject: 'Your quotation',
      body: '',
      acknowledgeIndicative: true,
      idempotencyKey: key,
    });
    const second = await enqueueSend(ctx.db, {
      tenantId,
      userId,
      quoteId,
      revisionId,
      to: 'jo@example.com',
      subject: 'Your quotation',
      body: '',
      acknowledgeIndicative: true,
      idempotencyKey: key,
    });

    expect(second.id).toBe(first.id);
    const rows = await ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM send_jobs');
    expect(Number(rows?.n ?? 0)).toBe(1);
  });

  it('leases a job to exactly one worker', async () => {
    await ctx.db.run('DELETE FROM send_jobs');
    await enqueueSend(ctx.db, {
      tenantId,
      userId,
      quoteId,
      revisionId,
      to: 'jo@example.com',
      subject: 'Your quotation',
      body: '',
      acknowledgeIndicative: true,
      idempotencyKey: 'queue-claim-1',
    });

    const first = await claimJob(ctx.db);
    const second = await claimJob(ctx.db);

    expect(first).not.toBeNull();
    expect(first?.state).toBe('sending');
    // The claim was a single conditional UPDATE, so the second worker finds nothing.
    expect(second).toBeNull();
  });

  it('resolves a job whose worker died as unknown, never by retrying', async () => {
    await ctx.db.run('DELETE FROM send_jobs');
    const job = await enqueueSend(ctx.db, {
      tenantId,
      userId,
      quoteId,
      revisionId,
      to: 'jo@example.com',
      subject: 'Your quotation',
      body: '',
      acknowledgeIndicative: true,
      idempotencyKey: 'queue-lease-1',
    });

    await claimJob(ctx.db);
    // Simulate a worker that died holding the lease.
    await ctx.db.run('UPDATE send_jobs SET leased_until = ? WHERE id = ?', [
      new Date(Date.now() - 60_000).toISOString(),
      job.id,
    ]);

    // The next claim sweeps the expired lease first; the job is not re-sent.
    const next = await claimJob(ctx.db);
    expect(next).toBeNull();

    const row = await ctx.db.get<{ state: string; last_error: string }>(
      'SELECT state, last_error FROM send_jobs WHERE id = ?',
      [job.id],
    );
    expect(row?.state).toBe('unknown');
    expect(row?.last_error).toMatch(/interrupted/i);
  });

  it('sends through the transport and moves the quote to issued', async () => {
    await ctx.db.run('DELETE FROM send_jobs');
    const fresh = await insertQuote();

    const job = await enqueueSend(ctx.db, {
      tenantId,
      userId,
      quoteId: fresh.quoteId,
      revisionId: fresh.revisionId,
      to: 'customer@example.com',
      subject: 'Your quotation',
      body: 'Here it is.',
      acknowledgeIndicative: true,
      idempotencyKey: 'queue-dispatch-1',
    });
    expect(job.state).toBe('queued');

    // What the transport was handed, recorded so the assertion does not depend on a variable a
    // closure assigns to (which TypeScript would narrow to `null`).
    const delivered: { to: string; attachment: string | undefined }[] = [];
    const transport = {
      async send(message: { to: string; attachment?: { filename: string } }) {
        delivered.push({ to: message.to, attachment: message.attachment?.filename });
        return { messageId: '<fake@smartquote>' };
      },
    };

    const dispatched = await dispatchNextJob(ctx.db, transport, {
      async renderPdf() {
        return Buffer.from('%PDF-1.4 fake');
      },
      from() {
        return 'no_reply@send.test';
      },
      async replyTo() {
        return 'quotes@send.test';
      },
    });

    expect(dispatched?.state).toBe('accepted');
    expect(dispatched?.messageId).toBe('<fake@smartquote>');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.to).toBe('customer@example.com');
    // The attachment is named for the quote and revision, so a customer can tell two apart.
    expect(delivered[0]?.attachment).toMatch(/\.pdf$/);

    // A send is what "issued" means: the status is the record that something went out.
    const quote = await ctx.db.get<{ status: string }>('SELECT status FROM quotes WHERE id = ?', [
      fresh.quoteId,
    ]);
    expect(quote?.status).toBe('issued');

    const row = await ctx.db.get<{ state: string; message_id: string | null; sent_at: string | null }>(
      'SELECT state, message_id, sent_at FROM send_jobs WHERE id = ?',
      [job.id],
    );
    expect(row?.state).toBe('accepted');
    expect(row?.message_id).toBe('<fake@smartquote>');
    expect(row?.sent_at).not.toBeNull();
  });

  /* ------------------------------------------------- a settled quote never moves */

  /**
   * The promise the whole revision model exists to keep.
   *
   * A quote a customer has been sent must still say what it said then, even after the price book is
   * republished and every material in it costs something else. If a settled quote re-priced itself,
   * the document a customer holds and the document the company can regenerate would disagree — and
   * the company would have no way to prove which figure it offered.
   *
   * This asserts it rather than trusting the design: the revision stores its own `price_json` and
   * the routes render from that row, never by re-pricing.
   */
  it('keeps a settled revision’s figures when the price book is republished', async () => {
    const before = await ctx.db.get<{
      contract_cents: number;
      price_json: string;
      price_book_hash: string;
    }>(
      'SELECT contract_cents, price_json, price_book_hash FROM quote_revisions WHERE id = ?',
      [revisionId],
    );
    expect(before).not.toBeNull();

    // Republish the book. Same dump means the same content hash, so this cannot change a price —
    // which is itself worth pinning: a republish is not a re-price.
    const { publishAndActivate } = await import('../lib/priceBook');
    const republished = await publishAndActivate(ctx.db, {
      dumpDir: DUMP,
      publishedByUserId: userId,
      publishedByEmail: 'sender@send.test',
      note: 'republished during the immutability test',
    });
    expect(republished.hash).toBe(before?.price_book_hash);

    const after = await ctx.db.get<{ contract_cents: number; price_json: string }>(
      'SELECT contract_cents, price_json FROM quote_revisions WHERE id = ?',
      [revisionId],
    );

    // The row is untouched: same contract, byte-identical frozen price.
    expect(after?.contract_cents).toBe(before?.contract_cents);
    expect(after?.price_json).toBe(before?.price_json);
  });

  it('renders a settled revision from its frozen figures, not from a fresh evaluation', async () => {
    // The document route must read the stored revision. If it re-priced, the page would move with
    // the book — and the customer's copy and the operator's copy would diverge.
    const first = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}/revisions/1/html`,
      headers: { cookie },
    });
    expect(first.statusCode).toBe(200);

    // A new evaluation of the same building is a *new* price, and it must not reach the old page.
    const reEvaluated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/evaluate',
      headers: { cookie },
      payload: { config: config(), pricing },
    });
    expect(reEvaluated.statusCode).toBe(200);

    const second = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteId}/revisions/1/html`,
      headers: { cookie },
    });
    expect(second.statusCode).toBe(200);
    // Byte-identical: the page is a function of the frozen row, nothing else.
    expect(second.body).toBe(first.body);
  });

  it('refuses to update or delete a saved revision at the database', async () => {
    // The last line of defence. Even a bug in a route cannot rewrite what a customer was sent,
    // because the database refuses the statement itself.
    await expect(
      ctx.db.run('UPDATE quote_revisions SET contract_cents = 1 WHERE id = ?', [revisionId]),
    ).rejects.toThrow(/append-only/i);

    await expect(
      ctx.db.run('DELETE FROM quote_revisions WHERE id = ?', [revisionId]),
    ).rejects.toThrow(/append-only/i);
  });
});
