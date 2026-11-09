/**
 * The vendor dashboard's own door: one password, one signed cookie, no session.
 *
 * ## Why not the product's session
 *
 * `/dashboard` is the **operator's** page — the person who runs the product, checking whether anybody
 * is using it. He may not be a member of any company, and giving him a user row plus a role so he can
 * see a page would put him in a list of people a customer can administer. A separate door keeps the
 * two models apart: the product's session answers "which company is this person working in", and this
 * answers "is this the operator".
 *
 * ## Why the password is the signing key
 *
 * The cookie holds an expiry and an HMAC of it. Deriving that HMAC key from the password — by
 * `scrypt`, so the derivation is slow to brute-force — buys one property for free: **changing the
 * password invalidates every cookie already issued.** There is no second secret to rotate, and no
 * way for an old cookie to outlive the password it was issued under.
 *
 * ## Why the comparison is not here
 *
 * This module reaches a browser — it reads `next/headers` and `Response` objects — so it must not be
 * the thing that decides whether a password is right. The check happens in the route handler
 * (`/api/vendor/login`), which runs on the server, compares in constant time, and then calls
 * `issueDashboardCookie` here. A comparison in this file would be a comparison in a bundle.
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** The cookie this dashboard issues. Named apart from the product's session on purpose. */
export const VENDOR_COOKIE = 'sq_vendor';

/** How long a dashboard login lasts. One day: long enough to check twice, short enough to forget. */
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The signing key for a password, via `scrypt`.
 *
 * A slow derivation, so a stolen cookie cannot be turned back into a password by guessing — and so
 * that two different passwords never produce the same key by accident. The salt is fixed and public:
 * it does not need to be secret, because the input (the password) already is, and a per-cookie salt
 * would mean storing one more thing to look up.
 */
function signingKey(password: string): Buffer {
  return scryptSync(password, 'smartquote-vendor-dashboard', 32);
}

/** `expiry.signature`, both hex. */
export function issueDashboardCookie(password: string, now: number = Date.now()): string {
  const expires = String(now + TTL_MS);
  const signature = createHmac('sha256', signingKey(password)).update(expires).digest('hex');
  return `${expires}.${signature}`;
}

/**
 * True when the cookie was signed by **this** password and has not expired.
 *
 * Both halves matter and the order matters: an expired cookie is refused before its signature is
 * checked, because an expired one is not a forgery and there is no reason to spend the HMAC on it.
 */
export function verifyDashboardCookie(
  token: string | undefined,
  password: string,
  now: number = Date.now(),
): boolean {
  if (token === undefined || token === '') return false;
  const [expires, signature] = token.split('.');
  if (expires === undefined || signature === undefined) return false;

  const expiresAt = Number(expires);
  if (!Number.isInteger(expiresAt) || expiresAt <= now) return false;

  const expected = createHmac('sha256', signingKey(password)).update(expires).digest('hex');
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  // A malformed signature decodes to a different length, and `timingSafeEqual` throws on that rather
  // than answering false — so the lengths are compared first and a mismatch is simply not a match.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** A nonce for a form, so a login POST cannot be replayed from another page. */
export function loginNonce(): string {
  return randomBytes(16).toString('hex');
}
