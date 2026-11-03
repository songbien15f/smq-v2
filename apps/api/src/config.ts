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
  /** Origins allowed to call the API. */
  allowedOrigins: string[];
  /** `true` in production; enables the strict checks below. */
  production: boolean;
  /**
   * One company on one database.
   *
   * Default true, and true in every deployment of this product. Passed through to the
   * company module, which refuses to create a second company while it is set.
   */
  singleCompany: boolean;
}

const DEV_SECRET = 'dev-only-secret-change-me';

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
    allowedOrigins,
    production,
    singleCompany: (env.SINGLE_COMPANY ?? '1').trim() !== '0',
  };
}
