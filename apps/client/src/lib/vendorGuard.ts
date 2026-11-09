/**
 * The dashboard's guard, and its login/logout handlers.
 *
 * Server-only: it reads `next/headers` and answers with `Response` objects, which is what a route
 * handler needs and what a component must not do.
 *
 * ## Why the redirect is here and not in middleware
 *
 * `middleware.ts` runs before the route is known to exist and cannot read the environment the way a
 * server component can — on some hosts it is a different runtime entirely. A guard that only checked
 * "a cookie is present" would be a second mechanism for the same decision, and the two would drift.
 * So the check is one function, called at the top of every dashboard page, and it redirects.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { VENDOR_COOKIE, verifyDashboardCookie } from './vendorAuth';
import { vendorPassword } from './vendorUsage';

/** Whether this request carries a valid dashboard cookie right now. */
export async function hasVendorSession(): Promise<boolean> {
  const password = vendorPassword();
  if (password === null) return false;

  const store = await cookies();
  return verifyDashboardCookie(store.get(VENDOR_COOKIE)?.value, password);
}

/**
 * Redirect to the login page unless the request is signed in.
 *
 * A missing password redirects too, and the login page says so: "no password configured" is a state
 * a person can fix (set the variable), whereas an unexplained redirect loop is not.
 */
export async function requireVendorSession(): Promise<void> {
  if (!(await hasVendorSession())) redirect('/dashboard/login');
}
