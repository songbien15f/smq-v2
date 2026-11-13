import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, seedCompany, signIn, type TestApp } from './helpers.js';

/**
 * The Places routes when Google refuses them.
 *
 * On 2026-11-13 the live key started answering `403 PERMISSION_DENIED`. The route reported
 * `503 not_configured` and the transport threw away Google's body, so the screen said the server was
 * "not configured" — pointing at `.env`, where the key was present and correct — while the real cause
 * (billing, a disabled API, key restrictions) lived in the response body nobody kept.
 *
 * These tests pin the contract that prevents a repeat: a refusal is `502 upstream_failed`, and the
 * message carries Google's own explanation.
 */

let ctx: TestApp;
let cookie: string;
const originalKey = process.env.GOOGLE_PLACES_API_KEY;
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  ctx = await makeTestApp();
  const company = await seedCompany(ctx.db, {
    name: 'Places Co',
    slug: 'places-co',
    email: 'estimator@places.test',
    password: 'a-long-enough-password',
    role: 'estimator',
  });
  cookie = await signIn(ctx.app, company.code, company.username, 'a-long-enough-password');
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
});

afterAll(async () => {
  await ctx.close();
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = originalKey;
});

/** Google's documented refusal for a key whose project may not use the API. */
function refuseWith403(): void {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' },
      }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;
}

describe('a Places refusal', () => {
  it('is a 502 upstream failure, not "not configured"', async () => {
    refuseWith403();

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/places/autocomplete?q=12%20Example',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(502);
    const body = response.json() as { ok: boolean; code: string; message: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('upstream_failed');
  });

  it('carries Google’s own reason, so the next reader does not need curl', async () => {
    refuseWith403();

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/places/autocomplete?q=12%20Example',
      headers: { cookie },
    });

    const body = response.json() as { message: string };
    expect(body.message).toContain('PERMISSION_DENIED');
    expect(body.message).toContain('The caller does not have permission');
  });

  it('keeps the key out of the message', async () => {
    refuseWith403();

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/places/autocomplete?q=12%20Example',
      headers: { cookie },
    });

    expect(response.body).not.toContain('test-key');
  });
});
