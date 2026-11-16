import { describe, expect, it } from 'vitest';
import { deviceLabel, looksLikeDeviceToken, reclaimDeadDevices } from '../lib/devices.js';

/**
 * The device label, and the two pure helpers around it.
 *
 * A label is what an admin reads to decide **which browser to free**, so getting it wrong has a
 * concrete cost: freeing the device the person is actually using. These are real User-Agent strings,
 * taken from the browsers a shed company's staff actually use.
 */

describe('deviceLabel', () => {
  const cases: [string, string][] = [
    // Chrome on Windows: also claims Safari, so the order of the checks matters.
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Chrome on Windows',
    ],
    // Edge is Chrome plus `Edg/`. Checked before Chrome or every Edge user reads as Chrome.
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      'Edge on Windows',
    ],
    // Safari on an iPhone: `CriOS`/`FxiOS` are the Chrome/Firefox iOS variants.
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
      'Safari on iPhone',
    ],
    // Firefox on macOS.
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
      'Firefox on macOS',
    ],
    // Chrome on Android. `Android` beats `Linux`, which every Android UA also claims.
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
    // An iPad that claims to be a Mac. `iPad` is checked before macOS for this reason.
    [
      'Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
      'Safari on iPad',
    ],
  ];

  for (const [ua, expected] of cases) {
    it(`reads "${expected}"`, () => {
      expect(deviceLabel(ua)).toBe(expected);
    });
  }

  it('says so when it cannot tell, rather than guessing', () => {
    expect(deviceLabel('curl/8.4.0')).toBe('Unknown browser');
    expect(deviceLabel('')).toBe('Unknown browser');
    expect(deviceLabel(null)).toBe('Unknown browser');
    expect(deviceLabel(undefined)).toBe('Unknown browser');
  });

  it('never returns a label without a platform', () => {
    // A label like "Chrome" alone does not help an admin choose between two devices.
    for (const ua of ['Mozilla/5.0 Chrome/131.0.0.0', 'Mozilla/5.0 Firefox/131.0']) {
      expect(deviceLabel(ua)).toMatch(/ on /);
    }
  });
});

describe('looksLikeDeviceToken', () => {
  it('accepts a token this server would mint', () => {
    // `newToken()` is base64url of random bytes; 32 bytes becomes 43 characters.
    expect(looksLikeDeviceToken('A'.repeat(43))).toBe(true);
    expect(looksLikeDeviceToken('abc-DEF_123456789012345678901')).toBe(true);
  });

  it('rejects junk, so a hand-written cookie cannot be mistaken for a device', () => {
    expect(looksLikeDeviceToken('')).toBe(false);
    expect(looksLikeDeviceToken('short')).toBe(false);
    expect(looksLikeDeviceToken('has spaces in it and is long enough')).toBe(false);
    expect(looksLikeDeviceToken('x'.repeat(500))).toBe(false);
    expect(looksLikeDeviceToken(undefined)).toBe(false);
    expect(looksLikeDeviceToken(12345)).toBe(false);
  });
});

describe('reclaimDeadDevices', () => {
  it('builds its SQL without a nullable parameter', async () => {
    /*
     * `? IS NULL` cannot be typed by Postgres (DECISIONS A20 — it answers 500 with "could not determine
     * data type of parameter"). The tenant filter is therefore cut out of the statement rather than
     * passed as a null, and this test asserts the shape that results: two statements, and the number of
     * parameters each carries.
     *
     * A stub `Db` records the calls, because the real behaviour is covered by the API suite where a
     * database exists; what is worth pinning here is the SQL the function builds.
     */
    const calls: { sql: string; params: readonly unknown[] }[] = [];
    const stub = {
      run: async (sql: string, params: readonly unknown[] = []) => {
        calls.push({ sql, params });
        return { changes: 1 };
      },
    } as never;

    const released = await reclaimDeadDevices(stub, { idleDays: 14, at: new Date('2026-11-15T00:00:00Z') });

    expect(released).toBe(1);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.sql).not.toMatch(/\?\s+IS\s+NULL/i);
      // No tenant given, so no tenant parameter was added.
      expect(call.sql).not.toContain('tenant_id');
    }
    // The cutoff is `at − 14 days`, as an ISO string — the format every timestamp in this schema uses.
    expect(calls[0]?.params[0]).toBe('2026-11-01T00:00:00.000Z');
  });

  it('adds the tenant filter, and its parameter, when a tenant is named', async () => {
    const calls: { sql: string; params: readonly unknown[] }[] = [];
    const stub = {
      run: async (sql: string, params: readonly unknown[] = []) => {
        calls.push({ sql, params });
        return { changes: 0 };
      },
    } as never;

    await reclaimDeadDevices(stub, {
      tenantId: 'tenant-1',
      idleDays: 7,
      at: new Date('2026-11-15T00:00:00Z'),
    });

    expect(calls[0]?.sql).toContain('tenant_id = ?');
    // Delete statement: cutoff, then the tenant filter in the subquery, then the outer one.
    expect(calls[0]?.params).toEqual([
      '2026-11-08T00:00:00.000Z',
      'tenant-1',
      'tenant-1',
    ]);
  });
});
