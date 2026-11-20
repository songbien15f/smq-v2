/**
 * Configuration, read once at boot and validated.
 *
 * Every failure here is a startup failure. A server that boots with a missing
 * session secret and discovers it on the first sign-in is a server that has been
 * observed failing in production; refusing to boot is cheaper.
 */

import { randomBytes } from 'node:crypto';

/** Everything the API needs. */
export interface ApiConfig {
  port: number;
  host: string;
  /** Signs session tokens. A short or default value is refused in production. */
  sessionSecret: string;
  /** Absolute session lifetime, in hours. */
  sessionTtlHours: number;
  /** Idle timeout, in hours. A session untouched for longer is refused. */
  sessionIdleHours: number;
  /**
   * How many days a device may go unused before its seat is reclaimed.
   *
   * A seat belongs to a device (DECISIONS D3). A device nobody has touched for this long is treated
   * as abandoned, and its seat becomes available again at the next sign-in in that company. Too small
   * and somebody returning from two weeks' leave has lost their seat to a colleague; too large and an
   * abandoned laptop holds a seat for a month.
   */
  deviceIdleDays: number;
  /** Origins allowed to call the API. */
  allowedOrigins: string[];
  /** Where each service is reachable; share links and mail links are built from these. */
  origins: { api: string; client: string; admin: string; site: string };
  /** `true` in production; enables the strict checks below. */
  production: boolean;
  /**
   * Which peers may set `X-Forwarded-For`, in Fastify's `trustProxy` form: `false`, `'true'` (dev
   * only), or a comma-separated address/CIDR list.
   *
   * **Not `true`.** With `trustProxy: true`, any caller can claim any address by sending the header,
   * which makes every per-IP rate limit decorative — and the API has to be reachable from the site's
   * browser form. A list of trusted peers means the header is honoured only where a proxy actually
   * wrote it. See `docs/OPERATIONS.md` for the deployment this assumes.
   */
  trustProxy: boolean | string;
  /** Address suggestions on the public Guest quote page (plan G-a P14). Off unless switched on. */
  guestPlaces: GuestPlacesConfig;
}

/**
 * The Guest page's Places proxy (`lib/guestPlaces.ts`).
 *
 * Off by default, so a development machine with a real `GOOGLE_PLACES_API_KEY` in `.env` does not
 * spend money from a public page nobody meant to open. The operator's editor routes (`/places/*`)
 * are not affected by any of this.
 */
export interface GuestPlacesConfig {
  /** `GUEST_PLACES_ENABLED=1`. Off, the public Places routes answer 503 and the page falls back. */
  enabled: boolean;
  /** Signs the page's Places session ids. */
  sessionSecret: string;
  /** Most autocomplete calls the whole system sends Google in one UTC day. */
  dailyAutocompleteCap: number;
  /** Most details calls the whole system sends Google in one UTC day. */
  dailyDetailsCap: number;
}

const DEV_SECRET = 'dev-only-secret-change-me';

/** A whole number of calls between 0 and a million, or the default when unset. */
function cap(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
    throw new Error(`${name} must be a whole number between 0 and 1000000, got '${raw}'.`);
  }
  return value;
}

/**
 * Read the Guest Places settings.
 *
 * The secret is checked only when the feature is on: refusing to boot an existing production server
 * over a secret for a switch it has not turned on would break a working deployment for nothing. In
 * development an unset secret becomes a per-process random one — a session lives three minutes, so a
 * restart that invalidates them costs a guest one retyped character.
 */
