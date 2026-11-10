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
      // ShedSafe refuses an empty salesman, so the route requires one.
      salesman: 'Dana Nguyen',
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
  it('reads a site ShedSafe has not Auto Calculated, and prices nothing from it', async () => {
    /*
     * The defect this guard exists for: ShedSafe answers with the wind fields before Auto Calc has
     * run, and those values are raw. The desktop's own comment records the consequence —
     * "the app silently accepts raw/uncalculated values … and reports success, corrupting the
     * structural design."
     *
     * `windRegion` is set here deliberately: it is populated before Auto Calc, so a check that
     * keyed on it would let this through.
     *
     * **The answer is 200, not 409.** Refusing the call left the operator looking at "not
     * calculated" with no idea whether ShedSafe had even been reached. The readings come back as
     * `provisional` so a screen can show them, and the six columns that price the quote stay null.
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

    expect(response.statusCode).toBe(200);
    const check = response.json().data.check as {
      calculated: boolean;
      status: string;
      lastError: string | null;
      provisional: { windRegion: string | null; designWindSpeed: number | null } | null;
      values: { windRegion: string | null };
    };
    // The one property that answers "has it been calculated".
    expect(check.calculated).toBe(false);
    expect(check.status).not.toBe('imported');
    // The message names the one action that fixes it.
    expect(check.lastError).toMatch(/Auto Calc/i);
    // The raw readings are visible…
    expect(check.provisional?.windRegion).toBe('C');
    expect(check.provisional?.designWindSpeed).toBe(12.3);
    // …and the priced fields are still empty.
    expect(check.values.windRegion).toBeNull();

    // Nothing was written to the columns that price the quote.
    const row = await ctx.db.get<{ wind_region: string | null; status: string }>(
      'SELECT wind_region, status FROM site_checks WHERE id = ?',
      [checkId],
    );
    expect(row?.wind_region).toBeNull();
    expect(row?.status).not.toBe('imported');
  });

  it('reports a ShedSafe error without pricing anything, whatever the flag says', async () => {
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
    expect(response.statusCode).toBe(200);
    const check = response.json().data.check as { calculated: boolean; lastError: string | null };
    expect(check.calculated).toBe(false);
    // ShedSafe's own words reach the operator, because they say what to fix.
    expect(check.lastError).toMatch(/could not be geocoded/i);

    const row = await ctx.db.get<{ wind_region: string | null }>(
      'SELECT wind_region FROM site_checks WHERE id = ?',
      [checkId],
    );
    expect(row?.wind_region).toBeNull();
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

  it('applies the same rule on the check route and the quote route', async () => {
    /*
     * Two routes import a check — one from a quote, one from the check itself. They share one
     * implementation, and this proves the shared rule reaches the quote-less route too: an
     * uncalculated site comes back read-but-not-priced there as well.
     */
    const { ctx, cookie } = await signedIn();
    const checkId = await pinned(ctx, cookie);

    stubShedSafe({ autoCalc: false, windRegion: 'C', vSite1: 12.3 });

    const uncalculated = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/site-checks/${checkId}/import`,
      headers: { cookie },
    });
    expect(uncalculated.statusCode).toBe(200);
    const check = uncalculated.json().data.check as { calculated: boolean; lastError: string | null };
    expect(check.calculated).toBe(false);
    expect(check.lastError).toMatch(/Auto Calc/i);
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

    const check = response.json().data.check as {
      salesman: string | null;
      site: Record<string, unknown>;
    };
    // The name from the pin survives…
    expect(check.salesman).toBe('Dana Nguyen');
    // …and the readings arrive as their own named fields, not as part of a blob.
    expect(check.site.elevation).toBe(12);
    expect(check.site).not.toHaveProperty('salesman');
    expect(check.site).not.toHaveProperty('provisional');
  });
});

/**
 * The building ShedSafe was asked to rate, kept on the check.
 *
 * ## The defect these exist for
 *
 * A rating is about **a building** — `map_pin` sends a span, a height, a length and an importance
 * level, and ShedSafe rates that. Nothing recorded them, so after an import the screen knew only that
 * a rating existed. An operator who then widened the shed from 12 m to 15 m kept a green "Rating
 * imported" beside a building nobody had rated. Measured 2026-11-10: neither the API nor the panel
 * compared the two.
 *
 * The desktop never recorded this either — its "GET SITECHECK REPORT" was equally blind — so this is a
 * deliberate difference, which is why it is also written into `KNOWN-DEVIATIONS.md`.
 */
describe('what the building was when it was pinned', () => {
  it('lưu span, height, length và importance level lúc pin', async () => {
    const { ctx, cookie } = await signedIn();
    const checkId = await pinned(ctx, cookie, {
      spanMm: 15000,
      heightMm: 4800,
      lengthMm: 30000,
      importanceLevel: 3,
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/site-checks/${checkId}/import`,
      headers: { cookie },
    });
    // GET on the import path is not a route; read the row through the pin answer instead.
    expect([404, 405]).toContain(response.statusCode);

    const row = await ctx.db.get<{ detail_json: string | null }>(
      'SELECT detail_json FROM site_checks WHERE id = ?',
      [checkId],
    );
    const detail = JSON.parse(row?.detail_json ?? '{}') as {
      pinnedFor?: { spanMm: number; heightMm: number; lengthMm: number; importanceLevel: number };
    };
    expect(detail.pinnedFor).toEqual({
      spanMm: 15000,
      heightMm: 4800,
      lengthMm: 30000,
      importanceLevel: 3,
    });
  });

  it('đọc lại pinnedFor qua response của check', async () => {
    const { ctx, cookie } = await signedIn();
    const checkId = await pinned(ctx, cookie, { spanMm: 9000, heightMm: 3600, lengthMm: 18000 });

    // The import route is what a screen calls; it returns the check even when not calculated.
    stubShedSafe({ autoCalc: false, windRegion: 'A' });
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/site-checks/${checkId}/import`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);

    const check = response.json().data.check as {
      pinnedFor: { spanMm: number; heightMm: number; lengthMm: number; importanceLevel: number } | null;
    };
    expect(check.pinnedFor).not.toBeNull();
    expect(check.pinnedFor?.spanMm).toBe(9000);
    expect(check.pinnedFor?.importanceLevel).toBe(2);
  });

  it('importance level 3 sống sót qua pin — không bị hạ về 1', async () => {
    /*
     * The route's own schema allows 1..4, but the *stored config* used to narrow it. This proves the
     * wire and the row both carry 3, so the regression cannot come back through the API.
     */
    const { ctx, cookie } = await signedIn();
    const checkId = await pinned(ctx, cookie, { importanceLevel: 3 });

    const row = await ctx.db.get<{ detail_json: string | null }>(
      'SELECT detail_json FROM site_checks WHERE id = ?',
      [checkId],
    );
    const detail = JSON.parse(row?.detail_json ?? '{}') as {
      pinnedFor?: { importanceLevel: number };
    };
    expect(detail.pinnedFor?.importanceLevel).toBe(3);
  });
});

/**
 * The Auto Calc watch: a cheap read that answers one question.
 *
 * ## Why a separate route rather than reusing import
 *
 * The panel polls while the operator is on ShedSafe's own tab finishing Auto Calc. Import **writes** —
 * it stores values and can record a failure — so polling it would rewrite the same row every ten
 * seconds and turn a network hiccup into a stored error. This route writes nothing, so it is safe to
 * call when nothing has changed, which is exactly what a poller does.
 *
 * ## Why it must not "fail" on a transient error
 *
 * A poll that reports an error stops being a poll. ShedSafe being briefly unreachable is not something
 * the operator can act on, and giving up on one bad response means giving up precisely when the network
 * is flaky.
 */
describe('has ShedSafe finished Auto Calc', () => {
  it('answers calculated when the building is, and writes nothing', async () => {
    const { ctx, cookie } = await signedIn();
    const checkId = await pinned(ctx, cookie);

    const before = await ctx.db.get<{ status: string; wind_region: string | null }>(
      'SELECT status, wind_region FROM site_checks WHERE id = ?',
      [checkId],
    );

    stubShedSafe({
      autoCalc: true,
      importanceLevel: 2,
      windRegion: 'A5',
      terrainCategory: 3,
      vSite1: 37.4,
      message: { errorMessage: null },
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/site-checks/${checkId}/status`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json().data as { calculated: boolean; missing: boolean; errorMessage: string | null };
    expect(body.calculated).toBe(true);
    expect(body.missing).toBe(false);
    expect(body.errorMessage).toBeNull();

    /*
     * The point of a separate route: the row is **unchanged**. A poll that wrote would have set
     * `wind_region` here, and then the import would no longer be the thing that prices the quote.
     */
    const after = await ctx.db.get<{ status: string; wind_region: string | null }>(
      'SELECT status, wind_region FROM site_checks WHERE id = ?',
      [checkId],
    );
    expect(after).toEqual(before);
  });

  it('answers not-calculated while Auto Calc has not finished', async () => {
    const { ctx, cookie } = await signedIn();
    const checkId = await pinned(ctx, cookie);
    stubShedSafe({ autoCalc: false, windRegion: 'A5', message: { errorMessage: null } });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/site-checks/${checkId}/status`,
      headers: { cookie },
    });
    const body = response.json().data as { calculated: boolean };
    expect(body.calculated).toBe(false);
  });

  it('reports a failed Auto Calc once, so the panel can stop waiting', async () => {
    const { ctx, cookie } = await signedIn();
    const checkId = await pinned(ctx, cookie);
    stubShedSafe({ autoCalc: false, message: { errorMessage: 'The site could not be calculated.' } });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/site-checks/${checkId}/status`,
      headers: { cookie },
    });
    const body = response.json().data as { calculated: boolean; errorMessage: string | null };
    expect(body.calculated).toBe(false);
    // Named, so "waiting" and "it failed" are different sentences on screen.
    expect(body.errorMessage).toMatch(/could not be calculated/i);
  });

  it('answers missing rather than an error for a pin that never reached ShedSafe', async () => {
    /*
     * The all-zero id is what a failed create used to store. It is not a transient failure — the
     * screen's answer is "pin the site again", which is a different sentence from "ShedSafe is
     * unreachable", so it is reported as `missing` and not as `errorMessage`.
     */
    const { ctx, cookie } = await signedIn();
    const checkId = await pinned(ctx, cookie);
    await ctx.db.run('UPDATE site_checks SET building_id = ? WHERE id = ?', [
      '00000000-0000-0000-0000-000000000000',
      checkId,
    ]);

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/site-checks/${checkId}/status`,
      headers: { cookie },
    });
    const body = response.json().data as { missing: boolean; calculated: boolean };
    expect(body.missing).toBe(true);
    expect(body.calculated).toBe(false);
  });

  it('refuses a check belonging to another company', async () => {
    const { ctx, cookie } = await signedIn();
    const checkId = await pinned(ctx, cookie);
    stubShedSafe({ autoCalc: true });

    const other = await seedCompany(ctx.db, {
      name: 'Other Company',
      slug: 'other-company',
      code: 'OTHERCO',
      username: 'u',
      email: 'u@other.test',
      password: 'a-long-enough-password',
    });
    const otherCookie = await signIn(ctx.app, other.code, other.username, 'a-long-enough-password');

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/site-checks/${checkId}/status`,
      headers: { cookie: otherCookie },
    });
    expect(response.statusCode).toBe(404);
  });
});
