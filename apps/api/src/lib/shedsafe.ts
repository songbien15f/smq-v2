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

/** The six certified fields, as ShedSafe names them. */
export interface SiteCheckValues {
  importanceLevel: number | null;
  windRegion: string | null;
  terrainCategory: number | null;
  buildingClass: string | null;
  snowLoad: number | null;
  /** ShedSafe calls this `vSite1`. Metres per second. */
  designWindSpeed: number | null;
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
    /** Metres, as ShedSafe wants them. */
    height: number;
    span: number;
    length: number;
    importanceLevel: number;
  }): Promise<PinnedBuilding>;
  /** The six certified fields, or `null` when ShedSafe has not calculated the building yet. */
  read(buildingId: string): Promise<SiteCheckValues | null>;
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
        `/building/getsalesmansitelink?id=${encodeURIComponent(body.buildingId)}&salesman=${encodeURIComponent(input.client.email)}&returnurl=${encodeURIComponent(`https://sitecheck.shedsafe.com.au/Building/Edit/${body.buildingId}`)}`,
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

      /*
       * A building that has been pinned but not calculated has no rating yet. Answering with nulls
       * rather than zeros is what lets the screen say "not calculated" instead of showing a wind
       * region of 0 — a value nobody certified.
       */
      const values: SiteCheckValues = {
        importanceLevel: num(body.importanceLevel),
        windRegion: str(body.windRegion),
        terrainCategory: num(body.terrainCategory),
        buildingClass: str(body.buildingClass),
        snowLoad: num(body.snowLoad),
        designWindSpeed: num(body.vSite1),
      };

      const hasAny = Object.values(values).some((value) => value !== null);
      return hasAny ? values : null;
    },
  };
}
