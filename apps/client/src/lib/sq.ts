'use client';

/**
 * The client's only door to the API.
 *
 * Everything goes through `/api/sq/…`, which is same-origin, so the session cookie is attached
 * by the browser and never handled in JavaScript.
 *
 * The distinction the return type preserves: a failure is a value, not an exception. A price that
 * cannot be calculated is a normal state the screen has to explain — "no price book has been
 * published" is a sentence for an operator, and an exception loses it.
 */

import type { ApiResult } from '@sq/contracts';

/** Call the API through the bridge. */
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
    // A non-JSON answer means something between the browser and the API failed — a proxy, a
    // crashed process. Reported as a failure with the status, because "unexpected token <" tells
    // an operator nothing.
    return {
      ok: false,
      code: 'internal',
      message: `The server answered ${response.status} with something that was not a response. It may be restarting.`,
    };
  }

  return payload;
}

/** A stable key for one save attempt, so a double-click is one revision. */
export function newIdempotencyKey(): string {
  // `crypto.randomUUID` needs a secure context, which `localhost` is and a plain-http LAN address
  // is not. The fallback is still unique enough for one idempotency window.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `ui-${crypto.randomUUID()}`;
  }
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
