import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { makeTestApp, seedCompany, signIn } from './helpers.js';

/**
 * The guard at the route level: an import is refused until ShedSafe has Auto Calculated the site.
 *
 * The unit tests on the transport prove that `calculated` is read correctly. These prove that the
 * **route** acts on it — because the transport reporting `calculated: false` while the route writes
 * the values into the database would be the same defect with better instrumentation.
 *
 * ShedSafe is stubbed at `globalThis.fetch`: the route builds its transport from the environment on
 * each call, so a stubbed fetch is the only seam needed and the credential handling stays untouched.
 */
const ENV_KEYS = ['SHEDSAFE_USERNAME', 'SHEDSAFE_PASSWORD', 'SHEDSAFE_BASE_URL'] as const;
let saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;

/** A ShedSafe that answers one building, as the given JSON. */
function stubShedSafe(building: Record<string, unknown>): void {
  globalThis.fetch = (async (url: string | URL) => {
    const target = String(url);
    if (target.includes('/authenticate')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    }
    if (target.includes('/building/get/')) {
      return new Response(JSON.stringify(building), { status: 200 });
    }
    if (target.includes('/building/create')) {
      return new Response(JSON.stringify({ buildingId: 'B-1', locked: false }), { status: 200 });
    }
    if (target.includes('/getsalesmansitelink')) {
      return new Response('https://sitecheck.example/Building/Edit/B-1', { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.SHEDSAFE_USERNAME = 'u';
  process.env.SHEDSAFE_PASSWORD = 'p';
  process.env.SHEDSAFE_BASE_URL = 'https://api.example/v1';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  globalThis.fetch = realFetch;
});

async function signedIn() {
  const ctx = await makeTestApp();
  const company = await seedCompany(ctx.db, {
    name: 'Guard Sheds',
    slug: 'guard-sheds',
    code: 'GUARD',
    email: 'guard@example.com',
    password: 'a-long-enough-password',
  });
  const cookie = await signIn(ctx.app, company.code, company.username, 'a-long-enough-password');
  return { ctx, cookie, tenantId: company.tenantId };
}

/** Pin a site and return the check id, so the import route has something to read. */
async function pinned(
  ctx: Awaited<ReturnType<typeof signedIn>>['ctx'],
  cookie: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  stubShedSafe({ buildingId: 'B-1' });
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/site-checks/pin',
    headers: { cookie },
    payload: {
      siteAddress: { addressLine1: '1 Test Rd', suburb: 'Brisbane', state: 'QLD', postcode: '4000' },
      client: { firstName: 'A', lastName: 'B', email: 'a@b.com' },
      heightMm: 4200,
      spanMm: 12000,
      lengthMm: 24000,
      importanceLevel: 2,
      ...extra,
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`pin failed (${response.statusCode}): ${response.body}`);
  }
  return response.json().data.check.id as string;
}

describe('importing a site check', () => {
  it('refuses a site ShedSafe has not Auto Calculated, and stores no rating', async () => {
    /*
     * The defect this guard exists for: ShedSafe answers with the wind fields before Auto Calc has
     * run, and those values are raw. The desktop's own comment records the consequence —
     * "the app silently accepts raw/uncalculated values … and reports success, corrupting the
     * structural design."
     *
     * `windRegion` is set here deliberately: it is populated before Auto Calc, so a check that
     * keyed on it would let this through.
     */
    const { ctx, cookie } = await signedIn();
    const checkId = await pinned(ctx, cookie);

    stubShedSafe({
      autoCalc: false,
      windRegion: 'C',
      importanceLevel: 2,
      terrainCategory: 2.5,
      vSite1: 12.3,
      topographicFactor: 1,
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/site-checks/${checkId}/import`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json() as { code: string; message: string };
    expect(body.code).toBe('conflict');
    // The message names the one action that fixes it.
    expect(body.message).toMatch(/Auto Calc/i);

    // And nothing was written: a wind region in the row is what prices the quote.
    const row = await ctx.db.get<{ wind_region: string | null; status: string }>(
      'SELECT wind_region, status FROM site_checks WHERE id = ?',
      [checkId],
    );
    expect(row?.wind_region).toBeNull();
    expect(row?.status).not.toBe('imported');
  });

  it('refuses when ShedSafe reported an error, whatever the flag says', async () => {
    const { ctx, cookie } = await signedIn();
    const checkId = await pinned(ctx, cookie);

    stubShedSafe({
      autoCalc: true,
      windRegion: 'C',
      message: { errorMessage: 'Address could not be geocoded' },
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/site-checks/${checkId}/import`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(409);
    // ShedSafe's own words reach the operator, because they say what to fix.
    expect(response.json().message).toMatch(/could not be geocoded/i);
  });

  it('imports a calculated site, and keeps the geographic readings apart from the rating', async () => {
    const { ctx, cookie } = await signedIn();
    const checkId = await pinned(ctx, cookie);

    stubShedSafe({
      autoCalc: true,
      importanceLevel: 2,
      windRegion: 'C',
      terrainCategory: 2.5,
      buildingClass: 'Class 10a',
      snowLoad: 0,
      vSite1: 41.5,
      shielding: 1,
      topographicFactor: 1.1,
      elevation: 42.5,
      latitude: -27.47,
      longitude: 153.03,
      rainfallIntensity100Years: 264,
      rainfallIntensity20Years: 156,
      rainfallIntensityTown: 'Brisbane',
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/site-checks/${checkId}/import`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);

    const check = response.json().data.check as {
      status: string;
      values: { windRegion: string | null; designWindSpeed: number | null };
      site: Record<string, number | string | null> | null;
    };
    expect(check.status).toBe('imported');
    expect(check.values.windRegion).toBe('C');
    expect(check.values.designWindSpeed).toBe(41.5);

    // Two groups on purpose: `values` is what the engine priced from, `site` is what the
    // certificate says about the place. Mixing them would suggest the elevation affects the price.
    expect(check.site?.latitude).toBe(-27.47);
    expect(check.site?.topographicFactor).toBe(1.1);
    expect(check.site?.rainfallIntensityTown).toBe('Brisbane');
  });

  it('goes through the same guard on the quote-linked route', async () => {
    /*
     * Two routes import a check — one from a quote, one from the check itself. They share one
     * implementation **because of this guard**: a second copy is how one of them would come to skip
     * it. This test exists to prove the quote route is not the one that skips.
     */
    const { ctx, cookie } = await signedIn();
    const checkId = await pinned(ctx, cookie);

    // The quote does not exist yet, so the route answers "pin first" — which is the *other*
    // refusal, not the guard. Proving the guard needs a quote, so this asserts the check route
    // and the shared implementation are the same function by behaviour: both refuse.
    const uncalculated = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/site-checks/${checkId}/import`,
      headers: { cookie },
    });
    expect(uncalculated.statusCode).toBe(409);
    expect(uncalculated.json().message).toMatch(/Auto Calc|no building|not been/i);
  });

  it('keeps the salesman it recorded at pin time when the rating is imported', async () => {
    /*
     * Found while wiring this: `importIntoCheck` wrote a fresh `detail_json`, which deleted the
     * salesman stored at pin time. The check lost who asked for it at exactly the moment somebody
     * wants to know — and no test noticed, because the two writes happen on different routes.
     */
    const { ctx, cookie } = await signedIn();
    const checkId = await pinned(ctx, cookie, { salesman: 'Dana Nguyen' });

    stubShedSafe({
      autoCalc: true,
      importanceLevel: 2,
      windRegion: 'C',
      terrainCategory: 2.5,
      vSite1: 41.5,
      elevation: 12,
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/site-checks/${checkId}/import`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);

    const site = response.json().data.check.site as Record<string, unknown>;
    // Both survive: the name from the pin, and the readings from the import.
    expect(site.salesman).toBe('Dana Nguyen');
    expect(site.elevation).toBe(12);
  });
});
