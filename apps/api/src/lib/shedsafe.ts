/**
 * ShedSafe: the wind rating a quote is priced against.
 *
 * ## What ShedSafe is, and what this module is not
 *
 * ShedSafe issues the site-specific wind rating an Australian shed quote must state. The certificate
 * belongs to the **manufacturer's own ShedSafe account** — this product cannot issue one, and must
 * never imply it does. What it can do is hand the operator a link into their own account and read the
 * six certified numbers back, so the quote is priced against a real rating rather than a guess.
 *
 * ## What was copied from the licence server, and what was deliberately not
 *
 * The old server proxied ShedSafe with **hard-coded credentials** (`wdsapi1` / a password in
 * `appsettings.json`, and again as fallbacks in code) and its endpoints had **no authentication at
 * all** — anyone who could reach the host could pin buildings. Neither is reproduced here:
 *
 * - Credentials come from `SHEDSAFE_USERNAME` / `SHEDSAFE_PASSWORD` and never leave the server.
 * - Every route is behind this product's own session and a capability.
 * - The bearer token is cached in memory with an expiry, so a burst of requests is one authenticate.
 *
 * ## Why the token is cached rather than fetched per call
 *
 * ShedSafe issues a token with an expiry. Authenticating on every request would be a login per
 * keystroke and would eventually be rate-limited by them. The cache key includes the base URL so a
 * test server and production cannot share a token.
 */

/**
 * The certified fields, as ShedSafe names them.
 *
 * Six of these decide the structural design, and all six come back **before** the site has been
 * calculated on ShedSafe's own web app — which is why `calculated` travels beside them. See
 * `SiteCheckResult`.
 */
export interface SiteCheckValues {
  importanceLevel: number | null;
  windRegion: string | null;
  terrainCategory: number | null;
  buildingClass: string | null;
  snowLoad: number | null;
  /** ShedSafe calls this `vSite1`. Metres per second. */
  designWindSpeed: number | null;

  /*
   * The seven geographic parameters the desktop showed under "show more parameters". They do not
   * drive the price directly, but they are part of what the certificate says about this site, and
   * an operator reading a quote against its rating needs them.
   */
  /** Terrain shielding, the multiplier the wind code applies for obstructions upwind. */
  shielding: number | null;
  /** The topographic factor `Mt` — a ridge or a escarpment raises the design wind speed. */
  topographicFactor: number | null;
  /** The region name behind `snowLoad`, when the site has one. */
  snowLoadRegion: string | null;
  /** The hazard factor `Z` for the site's location. */
  earthquakeHazardFactor: number | null;
  /** Height above sea level, metres. */
  elevation: number | null;
  latitude: number | null;
  longitude: number | null;
  /** Rainfall intensity for the 100- and 20-year return periods, mm/h. */
  rainfallIntensity100Years: number | null;
  rainfallIntensity20Years: number | null;
  /** The town those intensities were read for, so the number can be traced. */
  rainfallIntensityTown: string | null;
}

/**
 * What reading a ShedSafe building produced.
 *
 * ## Why `calculated` is a separate answer, and why it is the important one
 *
 * ShedSafe returns every one of the fields above **whether or not** the operator has pressed
 * *Auto Calc* on its own web app. The values before that press are raw — `topographicFactor` and
 * `vSite1` in particular are not the site's certified numbers yet — and taking them would price a
 * building against a wind rating nobody issued.
 *
 * The desktop learned this the hard way and wrote a guard for it. Its own comment says so:
 *
 * > *GUARD: block premature "Get SiteCheck Report" before the building has been Pinned + Auto
 * > Calculated on the ShedSafe web. Without this, the app silently accepts raw/uncalculated values
 * > (e.g. wrong topographicFactor / vSite1) and reports success, corrupting the structural design.*
 *
 * And it keys off `autoCalc`, **not** `windRegion`, because `windRegion` is populated before Auto
 * Calc runs (same comment). That is the detail that makes the difference between a guard and the
 * appearance of one.
 */
export interface SiteCheckResult {
  /** True when ShedSafe says the building has been Auto Calculated and reports no error. */
  calculated: boolean;
  /** ShedSafe's own error message, when it gave one. Non-empty means it did not finish. */
  errorMessage: string | null;
  values: SiteCheckValues;
}

/** What a pin returns. */
export interface PinnedBuilding {
  buildingId: string;
  siteLink: string;
  locked: boolean;
}

