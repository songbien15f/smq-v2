/**
 * The vendor dashboard's data access — server-side only.
 *
 * ## Why a separate module from `api.ts`
 *
 * `serverFetch` forwards the **product's session cookie**, because every other screen answers a
 * question about a signed-in person. This page has no session: it authenticates with the vendor
 * password, which lives in this process's environment and must never travel to a browser. Folding
 * this into `serverFetch` would put a `x-vendor-key` branch in the function every other route uses,
 * one careless `console.log` away from printing the secret.
 *
 * So: one file that knows the secret, three functions, no exports the browser can reach.
 */

import { apiBaseUrl } from './api';

/** The password, or `null` when this deployment has none configured. */
export function vendorPassword(): string | null {
  const value = process.env.VENDOR_DASHBOARD_PASSWORD;
  return value === undefined || value.trim() === '' ? null : value;
}

/** One row of "how much of this happened". */
export interface UsageKindRow {
  kind: string;
  total: number;
  last7: number;
  last30: number;
  last90: number;
}

/** One row of "which screen was opened, and how often". */
export interface UsageRouteRow {
  route: string;
  total: number;
  last7: number;
  last30: number;
  last90: number;
}

/** One recent event. */
export interface RecentEvent {
  at: string;
  kind: string;
  tenantId: string | null;
  detail: string | null;
}

export interface VendorUsage {
  kinds: UsageKindRow[];
  routes: UsageRouteRow[];
  recent: RecentEvent[];
}

/**
 * Ask the API for the dashboard figures.
 *
 * Returns `null` on any failure rather than throwing: this page is read by one person, and a thrown
 * error would render a stack trace into a screen that is supposed to answer "is the product being
 * used". A `null` with a sentence on screen is the honest answer when the API is down.
 */
export async function loadVendorUsage(): Promise<VendorUsage | null> {
  const password = vendorPassword();
  if (password === null) return null;

  try {
    const response = await fetch(`${apiBaseUrl()}/vendor/usage`, {
      cache: 'no-store',
      headers: { accept: 'application/json', 'x-vendor-key': password },
    });
    if (!response.ok) return null;

    const body = (await response.json()) as
      | { ok: true; data: VendorUsage }
      | { ok: false; code: string; message: string };
    return body.ok ? body.data : null;
  } catch {
    return null;
  }
}
