/**
 * Talking to the API from an admin **component**.
 *
 * `lib/api.ts` is for server components: it reads the cookie jar with `next/headers`, which a
 * browser component cannot do. This module is the browser side and goes through the admin app's own
 * `/api/sq/…` bridge, so the session cookie is attached by the browser and never handled in
 * JavaScript.
 *
 * The distinction the return type preserves: a failure is a value, not an exception. "Your role
 * cannot change seats" is a sentence for a person, and an exception loses it.
 */

import type { ApiResult } from '@sq/contracts';

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const response = await fetch(`/api/sq/${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    cache: 'no-store',
  });

  let payload: ApiResult<T>;
  try {
    payload = (await response.json()) as ApiResult<T>;
  } catch {
    return {
      ok: false,
      code: 'internal',
      message: `The server answered ${response.status} with something that was not JSON.`,
    };
  }

  return payload;
}
