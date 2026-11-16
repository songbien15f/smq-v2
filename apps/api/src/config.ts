/**
 * Configuration, read once at boot and validated.
 *
 * Every failure here is a startup failure. A server that boots with a missing
 * session secret and discovers it on the first sign-in is a server that has been
 * observed failing in production; refusing to boot is cheaper.
 */

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
}

const DEV_SECRET = 'dev-only-secret-change-me';

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

  const allowedOrigins = [env.ADMIN_ORIGIN, env.CLIENT_ORIGIN, env.SITE_ORIGIN]
    .filter((value): value is string => value !== undefined && value.trim() !== '')
    .map((value) => value.trim().replace(/\/$/, ''));

  if (production && allowedOrigins.length === 0) {
    throw new Error(
      'No allowed origins. Set at least CLIENT_ORIGIN, or every browser request will be refused as cross-origin.',
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
    production,
    trustProxy: parseTrustProxy(env.TRUST_PROXY, production),
  };
}
