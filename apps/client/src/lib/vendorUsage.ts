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

/**
 * One distinct visitor, identified by the first eight characters of the salted digest of its address.
 *
 * **Not an address**, and it cannot be turned into one: the digest is salted with `SESSION_SECRET`
 * and the salt is not in this table. Eight characters are enough to tell two visitors apart and to
 * follow one across the activity log, which is all the count needs.
 */
export interface VisitorRow {
  visitor: string;
  firstSeen: string;
  lastSeen: string;
  /** Everything this visitor did, of every kind. */
  events: number;
  /** Page views only — the cheapest measure of "how much did they look at". */
  screens: number;
  /** The people it was signed in as. More than one means a shared machine. */
  actors: string[];
  /** How many companies' data it touched. */
  tenants: number;
}

/** One line of the activity log. */
export interface ActivityRow {
  at: string;
  kind: string;
  visitor: string | null;
  actor: string | null;
  tenant: string | null;
  route: string | null;
  quoteNumber: string | null;
  mode: string | null;
  revision: number | null;
}

/** One action inside a visit, for the expanded history. */
export interface VisitEvent {
  at: string;
  kind: string;
  /** Already in words: "Opened", "Saved a revision". */
  action: string;
  /** The route, the quote number, or the send mode. */
  detail: string | null;
}

/**
 * One visit — a session, from its first recorded action to its last.
 *
 * `durationMs` is a **floor, not a duration**: it spans the first and last recorded event, so a
 * person who opened one screen and read it for ten minutes shows zero unless something happened
 * after. The column is labelled "active for" for that reason.
 */
export interface VisitRow {
  sessionId: string;
  startedAt: string;
  lastAt: string;
  durationMs: number;
  actions: number;
  /** `203.0.113.xx` — enough to recognise a network, not a person. */
  ipMasked: string | null;
  /** The full address, shown only when somebody clicks. `null` when it cannot be decrypted. */
  ipFull: string | null;
  actors: string[];
  tenant: string | null;
  events: VisitEvent[];
}

export interface VendorUsage {
  kinds: UsageKindRow[];
  routes: UsageRouteRow[];
  visitors: VisitorRow[];
  visits: VisitRow[];
  activity: ActivityRow[];
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
