/**
 * Talking to the API from the admin app.
 *
 * Identical in shape to the client app's module, deliberately: two apps with two
 * different ways of forwarding a session is two places for an authorization mistake.
 */

import { cookies } from 'next/headers';
import type { ApiResult } from '@sq/contracts';

export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? 'http://localhost:3060/api/v1';
}

/** Call the API with the session cookie forwarded. */
export async function serverFetch<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init.headers ?? {}),
      ...(cookieHeader === '' ? {} : { cookie: cookieHeader }),
      accept: 'application/json',
    },
  });

  return (await response.json()) as ApiResult<T>;
}
