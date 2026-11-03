/**
 * Data isolation between companies — the suite that matters most.
 *
 * Every other test in this package can pass while two companies quietly read each other's quotes,
 * because a leak is invisible to a caller who only ever has one company's data. This file gives
 * two companies real rows and then tries, from each side, to reach the other's — through the list,
 * by guessing an id, through a document download, through settings and the team screen. A leak
 * here is a customer reading a competitor's pricing, so each assertion is stated as the refusal
 * the route must make, not as a happy path that happens to return nothing.
 *
 * The other half is **seats**: capacity is per company, so one company filling its seats must not
 * stop another from signing in. That failure mode would only show up under a multi-company server
 * and is exactly what the old licence server got wrong.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newId, now } from '@sq/db';
import type { Db } from '@sq/db';
import { DEFAULT_SHED, normaliseShedConfig } from '@sq/core/domain';
import { makeTestApp, seedCompany, signIn, testConfig, type TestApp } from './helpers';

let ctx: TestApp;

/** Both companies, with one `jo` each — the same username, in different companies. */
let alfa: { tenantId: string; userId: string; code: string; username: string };
let beta: { tenantId: string; userId: string; code: string; username: string };

/** A quote belonging to each company, and the revision number to address it by. */
let quoteOfAlfa: string;
let quoteOfBeta: string;
const REV = 1;

/**
 * A complete revision row.
 *
 * Written by hand rather than through the save route on purpose: the save route needs a preview
 * and a price book, and this file is about what one company may read, not about how a quote is
 * priced. The columns still have to be real, because `loadFrozenRevision` reads them all when a
 * document is downloaded.
 */
async function insertQuote(db: Db, input: { tenantId: string; number: string; contractCents: number }): Promise<string> {
  const quoteId = newId();
  const at = now();
  const config = normaliseShedConfig(DEFAULT_SHED);

  await db.run(
    `INSERT INTO quotes (id, tenant_id, number, status, current_revision, contract_cents, incomplete, site_json, created_at, updated_at)
     VALUES (?, ?, ?, 'issued', ?, ?, 0, '{}', ?, ?)`,
    [quoteId, input.tenantId, input.number, REV, input.contractCents, at, at],
  );

  await db.run(
    `INSERT INTO quote_revisions
       (id, quote_id, tenant_id, revision, name, description, config_json, bom_json, price_json, issues_json,
        customer_json, company_json, provenance_json, config_hash, result_hash, bom_hash, price_book_hash,
        override_version, settings_version, engine_version, contract_cents, total_cost_cents, total_mass_kg,
        mocked_lines, idempotency_key, created_by_email, created_at)
     VALUES (?, ?, ?, ?, 'Initial', '', ?, '[]', ?, '[]', ?, ?, '{}', 'c', 'r', 'b', 'p',
             0, 1, 1, ?, 0, 0, 0, ?, ?, ?)`,
    [
      newId(),
      quoteId,
      input.tenantId,
      REV,
      JSON.stringify(config),
      JSON.stringify({ contractCents: input.contractCents }),
      JSON.stringify({ firstName: 'A', lastName: 'Customer' }),
      JSON.stringify({ name: input.number === 'Q-A-1' ? 'Alpha Sheds' : 'Beta Sheds' }),
      input.contractCents,
      newId(),
      `owner@${input.number.toLowerCase()}.test`,
      at,
    ],
  );

  return quoteId;
}

beforeAll(async () => {
  ctx = await makeTestApp(testConfig());

  alfa = await seedCompany(ctx.db, {
    name: 'Alpha Sheds',
    slug: 'alpha-sheds',
    code: 'ALFA',
    username: 'jo',
    email: 'jo@alfa.test',
    password: 'a-long-enough-password',
  });
  beta = await seedCompany(ctx.db, {
    name: 'Beta Sheds',
    slug: 'beta-sheds',
    code: 'BETA',
    username: 'jo',
    email: 'jo@beta.test',
    password: 'a-long-enough-password',
  });

  quoteOfAlfa = await insertQuote(ctx.db, { tenantId: alfa.tenantId, number: 'Q-A-1', contractCents: 100_00 });
  quoteOfBeta = await insertQuote(ctx.db, { tenantId: beta.tenantId, number: 'Q-B-1', contractCents: 999_00 });
});