/** Raised when ShedSafe is not configured, so a route can answer 503 rather than 500. */
export class ShedSafeNotConfigured extends Error {
  constructor() {
    super(
      'ShedSafe is not configured on this server. Set SHEDSAFE_USERNAME and SHEDSAFE_PASSWORD, or type the wind fields by hand.',
    );
    this.name = 'ShedSafeNotConfigured';
  }
}

/** Raised when ShedSafe refused or failed. Carries the message ShedSafe gave, when it gave one. */
export class ShedSafeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShedSafeError';
  }
}

export interface ShedSafeConfig {
  baseUrl: string;
  username: string;
  password: string;
}

/** The configuration from the environment, or `null` when it is not set up. */
export function shedSafeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ShedSafeConfig | null {
  const username = env.SHEDSAFE_USERNAME;
  const password = env.SHEDSAFE_PASSWORD;
  if (username === undefined || username.trim() === '' || password === undefined || password.trim() === '') {
    return null;
  }
  return {
    baseUrl: (env.SHEDSAFE_BASE_URL ?? 'https://api.sitecheck.shedsafe.com.au/v1').replace(/\/+$/, ''),
    username: username.trim(),
    password,
  };
}

/**
 * True when credentials are set, so a route can answer "not configured" rather than failing a call.
 *
 * Paired with `placesConfigured` deliberately: both integrations are optional, both live in `.env`,
 * and both must degrade to the hand-typed path rather than to an error.
 */
export function shedsafeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return shedSafeConfigFromEnv(env) !== null;
}

/** A cached bearer token and when it stops being usable. */
interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Tokens, keyed by base URL + username so two configurations cannot share one. */
const tokens = new Map<string, CachedToken>();

/** Clear the cache. Exported for tests, which must not inherit a token from a previous case. */
export function clearShedSafeTokens(): void {
  tokens.clear();
}

/** How long before expiry a token is replaced, so a call never races the expiry. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/** The transport, injected so the routes can be tested without ShedSafe. */
export interface ShedSafeTransport {
  pin(input: {
    reference: string;
    siteAddress: { addressLine1: string; suburb: string; state: string; postcode: string };
    client: { firstName: string; lastName: string; email: string };
    /**
     * The salesperson's name or email, sent to ShedSafe so their own site shows who asked.
     *
     * Optional, and **not** the customer's email: the parameter is the person doing the site check.
     * The desktop sends an empty string here and lets the operator type one; this does the same when
     * the caller has nothing to say.
     */
    salesman?: string;
    /** Metres, as ShedSafe wants them. */
    height: number;
    span: number;
    length: number;
    importanceLevel: number;
  }): Promise<PinnedBuilding>;
  /**
   * The building's fields, **and whether ShedSafe has calculated them**.
   *
   * `null` means ShedSafe has no such building (404). A building it has but has not calculated
   * comes back with `calculated: false` and the raw values, so a caller can say *why* it will not
   * use them rather than pretending the building does not exist.
   */
  read(buildingId: string): Promise<SiteCheckResult | null>;
}

/**
 * A transport backed by the ShedSafe API.
 *
 * The wire shapes follow the licence server's DTOs, which are the only description of this API that
 * exists: `map_pin` was `POST /building/create` then `GET /building/getsalesmansitelink`, and the
 * report was `GET /building/get/{id}`.
 */
