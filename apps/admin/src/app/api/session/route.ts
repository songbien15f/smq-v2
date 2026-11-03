/**
 * The session bridge.
 *
 * The browser only ever talks to this app. This route forwards sign-in, sign-out and
 * the session probe to the API and **re-issues the session cookie on this origin**.
 *
 * Why not call the API directly from the browser: the API is a different origin, so
 * every call would need `credentials: 'include'` plus a CORS allow-list, and a
 * misconfiguration of either looks like "the user is randomly signed out". One bridge
 * is one place to be right.
 *
 * The cookie is copied with `HttpOnly` preserved — the browser gets a cookie it cannot
 * read, which is the point.
 */

import { NextResponse } from 'next/server';
import type { ApiResult } from '@sq/contracts';

/** Where the API lives. Server-side only; never exposed to the browser. */
const API = process.env.API_BASE_URL ?? 'http://localhost:3060/api/v1';

const COOKIE = 'sq_session';

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.text();

  const upstream = await fetch(`${API}/auth/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body,
    cache: 'no-store',
  });

  const payload = (await upstream.json()) as ApiResult<unknown>;
  const response = NextResponse.json(payload, { status: upstream.status });

  // Only propagate a cookie when the API issued one. Copying an absent header would
  // clear a valid session on a failed retry.
  const setCookie = upstream.headers.getSetCookie?.() ?? [];
  for (const raw of setCookie) {
    const [pair, ...attributes] = raw.split(';');
    const [name, ...valueParts] = (pair ?? '').split('=');
    if (name?.trim() !== COOKIE) continue;

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
    response.cookies.set(COOKIE, value ?? '', options);
  }

  return response;
}

export async function GET(request: Request): Promise<NextResponse> {
  return proxy(request, '/auth/session', 'GET');
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const response = await proxy(request, '/auth/sign-out', 'POST');
  response.cookies.delete(COOKIE);
  return response;
}

/** Forward the incoming cookie to the API and return its answer unchanged. */
async function proxy(request: Request, path: string, method: string): Promise<NextResponse> {
  const cookie = request.headers.get('cookie') ?? '';

  const upstream = await fetch(`${API}${path}`, {
    method,
    headers: { accept: 'application/json', ...(cookie === '' ? {} : { cookie }) },
    cache: 'no-store',
  });

  const payload = (await upstream.json()) as ApiResult<unknown>;
  return NextResponse.json(payload, { status: upstream.status });
}