afterAll(async () => {
  await ctx.close();
});

/** Sign in to a company, once per company per run, so the seat pool is not drained by re-entry. */
const cookieCache = new Map<string, string>();
async function signInTo(company: { code: string; username: string }): Promise<string> {
  const cached = cookieCache.get(company.code);
  if (cached !== undefined) return cached;
  const cookie = await signIn(ctx.app, company.code, company.username, 'a-long-enough-password');
  cookieCache.set(company.code, cookie);
  return cookie;
}

describe('a company cannot see another company', () => {
  it('does not list the other company quote', async () => {
    const cookie = await signInTo(alfa);
    const list = await ctx.app.inject({ method: 'GET', url: '/api/v1/quotes?limit=50', headers: { cookie } });

    expect(list.statusCode).toBe(200);
    const numbers = (list.json().data.items as { number: string }[]).map((quote) => quote.number);
    expect(numbers).toContain('Q-A-1');
    expect(numbers).not.toContain('Q-B-1');
  });

  it('keeps the two companies each signing in as their own `jo`', async () => {
    const a = await signInTo(alfa);
    const b = await signInTo(beta);

    const sessionA = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: a } });
    const sessionB = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: b } });

    // Same username, different people: the code is what separates them.
    expect(sessionA.json().data.currentTenantId).toBe(alfa.tenantId);
    expect(sessionB.json().data.currentTenantId).toBe(beta.tenantId);
    expect(sessionA.json().data.userId).not.toBe(sessionB.json().data.userId);
  });

  it('answers 404 — not 403 — for the other company quote by id', async () => {
    const cookie = await signInTo(alfa);
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/quotes/${quoteOfBeta}`,
      headers: { cookie },
    });

    // 403 would confirm the row exists; 404 says nothing, so a guessed id is not an oracle.
    expect(response.statusCode).toBe(404);
  });

  it('answers 404 for the other company revision, through every document route', async () => {
    const cookie = await signInTo(alfa);
    const ownerCookie = await signInTo(beta);

    const routes = [
      `/api/v1/quotes/${quoteOfBeta}/revisions/${REV}/html`,
      `/api/v1/quotes/${quoteOfBeta}/revisions/${REV}/pdf`,
      `/api/v1/quotes/${quoteOfBeta}/revisions/${REV}/bom`,
      `/api/v1/quotes/${quoteOfBeta}/export/sqd`,
    ];

    for (const url of routes) {
      const response = await ctx.app.inject({ method: 'GET', url, headers: { cookie } });
      expect(`${url} → ${response.statusCode}`).toBe(`${url} → 404`);

      /*
       * And the owner gets an answer that is not 404, so the assertion above cannot pass because
       * the route does not exist. PDF may honestly answer 503 when no Chromium is installed —
       * that is still proof the route ran and found the revision.
       */
      const asOwner = await ctx.app.inject({ method: 'GET', url, headers: { cookie: ownerCookie } });
      expect(`${url} (owner) → ${asOwner.statusCode}`).not.toBe(`${url} (owner) → 404`);
    }
  });

  it('mints no share link for the other company revision', async () => {
    const cookie = await signInTo(alfa);
    const revision = await ctx.db.get<{ id: string }>('SELECT id FROM quote_revisions WHERE quote_id = ?', [
      quoteOfBeta,
    ]);

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/quotes/${quoteOfBeta}/shares`,
      headers: { cookie },
      payload: { revisionId: revision?.id, expiresInDays: 30 },
    });

    // A revision id is a uuid; a uuid from another company is not a credential.
    expect(response.statusCode).toBe(404);
  });

  it('shows only its own settings, and a change to one company leaves the other alone', async () => {
    const a = await signInTo(alfa);
    const b = await signInTo(beta);

    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: { cookie: a },
      payload: { name: 'Alpha Renamed' },
    });

    const settingsA = await ctx.app.inject({ method: 'GET', url: '/api/v1/settings', headers: { cookie: a } });
    const settingsB = await ctx.app.inject({ method: 'GET', url: '/api/v1/settings', headers: { cookie: b } });

    expect(settingsA.json().data.name).toBe('Alpha Renamed');
    expect(settingsB.json().data.name).toBe('Beta Sheds');
  });

  it('lists only its own team', async () => {
    const cookie = await signInTo(alfa);
    const team = await ctx.app.inject({ method: 'GET', url: '/api/v1/team', headers: { cookie } });

    expect(team.statusCode).toBe(200);
    const emails = (team.json().data.items as { email: string }[]).map((member) => member.email);
    expect(emails).toContain('jo@alfa.test');
    expect(emails).not.toContain('jo@beta.test');
  });
});

