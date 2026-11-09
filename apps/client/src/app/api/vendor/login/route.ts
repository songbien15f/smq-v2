import { NextResponse } from 'next/server';
import { timingSafeEqual, createHash } from 'node:crypto';
import { VENDOR_COOKIE, issueDashboardCookie } from '@/lib/vendorAuth';
import { vendorPassword } from '@/lib/vendorUsage';

/**
 * The dashboard's login: a password in, a signed cookie out.
 *
 * ## Why the comparison is here and not in `vendorAuth.ts`
 *
 * That module is imported by a server component, which means it is reachable from anything the Next
 * compiler decides to bundle. A `timingSafeEqual` call against the password belongs in a **route
 * handler** — the only place that sees the submitted value — and the helper there only signs.
 *
 * ## Why the cookie is HttpOnly and SameSite=Strict
 *
 * It is a session for one person on one machine. `HttpOnly` means an injected script cannot read it;
 * `Strict` means no other site can cause a request that carries it, so a login CSRF has nothing to
 * steal. `secure` is set only when serving over HTTPS, because a `secure` cookie on plain HTTP is
 * silently dropped and the login would appear to do nothing.
 *
 * ## Why a wrong password is not distinguished from a missing one
 *
 * Both answer the same sentence. "That password is wrong" confirms the password is the right *kind*
 * of secret and lets somebody measure their guessing; the dashboard is one page behind one password,
 * so the honest thing is to say as little as possible.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const expected = vendorPassword();
  if (expected === null) {
    return NextResponse.json(
      {
        ok: false,
        message:
          'This deployment has no dashboard password set (VENDOR_DASHBOARD_PASSWORD), so the dashboard is closed.',
      },
      { status: 503 },
    );
  }

  let submitted = '';
  try {
    const body = (await request.json()) as { password?: unknown };
    submitted = typeof body.password === 'string' ? body.password : '';
  } catch {
    submitted = '';
  }

  /*
   * Hashed on both sides before comparing. `timingSafeEqual` throws when the lengths differ, so a
   * direct comparison either throws on a wrong-length guess or needs an early length check — and that
   * early return is the timing signal the constant-time comparison is supposed to remove.
   */
  const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();
  if (submitted === '' || !timingSafeEqual(digest(submitted), digest(expected))) {
    return NextResponse.json(
      { ok: false, message: 'That password is not right.' },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: VENDOR_COOKIE,
    value: issueDashboardCookie(expected),
    httpOnly: true,
    sameSite: 'strict',
    secure: new URL(request.url).protocol === 'https:',
    path: '/',
    maxAge: 24 * 60 * 60,
  });
  return response;
}
