import { NextResponse } from 'next/server';
import { VENDOR_COOKIE } from '@/lib/vendorAuth';

/**
 * Sign out of the dashboard: clear the cookie.
 *
 * Its own route rather than a link that forgets: the cookie is `HttpOnly`, so no page script can
 * remove it. Only a response from the server can, which is the property that makes it worth having
 * `HttpOnly` in the first place.
 */
export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: VENDOR_COOKIE, value: '', path: '/', maxAge: 0, httpOnly: true });
  return response;
}