describe('seats and membership are per company', () => {
  it('lets one company sign in while another is out of seats', async () => {
    // A fresh app so the seat arithmetic is not disturbed by the sessions above.
    const solo = await makeTestApp(testConfig());
    try {
      const small = await seedCompany(solo.db, {
        name: 'Small Seats',
        slug: 'small-seats',
        code: 'SMALL',
        username: 'boss',
        seats: 1,
        email: 'boss@small.test',
        password: 'a-long-enough-password',
      });
      await seedCompany(solo.db, {
        name: 'Big Seats',
        slug: 'big-seats',
        code: 'BIG',
        username: 'boss',
        seats: 5,
        email: 'boss@big.test',
        password: 'a-long-enough-password',
      });

      // Fill the small company's only seat.
      const first = await signIn(solo.app, 'SMALL', 'boss', 'a-long-enough-password');
      expect(first).toContain('sq_session=');

      const refused = await solo.app.inject({
        method: 'POST',
        url: '/api/v1/auth/sign-in',
        payload: { companyCode: 'SMALL', username: 'boss', password: 'a-long-enough-password' },
      });
      expect(refused.statusCode).toBe(403);

      // The other company is untouched: its seats are its own.
      const other = await signIn(solo.app, 'BIG', 'boss', 'a-long-enough-password');
      expect(other).toContain('sq_session=');

      // And the small company's seat count is a property of the small company.
      const seats = await solo.db.get<{ seats: number }>('SELECT seats FROM tenants WHERE id = ?', [small.tenantId]);
      expect(seats?.seats).toBe(1);
    } finally {
      await solo.close();
    }
  });

  it('stops a removed member on their next request, in that company only', async () => {
    const solo = await makeTestApp(testConfig());
    try {
      const a = await seedCompany(solo.db, {
        name: 'Removal A',
        slug: 'removal-a',
        code: 'REMA',
        username: 'jo',
        email: 'jo@rema.test',
        password: 'a-long-enough-password',
      });
      const b = await seedCompany(solo.db, {
        name: 'Removal B',
        slug: 'removal-b',
        code: 'REMB',
        username: 'jo',
        email: 'jo@remb.test',
        password: 'a-long-enough-password',
      });

      const cookieA = await signIn(solo.app, 'REMA', 'jo', 'a-long-enough-password');
      const cookieB = await signIn(solo.app, 'REMB', 'jo', 'a-long-enough-password');

      await solo.db.run("UPDATE memberships SET status = 'removed' WHERE tenant_id = ? AND user_id = ?", [
        a.tenantId,
        a.userId,
      ]);

      const afterA = await solo.app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { cookie: cookieA },
      });
      expect(afterA.statusCode).toBe(401);

      // The membership is removed in one company; the other person is unaffected even though the
      // username is the same.
      const afterB = await solo.app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { cookie: cookieB },
      });
      expect(afterB.statusCode).toBe(200);
      expect(b.tenantId).toBeTruthy();
    } finally {
      await solo.close();
    }
  });
});
