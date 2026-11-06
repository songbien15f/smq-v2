import { describe, expect, it } from 'vitest';
import { makeTestApp, seedCompany, signIn } from './helpers.js';

/**
 * The server's body limit, and what a caller is told when they exceed it.
 *
 * Two defects found together on 2026-11-06, both measured before they were fixed:
 *
 * 1. `priceImport` advertised an 8 MB cap while `app.ts` capped every request at 1 MB, so the
 *    route's own "too large" message could never be reached.
 * 2. The error handler re-wrote **every** error as 500, so an over-limit upload was answered
 *    "Something went wrong. The details were logged." — telling the operator the server had
 *    broken when their file was simply too big.
 *
 * A 413 with a plain sentence is the whole point of this test: the number a person can act on is
 * "your file is too large", not "internal error".
 */
describe('the upload body limit', () => {
  async function signedIn() {
    const ctx = await makeTestApp();
    const company = await seedCompany(ctx.db, {
      name: 'Body Limit Sheds',
      slug: 'body-limit-sheds',
      code: 'BLTEST',
      email: 'bl@example.com',
      password: 'a-long-enough-password',
    });
    const cookie = await signIn(ctx.app, company.code, company.username, 'a-long-enough-password');
    return { ctx, cookie };
  }

  it('answers 413 with a plain sentence when the body exceeds the limit', async () => {
    const { ctx, cookie } = await signedIn();
    // 2 MB: past the server's 1 MB limit, and past what any price sheet should be.
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prices/preview',
      headers: { cookie },
      payload: { data: 'A'.repeat(2 * 1024 * 1024) },
    });

    // The status is the actionable half: 500 said "the server broke", 413 says "your file is big".
    expect(response.statusCode).toBe(413);
    const body = response.json() as { ok: boolean; code: string; message: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('payload_too_large');
    // And the message must not be the generic internal-error sentence.
    expect(body.message).not.toMatch(/Something went wrong/);
    expect(body.message).toMatch(/larger than/i);
  });

  it('never leaks a raw parser or database message to the caller', async () => {
    const { ctx, cookie } = await signedIn();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prices/preview',
      headers: { cookie },
      payload: { data: 'A'.repeat(2 * 1024 * 1024) },
    });
    // A parser message names an internal limit; a SQL message can name a column.
    expect(response.body).not.toMatch(/FST_ERR|UNIQUE constraint|column/i);
  });

  it('lets an ordinary upload through to the route', async () => {
    const { ctx, cookie } = await signedIn();
    // Small payload: this must reach the route, which then says the book is not configured rather
    // than refusing the body. That distinction is the whole test — a limit that rejects everything
    // looks the same as one that works.
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prices/preview',
      headers: { cookie },
      payload: { data: Buffer.from('Name,Price\nShed,100\n').toString('base64') },
    });
    expect(response.statusCode).not.toBe(413);
    expect(response.statusCode).not.toBe(500);
  });
});
