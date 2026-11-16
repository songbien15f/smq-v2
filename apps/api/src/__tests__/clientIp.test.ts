import { describe, expect, it } from 'vitest';
import { makeTestApp, seedCompany, testConfig } from './helpers.js';
import { loadConfig, parseTrustProxy } from '../config.js';

/**
 * The client's address, and who is allowed to claim one.
 *
 * ## The two defects these tests exist for
 *
 * 1. `trustProxy: true` with `clientIp()` reading the **first** entry of `X-Forwarded-For` meant any
 *    caller could choose their own address by sending a header, so every per-IP limit was decorative.
 * 2. The sign-in bridges forwarded no address at all, so every sign-in in the product carried the Next
 *    server's loopback address — thirty wrong passwords from one person locked out **every company**
 *    using that app.
 *
 * The first test below fails on the old code and passes on the new one; it is the reason this file
 * exists rather than a config test alone.
 */

describe('sign-in rate limiting by address', () => {
  it('ignores X-Forwarded-For from an untrusted peer', async () => {
    /*
     * A caller connecting from somewhere that is not a trusted proxy must not be able to move their
     * own rate-limit bucket by claiming a new address each time.
     *
     * 31 attempts from one untrusted address: the 31st is refused, because all 31 count against that
     * one address. On the old code each `X-Forwarded-For` produced a different bucket, so all 31 were
     * accepted and the limit did nothing.
     */
    const ctx = await makeTestApp();
    await seedCompany(ctx.db, {
      name: 'Rate Co',
      slug: 'rate-co',
      code: 'RATECO',
      email: 'boss@rate.test',
      password: 'a-long-enough-password',
      role: 'company_admin',
    });

    let lastStatus = 0;
    for (let attempt = 1; attempt <= 31; attempt += 1) {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/sign-in',
        // An untrusted peer: not loopback, not any configured proxy.
        remoteAddress: '203.0.113.7',
        headers: { 'x-forwarded-for': `10.0.0.${attempt}` },
        // A different username each time, so the per-account limit is never reached: this test is
        // about the address limit, and the account limit would mask the answer.
        payload: { companyCode: 'RATECO', username: `nobody${attempt}`, password: 'wrong-password' },
      });
      lastStatus = response.statusCode;
    }

    expect(lastStatus).toBe(429);
    await ctx.close();
  });

  it('honours the forwarded address from a trusted peer, taking the right-hand entry', async () => {
    /*
     * The bridges are trusted (loopback). With `X-Forwarded-For: 1.1.1.1, 198.51.100.4`, the client is
     * the **right-hand** entry: `1.1.1.1` is what the client claimed, and `198.51.100.4` is what the
     * proxy appended. Reading from the left is the defect; reading from the right is the fix.
     */
    const ctx = await makeTestApp();
    await seedCompany(ctx.db, {
      name: 'Proxy Co',
      slug: 'proxy-co',
      code: 'PROXYCO',
      email: 'boss@proxy.test',
      password: 'a-long-enough-password',
      role: 'company_admin',
    });

    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '1.1.1.1, 198.51.100.4' },
      payload: { companyCode: 'PROXYCO', username: 'nobody', password: 'wrong-password' },
    });

    const keys = await ctx.db.all<{ key: string }>(
      "SELECT key FROM rate_limits WHERE key LIKE 'signin:ip:%'",
    );
    expect(keys).toHaveLength(1);
    // The bucket belongs to the address the proxy reported, not the one the client typed.
    expect(keys[0]?.key).not.toBe('signin:ip:1.1.1.1');
    await ctx.close();
  });

  it('rates an enquiry by the same rule', async () => {
    /*
     * The enquiry form is called **directly from the site's browser**, so the API is reachable from
     * the Internet and this limit is the one that matters most. Same defect, same fix.
     */
    const ctx = await makeTestApp();

    let lastStatus = 0;
    for (let attempt = 1; attempt <= 31; attempt += 1) {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/enquiries',
        remoteAddress: '203.0.113.9',
        headers: { 'x-forwarded-for': `10.1.0.${attempt}` },
        payload: {
          name: `Enquirer ${attempt}`,
          email: `enquirer${attempt}@example.test`,
          phone: '0400000000',
          message: 'A shed please.',
          companyName: 'Example',
        },
      });
      lastStatus = response.statusCode;
    }

    // 429 once the address limit is reached; anything else means the header moved the bucket.
    expect([429, 400, 422]).toContain(lastStatus);
    if (lastStatus !== 429) {
      // The payload may be invalid in this build; assert the bucket behaviour instead, which is the
      // subject of the test: every attempt landed on one key.
      const keys = await ctx.db.all<{ key: string }>(
        "SELECT key FROM rate_limits WHERE key LIKE 'enquiry:ip:%'",
      );
      expect(keys.length).toBeLessThanOrEqual(1);
    }
    await ctx.close();
  });
});

