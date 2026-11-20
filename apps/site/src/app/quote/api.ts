'use client';

/**
 * The Guest page's only door to the API: `/api/sq/…` on this origin (the site's bridge), which
 * forwards the public Guest routes and nothing else.
 *
 * A failure is a value, not an exception, like the editor's `lib/sq.ts`: "the service is not answering"
 * is a sentence the page shows next to a Retry button.
 */

import type { ApiResult } from '@sq/contracts';

export async function guestApi<T>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; signal?: AbortSignal } = {},
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/sq/${path}`, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      ...(init.signal === undefined ? {} : { signal: init.signal }),
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return { ok: false, code: 'upstream_failed', message: 'You appear to be offline. Check your connection and try again.' };
  }
  try {
    return (await response.json()) as ApiResult<T>;
  } catch {
    return {
      ok: false,
      code: 'internal',
      message: `The server answered ${response.status} with something unexpected. Please try again in a moment.`,
    };
  }
}
