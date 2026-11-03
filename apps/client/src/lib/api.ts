/**
 * Talking to the API from the client app.
 *
 * Two callers exist and they share this module:
 *
 * - a **server component** reads the session cookie with `cookies()` and forwards it,
 *   so the first paint needs no client-side round trip;
 * - a **client component** calls `withBrowserCookie`, which lets the browser attach
 *   the HttpOnly cookie itself.
 *
 * The cookie is never read from JavaScript. It is HttpOnly on purpose: a token in
 * `document.cookie` is a token any injected script can exfiltrate.
 */

import { cookies } from 'next/headers';
import type { ApiResult } from '@sq/contracts';

/** The API's base URL. Server-side only; the browser talks to this app's own routes. */
export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? 'http://localhost:3060/api/v1';
}

/** A failure the caller may want to distinguish from an empty answer. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Call the API from a server component.
 *
 * `cache: 'no-store'` because every one of these answers is session-specific. A cached
 * user's quote list served to another user is the most embarrassing possible bug, and
 * Next caches `fetch` by default.
 */
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

  const body = (await response.json()) as ApiResult<T>;
  return body;
}

/** Same, but throws on failure — for a server component that renders only on success. */
export async function serverFetchOrThrow<T>(path: string, init: RequestInit = {}): Promise<T> {
  const result = await serverFetch<T>(path, init);
  if (!result.ok) {
    throw new ApiError(0, result.code, result.message);
  }
  return result.data;
}

/**
 * Call the API from a client component.
 *
 * `credentials: 'include'` is what sends the HttpOnly session cookie to the API's
 * origin. The API's CORS allow-list has to name this app's origin, which is why the
 * origin is configured rather than wildcarded.
 */
export async function clientFetch<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.headers ?? {}),
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  });

  return (await response.json()) as ApiResult<T>;
}

/** The current session, or `null` when nobody is signed in. */
export async function currentSession<T>(): Promise<T | null> {
  const result = await serverFetch<T>('/auth/session');
  return result.ok ? result.data : null;
}
