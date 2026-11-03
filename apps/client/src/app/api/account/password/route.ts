/**
 * Password change bridge.
 *
 * Same pattern as `/api/session`: forward the cookie, return the answer. This route
 * exists rather than calling the API cross-origin so that every browser request in
 * this app is same-origin and the cookie policy is decided in one place.
 */

import { NextResponse } from 'next/server';
import type { ApiResult } from '@sq/contracts';

const API = process.env.API_BASE_URL ?? 'http://localhost:3060/api/v1';

export async function POST(request: Request): Promise<NextResponse> {
  const cookie = request.headers.get('cookie') ?? '';
  const body = await request.text();

  const upstream = await fetch(`${API}/auth/password`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(cookie === '' ? {} : { cookie }),
    },
    body,
    cache: 'no-store',
  });

  const payload = (await upstream.json()) as ApiResult<unknown>;
  return NextResponse.json(payload, { status: upstream.status });
}
