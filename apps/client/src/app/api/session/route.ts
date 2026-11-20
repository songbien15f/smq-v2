/**
 * The session bridge, and the only route that issues a session cookie.
 *
 * The browser only ever talks to this app. This route forwards sign-in, sign-out and the session
 * probe to the API and **re-issues the cookies on this origin**.
 *
 * Why not call the API directly from the browser: the API is a different origin, so every call would
 * need `credentials: 'include'` plus a CORS allow-list, and a misconfiguration of either looks like
 * "the user is randomly signed out". One bridge is one place to be right.
 *
 * ## Two cookies now, not one
 *
 * Cookies have to be set on **this** origin or the browser never sends them, which is why the generic
 * `[...path]` proxy is not enough here. And since DECISIONS D3 there are two:
 *
 * - `sq_session` — the session. Cleared on sign-out.
 * - `sq_device` — the device that holds a licence seat. Long-lived (400 days) and **kept** on an
 *   ordinary sign-out. A bridge that forwarded only `sq_session` would make every sign-in look like a
 *   new browser to the API, which mints a new device and needs another seat — one person could
 *   exhaust a company's seats by signing out and in.
 *
 * Both are copied with `HttpOnly` preserved: the browser gets cookies it cannot read, which is the
 * point.
 */

import { resolveApiBaseUrl } from '@sq/contracts';
import { NextResponse } from 'next/server';
import type { ApiResult } from '@sq/contracts';

/** Where the API lives. Server-side only; never exposed to the browser. */
const API = resolveApiBaseUrl(process.env.API_BASE_URL, process.env.API_PORT);

const SESSION_COOKIE = 'sq_session';
const DEVICE_COOKIE = 'sq_device';
/** Which cookies may come back to the browser. Anything else the API sets is dropped. */
const FORWARDED_COOKIES = new Set([SESSION_COOKIE, DEVICE_COOKIE]);

/**
 * The visitor's address, forwarded so the API can rate-limit per person. Without it every request
 * arrives from this server's own address and one person's wrong passwords count against everybody
 * using the app. The API only honours the header from a peer named in `TRUST_PROXY`.
 */
function forwardedFor(request: Request): Record<string, string> {
  const address = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
  return address === null || address === '' ? {} : { 'x-forwarded-for': address };
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.text();
  const cookie = request.headers.get('cookie') ?? '';

  const upstream = await fetch(`${API}/auth/sign-in`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      /*
       * Forward the browser's cookies so the API sees its own `sq_device` and re-uses the seat that
       * device already holds. Without this, every sign-in looked like a new browser to the API.
       */
      ...(cookie === '' ? {} : { cookie }),
      ...forwardedFor(request),
    },
    body,
    cache: 'no-store',
  });

  const payload = (await upstream.json()) as ApiResult<unknown>;
  const response = NextResponse.json(payload, { status: upstream.status });

  // Only propagate cookies the API issued. Copying an absent header would clear a valid session on a
  // failed retry.
  const setCookie = upstream.headers.getSetCookie?.() ?? [];
  for (const raw of setCookie) {
    const [pair, ...attributes] = raw.split(';');
    const [name, ...valueParts] = (pair ?? '').split('=');
    const cookieName = name?.trim();
    if (cookieName === undefined || !FORWARDED_COOKIES.has(cookieName)) continue;

    const value = valueParts.join('=');
    const options: Parameters<typeof response.cookies.set>[2] = {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    };
    for (const attribute of attributes) {
      const [key, rawValue] = attribute.split('=');
      if (key?.trim().toLowerCase() === 'max-age') {
        const maxAge = Number(rawValue);
        if (Number.isFinite(maxAge)) options.maxAge = maxAge;
      }
    }
    response.cookies.set(cookieName, value ?? '', options);
  }

  return response;
}

export async function GET(request: Request): Promise<NextResponse> {
  return proxy(request, '/auth/session', 'GET');
}

/**
 * Sign out, optionally giving the seat back.
 *
 * The body is forwarded, because `{ releaseDevice: true }` is the difference between "sign out and
 * keep my seat for next time" and "sign out and let a colleague have it". The session cookie always
 * goes; the device cookie follows the API's own answer, so a sign-out that kept the seat cannot
 * orphan it.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  const body = await request.text();
  const cookie = request.headers.get('cookie') ?? '';

  const upstream = await fetch(`${API}/auth/sign-out`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(cookie === '' ? {} : { cookie }),
      ...forwardedFor(request),
    },
    body: body === '' ? '{}' : body,
    cache: 'no-store',
  });

  const payload = (await upstream.json()) as ApiResult<unknown>;
  const response = NextResponse.json(payload, { status: upstream.status });

  response.cookies.delete(SESSION_COOKIE);

  // The API answers with a device cookie only when it cleared one; mirror that exactly.
  for (const raw of upstream.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const [name, ...valueParts] = (pair ?? '').split('=');
    if (name?.trim() !== DEVICE_COOKIE) continue;
    if (valueParts.join('=') === '') response.cookies.delete(DEVICE_COOKIE);
  }
  return response;
}

/** Forward the incoming cookie to the API and return its answer unchanged. */
async function proxy(request: Request, path: string, method: string): Promise<NextResponse> {
  const cookie = request.headers.get('cookie') ?? '';

  const upstream = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(cookie === '' ? {} : { cookie }),
      ...forwardedFor(request),
    },
    cache: 'no-store',
  });

  const payload = (await upstream.json()) as ApiResult<unknown>;
  return NextResponse.json(payload, { status: upstream.status });
}