export function loadGuestPlacesConfig(env: NodeJS.ProcessEnv, production: boolean): GuestPlacesConfig {
  const enabled = (env.GUEST_PLACES_ENABLED ?? '').trim() === '1';
  const raw = (env.GUEST_PLACES_SESSION_SECRET ?? '').trim();
  if (production && enabled && raw.length < 32) {
    throw new Error(
      'GUEST_PLACES_SESSION_SECRET must be at least 32 characters in production when GUEST_PLACES_ENABLED=1. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return {
    enabled,
    sessionSecret: raw !== '' ? raw : randomBytes(32).toString('hex'),
    dailyAutocompleteCap: cap(env.GUEST_PLACES_DAILY_AUTOCOMPLETE_CAP, 'GUEST_PLACES_DAILY_AUTOCOMPLETE_CAP', 2000),
    dailyDetailsCap: cap(env.GUEST_PLACES_DAILY_DETAILS_CAP, 'GUEST_PLACES_DAILY_DETAILS_CAP', 300),
  };
}

/**
 * Parse `TRUST_PROXY`.
 *
 * | value | result |
 * |---|---|
 * | unset or empty | `'loopback'` — one machine, the common case |
 * | `'false'` / `'0'` | `false` — no proxy at all |
 * | `'true'` | `true`, **refused in production**: it trusts the header from anyone |
 * | a comma-separated list | trimmed and rejoined; `loopback`, `linklocal`, `uniquelocal` or CIDRs |
 * | a bare number | **refused**, with the reason |
 *
 * ## Why a hop count is refused rather than accepted
 *
 * The plan for this work allowed `TRUST_PROXY=2` (two proxies). Fastify 5 deliberately **fails closed**
 * for a numeric `trustProxy`: hop counting cannot validate the immediate peer, so a direct client
 * could spoof an address by supplying enough hops. Accepting the value would mean a deployment that
 * reads correct in `.env` and quietly trusts nobody. Naming the proxies is the supported answer, so the
 * refusal says that instead of silently doing something else.
 */
export function parseTrustProxy(raw: string | undefined, production: boolean): boolean | string {
  const value = (raw ?? '').trim();
  if (value === '') return 'loopback';

  if (value === 'false' || value === '0') return false;
  if (value === 'true') {
    if (production) {
      throw new Error(
        'TRUST_PROXY=true is refused in production: it honours X-Forwarded-For from any caller, so ' +
          'every per-IP rate limit can be bypassed by sending a header. Name the proxies instead — ' +
          '"loopback", "loopback,uniquelocal", or their address list.',
      );
    }
    return true;
  }

  if (/^\d+$/.test(value)) {
    throw new Error(
      `TRUST_PROXY='${value}' is a hop count, which Fastify 5 refuses: it cannot validate the ` +
        'immediate peer, so a direct caller could spoof an address. Name the proxies instead, e.g. ' +
        '"loopback,uniquelocal" or their addresses.',
    );
  }

  // A list. Trim each entry, so `'loopback, 10.0.0.0/8'` does not leave a space inside a CIDR and fail
  // in a way that only shows up as "every request has the proxy's IP".
  const entries = value.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
  if (entries.length === 0) throw new Error(`TRUST_PROXY='${value}' names no address.`);
  return entries.join(',');
}

/**
 * Where each front-end is reachable, from the ports when the explicit origins are unset.
 *
 * ## Why this exists
 *
 * Four ports used to be stated in five more places (`.env`'s `API_PORT` plus three `*_ORIGIN`s, each
 * `package.json`, the two launcher `.bat`s), so changing a port meant editing six files and getting
 * one wrong produced a symptom that pointed elsewhere: a browser refused as cross-origin, or a
 * bridge calling a service that is not there. Now `start/ports.env` is the one list, and an explicit
 * `*_ORIGIN` still wins when a deployment genuinely puts a service on another host.
 *
 * A value read here is what the API compares `Origin` against, so it has to match the port the
 * front-end actually listens on — `scripts/next-port.mjs` passes the same `CLIENT_PORT` etc. through
 * to `next dev`.
 */
export function serviceOrigins(env: NodeJS.ProcessEnv = process.env): {
  api: string;
  client: string;
  admin: string;
  site: string;
} {
  const origin = (explicit: string | undefined, portVar: string, defaultPort: number): string => {
    const given = (explicit ?? '').trim();
    if (given !== '') return given.replace(/\/$/, '');
    const port = Number((env[portVar] ?? '').trim() || defaultPort);
    return `http://localhost:${Number.isInteger(port) ? port : defaultPort}`;
  };
  return {
    api: origin(env.API_ORIGIN, 'API_PORT', 3060),
    client: origin(env.CLIENT_ORIGIN, 'CLIENT_PORT', 3061),
    admin: origin(env.ADMIN_ORIGIN, 'ADMIN_PORT', 3062),
    site: origin(env.SITE_ORIGIN, 'SITE_PORT', 3063),
  };
}

/** Read and validate the configuration. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const production = env.NODE_ENV === 'production';

  const sessionSecret = env.SESSION_SECRET ?? DEV_SECRET;
  if (production && (sessionSecret === DEV_SECRET || sessionSecret.length < 32)) {
    throw new Error(
      'SESSION_SECRET must be at least 32 characters in production. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  const deviceIdleDays = Number(env.DEVICE_IDLE_DAYS ?? 14);
  if (!Number.isInteger(deviceIdleDays) || deviceIdleDays < 1 || deviceIdleDays > 365) {
    // An out-of-range value is a typo, and either extreme is harmful: `0` reclaims every device
    // instantly (nobody can stay signed in), and a year means an abandoned laptop holds a seat for a
    // year. Refusing at boot beats discovering it from a support call.
    throw new Error(
      `DEVICE_IDLE_DAYS must be a whole number of days between 1 and 365, got '${env.DEVICE_IDLE_DAYS}'.`,
    );
  }

  const origins = serviceOrigins(env);
  const allowedOrigins = [origins.admin, origins.client, origins.site];

  if (production && env.CLIENT_ORIGIN === undefined && env.CLIENT_PORT === undefined) {
    // In production the origins are a deployment fact, not a localhost default. Saying so at boot
    // beats a browser refusing every request as cross-origin with nothing in the log.
    throw new Error(
      'CLIENT_ORIGIN is not set. In production, state where each front-end is reachable ' +
        '(CLIENT_ORIGIN, ADMIN_ORIGIN, SITE_ORIGIN) rather than relying on the localhost defaults.',
    );
  }

  return {
    port: Number(env.API_PORT ?? 3060),
    host: env.API_HOST ?? '0.0.0.0',
    sessionSecret,
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 168),
    sessionIdleHours: Number(env.SESSION_IDLE_HOURS ?? 24),
    deviceIdleDays,
    allowedOrigins,
    origins,
    production,
    trustProxy: parseTrustProxy(env.TRUST_PROXY, production),
    guestPlaces: loadGuestPlacesConfig(env, production),
  };
}
