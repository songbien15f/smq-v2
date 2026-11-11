import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearShedSafeTokens,
  createShedSafeTransport,
  shedSafeConfigFromEnv,
  ShedSafeError,
  type ShedSafeConfig,
} from '../lib/shedsafe';

/**
 * The ShedSafe transport, driven by a fake `fetch`.
 *
 * The live API cannot be called from a test, and the parts that go wrong are the ones worth pinning:
 * the token cache, the two shapes the site link comes in, and the difference between "not calculated"
 * and "calculated as zero" — the last being the one that would put an uncertified wind region on a
 * quote.
 */

const config: ShedSafeConfig = {
  baseUrl: 'https://shedsafe.test/v1',
  username: 'user',
  password: 'pass',
};

/** One recorded call. */
interface Call {
  url: string;
  init?: RequestInit;
}

/** A fake that answers each path from a table, and records what was asked. */
function fakeFetch(routes: Record<string, () => Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    for (const [path, answer] of Object.entries(routes)) {
      if (String(url).includes(path)) return answer();
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

const authOk = () =>
  new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }), { status: 200 });

beforeEach(() => {
  // A token cached by one case must not leak into the next: the cache is module-level by design.
  clearShedSafeTokens();
});

describe('shedSafeConfigFromEnv', () => {
  it('is null without credentials, so the route can answer 503 rather than pretend', () => {
    expect(shedSafeConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(shedSafeConfigFromEnv({ SHEDSAFE_USERNAME: 'u' } as NodeJS.ProcessEnv)).toBeNull();
    expect(shedSafeConfigFromEnv({ SHEDSAFE_USERNAME: 'u', SHEDSAFE_PASSWORD: '  ' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('defaults the base URL and strips a trailing slash', () => {
    const fromDefault = shedSafeConfigFromEnv({
      SHEDSAFE_USERNAME: 'u',
      SHEDSAFE_PASSWORD: 'p',
    } as NodeJS.ProcessEnv);
    expect(fromDefault?.baseUrl).toBe('https://api.sitecheck.shedsafe.com.au/v1');

    const withSlash = shedSafeConfigFromEnv({
      SHEDSAFE_USERNAME: 'u',
      SHEDSAFE_PASSWORD: 'p',
      SHEDSAFE_BASE_URL: 'https://other.test/v1/',
    } as NodeJS.ProcessEnv);
    expect(withSlash?.baseUrl).toBe('https://other.test/v1');
  });
});

describe('the token cache', () => {
  it('authenticates once for several calls', async () => {
    const { fetch, calls } = fakeFetch({
      '/authenticate': authOk,
      '/building/get/': () => new Response(JSON.stringify({ windRegion: 'A' }), { status: 200 }),
    });

    const transport = createShedSafeTransport(config, fetch);
    await transport.read('b1');
    await transport.read('b2');

    const authCalls = calls.filter((call) => call.url.includes('/authenticate'));
    // One login for two reads. Authenticating per call would be a login per keystroke and would
    // eventually be rate-limited by ShedSafe.
    expect(authCalls).toHaveLength(1);
  });

  it('sends the bearer token, not the password, on every call', async () => {
    const { fetch, calls } = fakeFetch({
      '/authenticate': authOk,
      '/building/get/': () => new Response(JSON.stringify({ windRegion: 'A' }), { status: 200 }),
    });

    await createShedSafeTransport(config, fetch).read('b1');

    const read = calls.find((call) => call.url.includes('/building/get/'));
    const headers = read?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer token-1');
    // The password must never travel on a data call.
    expect(JSON.stringify(headers)).not.toContain('pass');
  });

  it('refuses when ShedSafe rejects the credentials', async () => {
    const { fetch } = fakeFetch({ '/authenticate': () => new Response('no', { status: 401 }) });
    await expect(createShedSafeTransport(config, fetch).read('b1')).rejects.toBeInstanceOf(ShedSafeError);
  });
});

describe('pin', () => {
  it('creates the building and returns the site link', async () => {
    const { fetch, calls } = fakeFetch({
      '/authenticate': authOk,
      '/building/create': () =>
        new Response(JSON.stringify({ buildingId: 'B-1', locked: false }), { status: 200 }),
      '/building/getsalesmansitelink': () =>
        new Response(JSON.stringify({ url: 'https://sitecheck.test/Building/Edit/B-1' }), { status: 200 }),
    });

    const pinned = await createShedSafeTransport(config, fetch).pin({
      reference: 'SC-1',
      siteAddress: { addressLine1: '12 Example St', suburb: 'Roma', state: 'QLD', postcode: '4455' },
      client: { firstName: 'Jo', lastName: 'Bloggs', email: 'jo@example.com' },
      // Metres. The route divides millimetres before calling; this asserts the wire value.
      height: 4.2,
      span: 12,
      length: 24,
      importanceLevel: 2,
    });

    expect(pinned.buildingId).toBe('B-1');
    expect(pinned.siteLink).toBe('https://sitecheck.test/Building/Edit/B-1');

    // The create body uses the upstream's own PascalCase spellings; they are what it accepts.
    const create = calls.find((call) => call.url.includes('/building/create'));
    const body = JSON.parse(String(create?.init?.body)) as Record<string, unknown>;
    expect(body.Reference).toBe('SC-1');
    expect(body.Height).toBe(4.2);
    expect((body.SiteAddress as Record<string, unknown>).State).toBe('QLD');
  });

  it('sends the salesperson as the salesman, never the customer', async () => {
    /*
     * This read `input.client.email` until 2026-11-06, so the person who asked for a site check
     * appeared at ShedSafe as the customer and nobody could tell whose visit it was. A commit
     * message claimed it was fixed; only the site *link* was. This pins the wire value.
     */
    const { fetch, calls } = fakeFetch({
      '/authenticate': authOk,
      '/building/create': () => new Response(JSON.stringify({ buildingId: 'B-9' }), { status: 200 }),
      '/building/getsalesmansitelink': () => new Response('https://sitecheck.test/B-9', { status: 200 }),
    });

    await createShedSafeTransport(config, fetch).pin({
      reference: 'SC-9',
      siteAddress: { addressLine1: 'x', suburb: '', state: '', postcode: '' },
      client: { firstName: 'Jo', lastName: 'Bloggs', email: 'customer@example.com' },
      salesman: 'Dana Nguyen',
      height: 4.2,
      span: 12,
      length: 24,
      importanceLevel: 2,
    });

    const create = calls.find((call) => call.url.includes('/building/create'));
    const body = JSON.parse(String(create?.init?.body)) as Record<string, unknown>;
    expect(body.Salesman).toBe('Dana Nguyen');
    // The customer's address belongs in Client, and nowhere in Salesman.
    expect(body.Salesman).not.toBe('customer@example.com');
    expect((body.Client as Record<string, unknown>).Email).toBe('customer@example.com');
  });

  it('sends an empty salesman when nobody typed one, as the desktop does', async () => {
    const { fetch, calls } = fakeFetch({
      '/authenticate': authOk,
      '/building/create': () => new Response(JSON.stringify({ buildingId: 'B-10' }), { status: 200 }),
      '/building/getsalesmansitelink': () => new Response('https://sitecheck.test/B-10', { status: 200 }),
    });

    await createShedSafeTransport(config, fetch).pin({
      reference: 'SC-10',
      siteAddress: { addressLine1: 'x', suburb: '', state: '', postcode: '' },
      client: { firstName: '', lastName: '', email: 'c@example.com' },
      height: 3,
      span: 9,
      length: 18,
      importanceLevel: 2,
    });

    const body = JSON.parse(
      String(calls.find((call) => call.url.includes('/building/create'))?.init?.body),
    ) as Record<string, unknown>;
    expect(body.Salesman).toBe('');
  });

  it('accepts a bare-text site link, which the endpoint sometimes returns', async () => {
    const { fetch } = fakeFetch({
      '/authenticate': authOk,
      '/building/create': () => new Response(JSON.stringify({ buildingId: 'B-2' }), { status: 200 }),
      // No JSON wrapper: the licence server needed a regex fallback for exactly this.
      '/building/getsalesmansitelink': () => new Response('https://sitecheck.test/plain/B-2', { status: 200 }),
    });

    const pinned = await createShedSafeTransport(config, fetch).pin({
      reference: 'SC-2',
      siteAddress: { addressLine1: 'x', suburb: '', state: '', postcode: '' },
      client: { firstName: '', lastName: '', email: '' },
      height: 3,
      span: 9,
      length: 18,
      importanceLevel: 2,
    });

    expect(pinned.siteLink).toBe('https://sitecheck.test/plain/B-2');
  });

  it('refuses when ShedSafe answers without a building id', async () => {
    const { fetch } = fakeFetch({
      '/authenticate': authOk,
      '/building/create': () =>
        new Response(JSON.stringify({ message: { errorMessage: 'Address is invalid' } }), { status: 200 }),
    });

    await expect(
      createShedSafeTransport(config, fetch).pin({
        reference: 'SC-3',
        siteAddress: { addressLine1: 'x', suburb: '', state: '', postcode: '' },
        client: { firstName: '', lastName: '', email: '' },
        height: 3,
        span: 9,
        length: 18,
        importanceLevel: 2,
      }),
    ).rejects.toThrow(/Address is invalid/);
  });
});

describe('read', () => {
  it('maps the certified fields, including vSite1, and reports them calculated', async () => {
    const { fetch } = fakeFetch({
      '/authenticate': authOk,
      '/building/get/': () =>
        new Response(
          JSON.stringify({
            // The flag that says Auto Calc has run. Without it the values are raw.
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
          }),
          { status: 200 },
        ),
    });

    const result = await createShedSafeTransport(config, fetch).read('B-1');

    expect(result?.calculated).toBe(true);
    expect(result?.values).toEqual({
      importanceLevel: 2,
      windRegion: 'C',
      terrainCategory: 2.5,
      buildingClass: 'Class 10a',
      // A real zero is a real value: ShedSafe calculated it and it is zero.
      snowLoad: 0,
      // ShedSafe calls design wind speed `vSite1`.
      designWindSpeed: 41.5,
      shielding: 1,
      topographicFactor: 1.1,
      snowLoadRegion: null,
      earthquakeHazardFactor: null,
      elevation: 42.5,
      latitude: -27.47,
      longitude: 153.03,
      rainfallIntensity100Years: 264,
      rainfallIntensity20Years: 156,
      rainfallIntensityTown: null,
      // Absent from the payload above, so `null` — "not stated", not "none".
      leftAwningLength: null,
      rightAwningLength: null,
    });
  });

  it('reads the awning lengths, in the spelling ShedSafe actually uses', async () => {
    /*
     * The keys are `leftAwninglength` and `rightAwninglength` — lowercase `l` in `length`, verified
     * against the live API on 2026-11-11 by reading a real building and listing its awning keys. The
     * desktop's model binds the same spelling (`ShedsafeData.cs:117-123`).
     *
     * A property name that is almost right is the classic way to get `undefined` with no error, and the
     * failure is silent: the awning field shows nothing and nobody learns a certificate has an awning.
     * The PascalCase variant is accepted too, because a JSON serializer on their side could change and
     * the cost of accepting both is one `??`.
     */
    const { fetch } = fakeFetch({
      '/authenticate': authOk,
      '/building/get/': () =>
        new Response(
          JSON.stringify({
            autoCalc: true,
            importanceLevel: 2,
            windRegion: 'A5',
            terrainCategory: 2.5,
            buildingClass: 'Class 10a',
            snowLoad: 0,
            vSite1: 41.5,
            leftAwninglength: 3.5,
            rightAwninglength: 0,
          }),
          { status: 200 },
        ),
    });

    const result = await createShedSafeTransport(config, fetch).read('B-1');
    expect(result?.values.leftAwningLength).toBe(3.5);
    // Zero is a fact about the building: ShedSafe says there is no awning on that end.
    expect(result?.values.rightAwningLength).toBe(0);
  });

  it('**reports uncalculated values as uncalculated, even though they are present**', async () => {
    /*
     * The defect the desktop wrote a guard for, reproduced as a test.
     *
     * ShedSafe answers with the wind fields **before** Auto Calc has run, and those values are raw.
     * A reader that keys on "are the values there" accepts them and prices the building against a
     * rating nobody issued — while every screen says the check succeeded. The desktop's own comment:
     *
     *   "the app silently accepts raw/uncalculated values (e.g. wrong topographicFactor / vSite1)
     *    and reports success, corrupting the structural design."
     *
     * Note `windRegion` is populated here: it is filled in before Auto Calc, so it is **not** a
     * signal, and a check on it would pass.
     */
    const { fetch } = fakeFetch({
      '/authenticate': authOk,
      '/building/get/': () =>
        new Response(
          JSON.stringify({
            autoCalc: false,
            windRegion: 'C',
            importanceLevel: 2,
            terrainCategory: 2.5,
            vSite1: 12.3,
            topographicFactor: 1,
          }),
          { status: 200 },
        ),
    });

    const result = await createShedSafeTransport(config, fetch).read('B-1');
    expect(result).not.toBeNull();
    // The values travel — a screen can show what is there — but they are marked as not to be used.
    expect(result?.calculated).toBe(false);
    expect(result?.values.windRegion).toBe('C');
  });

  it('treats an error message from ShedSafe as not calculated', async () => {
    // A building it could not finish is not a building it calculated, whatever the flag says.
    const { fetch } = fakeFetch({
      '/authenticate': authOk,
      '/building/get/': () =>
        new Response(
          JSON.stringify({
            autoCalc: true,
            windRegion: 'C',
            message: { errorMessage: 'Address could not be geocoded' },
          }),
          { status: 200 },
        ),
    });
    const result = await createShedSafeTransport(config, fetch).read('B-1');
    expect(result?.calculated).toBe(false);
    expect(result?.errorMessage).toBe('Address could not be geocoded');
  });

  it('gives nulls rather than zeros for the fields ShedSafe omitted', async () => {
    // A wind region of 0 would be a value nobody certified.
    const { fetch } = fakeFetch({
      '/authenticate': authOk,
      '/building/get/': () => new Response(JSON.stringify({ autoCalc: true }), { status: 200 }),
    });
    const result = await createShedSafeTransport(config, fetch).read('B-1');
    expect(result?.values.importanceLevel).toBeNull();
    expect(result?.values.elevation).toBeNull();
  });

  it('answers null for an unknown building rather than throwing', async () => {
    const { fetch } = fakeFetch({
      '/authenticate': authOk,
      '/building/get/': () => new Response('missing', { status: 404 }),
    });

    expect(await createShedSafeTransport(config, fetch).read('nope')).toBeNull();
  });
});

/**
 * The failures that arrive as HTTP 200.
 *
 * ## What was measured on 2026-11-10, against the live API
 *
 * ```
 * POST /building/create with an unregistered salesman
 *   → 200, buildingId "00000000-0000-0000-0000-000000000000",
 *     message.errorMessage "The salesman provided is not a valid salesman username."
 *
 * GET /building/get/<random uuid>
 *   → 200, message.errorMessage "Building requested not found.", every value 0
 *
 * POST /building/create twice with the SAME Reference and a different height
 *   → two DIFFERENT building ids. The reference is a label, not a key.
 * ```
 *
 * The old code tested `!response.ok` and `buildingId === ''`, so none of the three was noticed:
 * a failed pin was stored as a pinned site with an all-zero id, an unknown building looked like an
 * uncalculated one, and every re-pin created an orphan building on the customer's account.
 */
describe('refusals that arrive as success', () => {
  const config = { username: 'u', password: 'p', baseUrl: 'https://shedsafe.test' };

  it('treats an errorMessage on a 200 create as a failure', async () => {
    const { fetch } = fakeFetch({
      '/authenticate': authOk,
      '/building/create': () =>
        new Response(
          JSON.stringify({
            buildingId: '00000000-0000-0000-0000-000000000000',
            message: { errorMessage: 'The salesman provided is not a valid salesman username.' },
          }),
          { status: 200 },
        ),
      '/building/getsalesmansitelink': () => new Response('', { status: 200 }),
    });
    const transport = createShedSafeTransport(config, fetch);

    await expect(
      transport.pin({
        reference: 'R-1',
        siteAddress: { addressLine1: '1 St', suburb: 'Brisbane', state: 'QLD', postcode: '4000' },
        client: { firstName: 'A', lastName: 'B', email: 'a@b.com' },
        salesman: 'nobody@example.com',
        height: 4.2,
        span: 12,
        length: 24,
        importanceLevel: 2,
      }),
    ).rejects.toThrow(/valid salesman username/i);
  });

  it('refuses an all-zero building id even when no message came with it', async () => {
    // A zero GUID is ShedSafe's "no building". Storing it is how a failed pin looked pinned.
    const { fetch } = fakeFetch({
      '/authenticate': authOk,
      '/building/create': () =>
        new Response(JSON.stringify({ buildingId: '00000000-0000-0000-0000-000000000000' }), {
          status: 200,
        }),
      '/building/getsalesmansitelink': () => new Response('', { status: 200 }),
    });

    await expect(
      createShedSafeTransport(config, fetch).pin({
        reference: 'R-2',
        siteAddress: { addressLine1: '1 St', suburb: 'Brisbane', state: 'QLD', postcode: '4000' },
        client: { firstName: 'A', lastName: 'B', email: 'a@b.com' },
        salesman: 'x@y.z',
        height: 4.2,
        span: 12,
        length: 24,
        importanceLevel: 2,
      }),
    ).rejects.toThrow(/without a usable building id/i);
  });

  it('updates rather than creating when a building id is supplied', async () => {
    /*
     * The idempotency path. `POST /building/create` was measured to return a **different** id for the
     * same reference, so re-pinning has to go through `PUT /building/update` — which echoes the id
     * back. This proves the transport chooses the update call, not just that it works.
     */
    const { fetch, calls } = fakeFetch({
      '/authenticate': authOk,
      '/building/update': () =>
        new Response(JSON.stringify({ buildingId: 'build-1', locked: false }), { status: 200 }),
      '/building/getsalesmansitelink': () => new Response('https://sitecheck.test/x', { status: 200 }),
    });

    const pinned = await createShedSafeTransport(config, fetch).pin({
      reference: 'R-3',
      buildingId: 'build-1',
      siteAddress: { addressLine1: '1 St', suburb: 'Brisbane', state: 'QLD', postcode: '4000' },
      client: { firstName: 'A', lastName: 'B', email: 'a@b.com' },
      salesman: 'x@y.z',
      height: 5,
      span: 12,
      length: 24,
      importanceLevel: 2,
    });

    expect(pinned.buildingId).toBe('build-1');
    const update = calls.find((call) => call.url.includes('/building/update'));
    expect(update?.init?.method).toBe('PUT');
    // The id goes in the body as well, which is what ShedSafe keys the update on.
    expect(String(update?.init?.body)).toContain('build-1');
    // And no create was attempted.
    expect(calls.some((call) => call.url.includes('/building/create'))).toBe(false);
  });

  it('answers null for an unknown building that ShedSafe reports with a 200', async () => {
    // Measured: a random uuid answers 200 with "Building requested not found." and zeros everywhere.
    const { fetch } = fakeFetch({
      '/authenticate': authOk,
      '/building/get/': () =>
        new Response(
          JSON.stringify({
            autoCalc: false,
            importanceLevel: 0,
            vSite1: 0,
            message: { errorMessage: 'Building requested not found.' },
          }),
          { status: 200 },
        ),
    });

    expect(await createShedSafeTransport(config, fetch).read('random-uuid')).toBeNull();
  });

  it('zero-fills nothing on a calculated building — a real zero stays zero', async () => {
    /*
     * The other direction, and the reason the zero rule is conditional. A Brisbane site genuinely has
     * a ground snow load of 0 kPa; erasing it would be the same class of error as inventing one.
     */
    const { fetch } = fakeFetch({
      '/authenticate': authOk,
      '/building/get/': () =>
        new Response(
          JSON.stringify({
            autoCalc: true,
            importanceLevel: 2,
            windRegion: 'A5',
            terrainCategory: 3,
            snowLoad: 0,
            vSite1: 37.4,
            message: { errorMessage: null },
          }),
          { status: 200 },
        ),
    });

    const result = await createShedSafeTransport(config, fetch).read('b-1');
    expect(result?.calculated).toBe(true);
    expect(result?.values.snowLoad).toBe(0);
    expect(result?.values.windRegion).toBe('A5');
    expect(result?.values.designWindSpeed).toBe(37.4);
  });

  it('lists the salesmen, whose email is the field a pin needs', async () => {
    const { fetch } = fakeFetch({
      '/authenticate': authOk,
      '/building/getsalesmanusers': () =>
        new Response(
          JSON.stringify([
            { salesman: 'a@x.com', formattedName: 'A One', franchiseName: 'Head Office', franchiseId: 'f-1', restricted: false },
            { salesman: 'b@x.com', formattedName: 'B Two', franchiseName: 'Branch_01', franchiseId: 'f-2', restricted: true },
            // A row with no email cannot be a salesman; it is dropped rather than listed blank.
            { formattedName: 'No Email' },
          ]),
          { status: 200 },
        ),
    });

    const salesmen = await createShedSafeTransport(config, fetch).salesmen();
    expect(salesmen).toHaveLength(2);
    expect(salesmen[0]?.email).toBe('a@x.com');
    expect(salesmen[1]?.restricted).toBe(true);
  });
});
