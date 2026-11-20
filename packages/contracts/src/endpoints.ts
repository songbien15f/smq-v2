/**
 * Where the API is, from whatever the environment states.
 *
 * ## Why a function and not a constant
 *
 * `http://localhost:3060/api/v1` used to be written into eight files (the three front-ends' bridges,
 * two session routes, a password route and two `lib/api.ts`). Changing a port meant finding all of
 * them, and missing one produced "the quote service is not answering" — a message that names neither
 * the port nor the file. `start/ports.env` is now the one list; this turns its `API_PORT` into the
 * base URL when `API_BASE_URL` is not stated.
 *
 * It takes **strings, not `process.env`**, because a few of the callers are client components where
 * Next only inlines `NEXT_PUBLIC_*` variables; reading `process.env` there would be undefined at
 * runtime. Each call site passes the values it can legitimately see.
 *
 * Order: an explicit base URL wins (a deployment may put the API on another host); then the port;
 * then 3060, the development default.
 */
export function resolveApiBaseUrl(explicitBaseUrl?: string, apiPort?: string): string {
  const given = (explicitBaseUrl ?? '').trim();
  if (given !== '') return given.replace(/\/$/, '');

  const parsed = Number((apiPort ?? '').trim());
  const port = Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 3060;
  return `http://localhost:${port}/api/v1`;
}
