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

/**
 * True for `00000000-0000-0000-0000-000000000000`.
 *
 * ShedSafe uses the all-zero GUID as its "no building" answer to a **successful** create. Measured
 * 2026-11-10: a rejected create answers HTTP 200 with this id plus an `errorMessage`. Treating it as
 * a real id is how a failed pin was stored as a pinned site.
 */
function isAllZeroGuid(value: string): boolean {
  return /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value.trim());
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

/** A salesman registered in the company's own ShedSafe account. */
export interface ShedSafeSalesman {
  /** The email. **This**, not a display name, is what `Salesman` accepts. */
  email: string;
  formattedName: string | null;
  franchiseName: string | null;
  franchiseId: string | null;
  /** ShedSafe's own flag: a restricted salesman may be limited in what they can change. */
  restricted: boolean;
}

/** The transport, injected so the routes can be tested without ShedSafe. */
export interface ShedSafeTransport {
  /**
   * Create, or update, the building for this site check.
   *
   * ## Why `buildingId` is an input and not only an output
   *
   * Measured 2026-11-10: `POST /building/create` is **not** idempotent on `Reference`. Sending the
   * same reference twice with a different height returned **two different building ids**. So the
   * reference is a label, and re-pinning without an id leaves a second building behind on the
   * customer's ShedSafe account — which is what this product had been doing on every re-pin.
   *
   * When `buildingId` is supplied the transport calls `PUT /building/update` instead, which was
   * verified to answer 200 and echo the same id. That is the idempotency path; the reference alone
   * is not.
   */
  pin(input: {
    reference: string;
    /** An existing ShedSafe building to update rather than a second one to create. */
    buildingId?: string | null;
    siteAddress: { addressLine1: string; suburb: string; state: string; postcode: string };
    client: { firstName: string; lastName: string; email: string };
    /**
     * The **email** of the signed-in person, which ShedSafe matches against its own salesman list.
     *
     * Measured: a display name, the API login name, and an unregistered email are all refused with
     * *"The salesman provided is not a valid salesman username."* — while a registered salesman's
     * email is accepted. Optional here so a caller without a session can still be tested; the route
     * always supplies it.
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
   * `null` means ShedSafe has no such building. Note that a missing building answers **200** with
   * `message.errorMessage: "Building requested not found."`, not 404 — measured 2026-11-10 — so the
   * check is on the message, not the status.
   */
  read(buildingId: string): Promise<SiteCheckResult | null>;
  /**
   * Every salesman registered in this account.
   *
   * The **authority** on who may pin a site check. The old licence database also carries a salesman
   * table, but it is a stale snapshot: measured against the live list, it was missing five people and
   * still listed two who had been deleted. A product that trusted the snapshot would offer a pin that
   * ShedSafe refuses, which is exactly what it did.
   */
  salesmen(): Promise<ShedSafeSalesman[]>;
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
       * Create, or update when there is already a building for this check.
       *
       * The licence server sent PascalCase keys with no explicit mapping and relied on
       * case-insensitive binding; this sends the same spellings deliberately, because they are what
       * the upstream accepts.
       *
       * ## Why update, and not a second create
       *
       * Measured 2026-11-10: `POST /building/create` with the same `Reference` twice and a different
       * height returned **two different building ids**. The reference is a label to ShedSafe, not a
       * key — so re-pinning without an id leaves an orphan building on the customer's account, and
       * every PIN press did exactly that. `PUT /building/update` answers 200 and echoes the same id,
       * which is the behaviour this path needs.
       */
      const updating = typeof input.buildingId === 'string' && input.buildingId !== '';
      const created = await call(updating ? '/building/update' : '/building/create', {
        method: updating ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...(updating ? { BuildingId: input.buildingId, Id: input.buildingId } : {}),
          Reference: input.reference,
          /*
           * The **salesperson** email, never the customer's email and never a display name.
           *
           * Measured against the live API: a display name, the API login name and an unregistered
           * email are all refused — only a registered salesman's email is accepted.
           */
          Salesman: input.salesman ?? '',
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

      /*
       * ## The failure that arrives as success
       *
       * ShedSafe answers **HTTP 200** for a rejected create: the body carries
       * `buildingId: "00000000-0000-0000-0000-000000000000"` and
       * `message.errorMessage: "The salesman provided is not a valid salesman username."`.
       *
       * Measured 2026-11-10. Before this check, `!created.ok` never fired and the all-zero id was
       * written to the database as a real building — the row that sat in the dev database for weeks
       * looking like a pinned site. So the response body is inspected, not just the status code.
       */
      const rawBody = await created.text().catch(() => '');
      let parsed: {
        buildingId?: string;
        locked?: boolean;
        message?: { errorMessage?: string | null; informationMessage?: string | null };
      } = {};
      try {
        parsed = JSON.parse(rawBody) as typeof parsed;
      } catch {
        /* not JSON — handled by the checks below */
      }

      const upstreamError = (parsed.message?.errorMessage ?? '').trim();
      if (upstreamError !== '') {
        throw new ShedSafeError(upstreamError);
      }
      if (!created.ok) {
        throw new ShedSafeError(
          `ShedSafe could not ${updating ? 'update' : 'create'} the building (${created.status}).`,
        );
      }

      const buildingId = (parsed.buildingId ?? '').trim();
      if (buildingId === '' || isAllZeroGuid(buildingId)) {
        throw new ShedSafeError(
          parsed.message?.informationMessage?.trim() ||
            'ShedSafe answered without a usable building id. The site check was not created.',
        );
      }

      /*
       * The site link. The licence server had to unwrap `{"url":"…"}` with a regex fallback because
       * the endpoint sometimes answers bare text — so both shapes are handled here rather than one.
       */
      const linkResponse = await call(
        `/building/getsalesmansitelink?id=${encodeURIComponent(buildingId)}&salesman=${encodeURIComponent(input.salesman ?? '')}&returnurl=${encodeURIComponent(`https://sitecheck.shedsafe.com.au/Building/Edit/${buildingId}`)}`,
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

      return { buildingId, siteLink, locked: parsed.locked === true };
    },

    /**
     * Every salesman registered in this account.
     *
     * `GET /building/getsalesmanusers` — found in the old licence server
     * (`ShedSafeMethods.cs:127`) and measured against the live API on 2026-11-10. The shape it returns
     * is `{salesman, formattedName, franchiseName, franchiseId, franchiseReference, restricted}`,
     * where `salesman` is the email.
     *
     * This is the authority on who may pin. The `legacy.dbo_salesman` table is a **stale snapshot**:
     * compared with this list it was missing five people and still carried two who had been deleted,
     * so a product trusting the snapshot offers pins ShedSafe refuses.
     */
    async salesmen() {
      const response = await call('/building/getsalesmanusers');
      if (!response.ok) {
        throw new ShedSafeError(`ShedSafe could not list the salesmen (${response.status}).`);
      }
      const body = (await response.json()) as unknown;
      const rows = Array.isArray(body) ? body : [];
      const str = (value: unknown): string | null =>
        typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

      return rows
        .map((row): ShedSafeSalesman | null => {
          const entry = row as Record<string, unknown>;
          const email = str(entry.salesman);
          if (email === null) return null;
          return {
            email,
            formattedName: str(entry.formattedName),
            /*
             * The old data pads these with trailing spaces to a fixed width. Trimmed on the way in so
             * a grouping comparison is about the name, not the padding.
             */
            franchiseName: str(entry.franchiseName),
            franchiseId: str(entry.franchiseId),
            restricted: entry.restricted === true,
          };
        })
        .filter((entry): entry is ShedSafeSalesman => entry !== null);
    },

    async read(buildingId) {
      /*
       * A building that does not exist answers **HTTP 200**, not 404.
       *
       * Measured 2026-11-10 with two ids the account had never seen — an all-zero GUID and a random
       * one — both returned `200` with `message.errorMessage: "Building requested not found."` and
       * every value zero. The 404 branch below therefore never fired, so "no such building" was
       * indistinguishable from "a building nobody has calculated", and the screen showed `0 kPa`,
       * `0 m/s` and `0` as if they were readings.
       *
       * The message is the signal, and the status code is only a fallback.
       */
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

      const message = (body.message ?? {}) as { errorMessage?: unknown };
      const errorMessageText = str(message.errorMessage);
      if (errorMessageText !== null && /not found/i.test(errorMessageText)) {
        return null;
      }

      /*
       * Whether the values can be trusted, decided **before** they are read.
       *
       * The zero rule below depends on it, so it cannot be computed afterwards.
       */
      const calculated = body.autoCalc === true && (errorMessageText === null || errorMessageText === '');

      /*
       * Zero is a reading only when the building has been calculated.
       *
       * ShedSafe **zero-fills** every numeric field of a building it has not Auto Calculated, so
       * `snowLoad: 0` and `vSite1: 0` reach the screen as "0 kPa" and "0 m/s" — values nobody measured,
       * in the same ink as a certified number.
       *
       * But on a **calculated** building a zero can be real: a Brisbane site genuinely has a ground
       * snow load of 0 kPa, and a test asserts exactly that. So the rule is conditional rather than
       * absolute — null while uncalculated, kept once calculated. Making it unconditional would erase
       * a true zero, which is the same class of error in the other direction.
       */
      const reading = (value: unknown): number | null => {
        const parsed = num(value);
        if (parsed === null) return null;
        return parsed === 0 && !calculated ? null : parsed;
      };

      const values: SiteCheckValues = {
        importanceLevel: reading(body.importanceLevel),
        windRegion: str(body.windRegion),
        terrainCategory: reading(body.terrainCategory),
        buildingClass: str(body.buildingClass),
        snowLoad: reading(body.snowLoad),
        designWindSpeed: reading(body.vSite1),
        // The seven geographic parameters, same rule: a zero here would be a reading nobody took.
        shielding: reading(body.shielding),
        topographicFactor: reading(body.topographicFactor),
        snowLoadRegion: str(body.snowLoadRegion),
        earthquakeHazardFactor: reading(body.earthquakeHazardFactor),
        elevation: reading(body.elevation),
        latitude: reading(body.latitude),
        longitude: reading(body.longitude),
        rainfallIntensity100Years: reading(body.rainfallIntensity100Years),
        rainfallIntensity20Years: reading(body.rainfallIntensity20Years),
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
       *
       * `calculated` itself is computed earlier, because the zero rule above depends on it.
       */
      return { calculated, errorMessage: errorMessageText, values };
    },
  };
}
