import { describe, expect, it, beforeEach } from 'vitest';
import { newId, now } from '@sq/db';
import { makeTestApp, seedCompany, signIn, type TestApp } from './helpers.js';

/**
 * The freight minimums, over HTTP.
 *
 * The rule they feed has its own arithmetic tests in `@sq/core` (`delivery.test.ts`). What matters
 * here is the storage contract, because this block was added to a JSON blob that already exists on
 * every company: a blob written before the field must still read, and its **rates must survive**.
 * That is the exact shape that once took every quote down with a 500 in the upstream project.
 */

let ctx: TestApp;
let cookie: string;
let tenantId: string;

beforeEach(async () => {
  ctx = await makeTestApp();
  const company = await seedCompany(ctx.db, {
    name: 'Acme Sheds',
    slug: 'acme-sheds',
    email: 'owner@acme.example',
    password: 'correct-horse-battery',
  });
  tenantId = company.tenantId;
  cookie = await signIn(ctx.app, company.code, company.username, 'correct-horse-battery');
});

/** Read the rates endpoint. */
async function readRates() {
  const response = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/settings/rates',
    headers: { cookie },
  });
  return { status: response.statusCode, body: response.json() as { data: { rates: unknown; minimumFees: unknown } } };
}

describe('freight minimums in company settings', () => {
  it('answers zeroed minimums for a company that has never set them', async () => {
    const { status, body } = await readRates();
    expect(status).toBe(200);
    // Zero is "nothing agreed", not "unset": the desktop's own default, and what the Cost step reads.
    expect(body.data.minimumFees).toEqual({
      distributorDollarCents: 0,
      distributorPercent: 0,
      carrierDollarCents: 0,
      carrierPercent: 0,
    });
  });

  it('stores and returns them', async () => {
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: { cookie },
      payload: {
        minimumFees: {
          distributorDollarCents: 45_000,
          distributorPercent: 7.5,
          carrierDollarCents: 60_000,
          carrierPercent: 5,
        },
      },
    });
    expect(patch.statusCode).toBe(200);

    const { body } = await readRates();
    expect(body.data.minimumFees).toEqual({
      distributorDollarCents: 45_000,
      distributorPercent: 7.5,
      carrierDollarCents: 60_000,
      carrierPercent: 5,
    });
  });

  it('refuses a percentage outside 0–100 and a negative minimum', async () => {
    const negative = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: { cookie },
      payload: {
        minimumFees: {
          distributorDollarCents: -1,
          distributorPercent: 7.5,
          carrierDollarCents: 0,
          carrierPercent: 5,
        },
      },
    });
    expect(negative.statusCode).toBe(422);

    const over = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: { cookie },
      payload: {
        minimumFees: {
          distributorDollarCents: 0,
          distributorPercent: 140,
          carrierDollarCents: 0,
          carrierPercent: 5,
        },
      },
    });
    expect(over.statusCode).toBe(422);
  });

  it('reads a blob written before the field existed, and keeps its rates', async () => {
    /*
     * The old shape: a rates table and nothing else. Written straight into the row, because that is
     * what an installation upgraded from last month holds — the API cannot produce it any more.
     */
    const at = now();
    await ctx.db.run(
      `INSERT INTO company_settings (id, tenant_id, version, settings_json, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        newId(),
        tenantId,
        7,
        JSON.stringify({
          name: 'Acme Sheds',
          abn: null,
          rates: {
            labour: { concreter: 9000, electrician: 12000, labourer1: 6500, labourer2: 6000 },
            defaultCosts: { council: 0, engineering: 0, rubbish: 0, delivery: 0, concrete: 0 },
          },
          margin: 1.4,
          depositPct: 10,
          progressPct: 70,
          bomProfileId: null,
          assumptions: [],
          paymentDetails: null,
          address: null,
          phone: null,
          email: null,
          logoText: null,
          terms: [],
        }),
        at,
        'test',
      ],
    );

    const { status, body } = await readRates();
    expect(status).toBe(200);
    expect(body.data.minimumFees).toEqual({
      distributorDollarCents: 0,
      distributorPercent: 0,
      carrierDollarCents: 0,
      carrierPercent: 0,
    });
    // The rates that were already stored are untouched — the reason this test exists.
    expect(body.data.rates).toEqual({
      labour: { concreter: 9000, electrician: 12000, labourer1: 6500, labourer2: 6000 },
      defaultCosts: { council: 0, engineering: 0, rubbish: 0, delivery: 0, concrete: 0 },
    });
  });

  it('does not clear the rates when a later patch sets only the minimums', async () => {
    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: { cookie },
      payload: {
        rates: {
          labour: { concreter: 9000, electrician: 12000, labourer1: 6500, labourer2: 6000 },
          defaultCosts: { council: 1000, engineering: 2000, rubbish: 0, delivery: 0, concrete: 0 },
        },
      },
    });
    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: { cookie },
      payload: {
        minimumFees: {
          distributorDollarCents: 45_000,
          distributorPercent: 0,
          carrierDollarCents: 0,
          carrierPercent: 0,
        },
      },
    });

    const { body } = await readRates();
    expect((body.data.rates as { labour: { concreter: number } }).labour.concreter).toBe(9000);
    expect((body.data.minimumFees as { distributorDollarCents: number }).distributorDollarCents).toBe(45_000);
  });
});