export function createShedSafeTransport(
  config: ShedSafeConfig,
  fetchImpl: typeof fetch = fetch,
): ShedSafeTransport {
  const cacheKey = `${config.baseUrl}|${config.username}`;

  async function token(): Promise<string> {
    const cached = tokens.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > Date.now() + EXPIRY_MARGIN_MS) return cached.token;

    const response = await fetchImpl(`${config.baseUrl}/authenticate`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: config.username, password: config.password }).toString(),
    });
    if (!response.ok) {
      throw new ShedSafeError(`ShedSafe refused the credentials (${response.status}).`);
    }

    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (body.access_token === undefined || body.access_token === '') {
      throw new ShedSafeError('ShedSafe answered without a token.');
    }

    const lifetimeMs = (typeof body.expires_in === 'number' ? body.expires_in : 3600) * 1000;
    tokens.set(cacheKey, { token: body.access_token, expiresAt: Date.now() + lifetimeMs });
    return body.access_token;
  }

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const bearer = await token();
    return fetchImpl(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
      },
    });
  }

  return {
    async pin(input) {
      /*
       * The create call. The licence server sent PascalCase keys with no explicit mapping and relied
       * on case-insensitive binding; this sends the same spellings deliberately, because they are
       * what the upstream accepts.
       */
      const created = await call('/building/create', {
        method: 'POST',
        body: JSON.stringify({
          Reference: input.reference,
          Salesman: input.client.email,
          SiteAddress: {
            AddressLine1: input.siteAddress.addressLine1,
            SuburbName: input.siteAddress.suburb,
            State: input.siteAddress.state,
            Country: 'AU',
            Postcode: input.siteAddress.postcode,
          },
          Client: {
            FirstName: input.client.firstName,
            LastName: input.client.lastName,
            Email: input.client.email,
          },
          ImportanceLevel: input.importanceLevel,
          Height: input.height,
          Span: input.span,
          Length: input.length,
        }),
      });

      if (!created.ok) {
        const body = await created.text().catch(() => '');
        let upstreamMessage: string | undefined;
        try {
          upstreamMessage = (JSON.parse(body) as { message?: { errorMessage?: string } }).message?.errorMessage;
        } catch {
          /* not JSON — fall through to the generic message below */
        }
        throw new ShedSafeError(
          upstreamMessage ?? `ShedSafe could not create the building (${created.status}).`,
        );
      }

      const body = (await created.json()) as {
        buildingId?: string;
        locked?: boolean;
        message?: { errorMessage?: string };
      };
      if (body.buildingId === undefined || body.buildingId === '') {
        throw new ShedSafeError(body.message?.errorMessage ?? 'ShedSafe answered without a building id.');
      }

      /*
       * The site link. The licence server had to unwrap `{"url":"…"}` with a regex fallback because
       * the endpoint sometimes answers bare text — so both shapes are handled here rather than one.
       */
      const linkResponse = await call(
        `/building/getsalesmansitelink?id=${encodeURIComponent(body.buildingId)}&salesman=${encodeURIComponent(input.salesman ?? '')}&returnurl=${encodeURIComponent(`https://sitecheck.shedsafe.com.au/Building/Edit/${body.buildingId}`)}`,
      );
      const raw = linkResponse.ok ? (await linkResponse.text()).trim() : '';
      let siteLink = '';
      if (raw.startsWith('{')) {
        try {
          siteLink = (JSON.parse(raw) as { url?: string }).url ?? '';
        } catch {
          siteLink = '';
        }
      } else {
        siteLink = raw;
      }

      return { buildingId: body.buildingId, siteLink, locked: body.locked === true };
    },

    async read(buildingId) {
      const response = await call(`/building/get/${encodeURIComponent(buildingId)}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new ShedSafeError(`ShedSafe could not read the building (${response.status}).`);
      }

      const body = (await response.json()) as Record<string, unknown>;
      const num = (value: unknown): number | null =>
        typeof value === 'number' && Number.isFinite(value) ? value : null;
      const str = (value: unknown): string | null =>
        typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

      const values: SiteCheckValues = {
        importanceLevel: num(body.importanceLevel),
        windRegion: str(body.windRegion),
        terrainCategory: num(body.terrainCategory),
        buildingClass: str(body.buildingClass),
        snowLoad: num(body.snowLoad),
        designWindSpeed: num(body.vSite1),
        // The seven geographic parameters, same null-when-absent rule: a zero here would be a
        // reading nobody took.
        shielding: num(body.shielding),
        topographicFactor: num(body.topographicFactor),
        snowLoadRegion: str(body.snowLoadRegion),
        earthquakeHazardFactor: num(body.earthquakeHazardFactor),
        elevation: num(body.elevation),
        latitude: num(body.latitude),
        longitude: num(body.longitude),
        rainfallIntensity100Years: num(body.rainfallIntensity100Years),
        rainfallIntensity20Years: num(body.rainfallIntensity20Years),
        rainfallIntensityTown: str(body.rainfallIntensityTown),
      };

      /*
       * **The guard the desktop already paid for.**
       *
       * ShedSafe returns these fields whether or not Auto Calc has run, and the pre-calculation
       * values are raw — `topographicFactor` and `vSite1` above all. The desktop's comment records
       * what happened without this check: *"the app silently accepts raw/uncalculated values …
       * and reports success, corrupting the structural design."*
       *
       * Keyed on `autoCalc` **and** an empty error, exactly as the desktop does, because
       * `windRegion` is populated before Auto Calc and would pass as "calculated" if it were the
       * signal. That is the whole reason this is not a check on whether the values look plausible.
       */
      const errorMessage = str((body.message as Record<string, unknown> | undefined)?.errorMessage);
      const calculated = body.autoCalc === true && (errorMessage === null || errorMessage === '');

      return { calculated, errorMessage, values };
    },
  };
}