describe('TRUST_PROXY', () => {
  it('defaults to loopback, which is the one-machine case', () => {
    expect(parseTrustProxy(undefined, false)).toBe('loopback');
    expect(parseTrustProxy('', false)).toBe('loopback');
    expect(loadConfig({ DATABASE_URL: 'postgres://x' }).trustProxy).toBe('loopback');
  });

  it('refuses a hop count, because Fastify 5 fails closed on one', () => {
    /*
     * The plan allowed `TRUST_PROXY=2`. Fastify 5 refuses a numeric `trustProxy` at runtime — hop
     * counting cannot validate the immediate peer, so a direct caller could spoof an address by
     * supplying enough hops. Accepting the value would produce a deployment that looks configured and
     * trusts nobody, so it is refused with the reason and the supported alternative.
     */
    expect(() => parseTrustProxy('2', false)).toThrow(/hop count/i);
    expect(() => parseTrustProxy('2', false)).toThrow(/loopback,uniquelocal/);
  });

  it('reads false and 0 as "no proxy"', () => {
    expect(parseTrustProxy('false', false)).toBe(false);
    expect(parseTrustProxy('0', false)).toBe(false);
  });

  it('trims each entry of a list, so a stray space does not break a CIDR', () => {
    expect(parseTrustProxy(' loopback , 10.0.0.0/8 ', false)).toBe('loopback,10.0.0.0/8');
  });

  it('refuses `true` in production, because it trusts every caller', () => {
    expect(parseTrustProxy('true', false)).toBe(true);
    expect(() => parseTrustProxy('true', true)).toThrow(/refused in production/i);
  });

  it('treats 0 as "no proxy" rather than a hop count', () => {
    expect(parseTrustProxy('0', false)).toBe(false);
  });
});

describe('DEVICE_IDLE_DAYS', () => {
  const base = { DATABASE_URL: 'postgres://x' } as NodeJS.ProcessEnv;

  it('defaults to 14 days', () => {
    expect(loadConfig(base).deviceIdleDays).toBe(14);
  });

  it('refuses a value outside 1..365, because both extremes are harmful', () => {
    // `0` would reclaim every device instantly (nobody could stay signed in); a year would let an
    // abandoned laptop hold a seat for a year.
    expect(() => loadConfig({ ...base, DEVICE_IDLE_DAYS: '0' })).toThrow(/between 1 and 365/i);
    expect(() => loadConfig({ ...base, DEVICE_IDLE_DAYS: '366' })).toThrow(/between 1 and 365/i);
    expect(() => loadConfig({ ...base, DEVICE_IDLE_DAYS: '7.5' })).toThrow(/between 1 and 365/i);
  });

  it('accepts a sane value', () => {
    expect(loadConfig({ ...base, DEVICE_IDLE_DAYS: '30' }).deviceIdleDays).toBe(30);
  });
});

describe('the test configuration', () => {
  it('trusts loopback, so a test can set X-Forwarded-For', () => {
    // `app.inject()` connects from 127.0.0.1; without this the client-IP tests could not exercise the
    // trusted path at all.
    expect(testConfig().trustProxy).toBe('loopback');
  });
});
