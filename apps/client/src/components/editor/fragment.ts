/**
 * What a link into the editor carries, read from the URL **fragment**.
 *
 * A fragment is never sent to a server: a building is a customer's specification, and a customer's
 * name and address are theirs, so neither belongs in a proxy log or in the `Referer` of anything the
 * page later loads. The same channel serves two arrivals — a template link and a building converted
 * from a legacy `.sqd` file — which is why the building and the customer are read here rather than
 * fetched.
 *
 * Every failure answers `null`. A malformed link must produce the default shed, not a crash on the
 * one screen a salesperson opens in front of a customer.
 */

import { NEW_DRAFT } from '@/store/useDraftStore';
import type { DraftCustomer, DraftSite } from '@/store/useDraftStore';

/** A string field from an untrusted record, or the fallback. */
function text(source: Record<string, unknown>, key: string, fallback: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : fallback;
}

/** One fragment parameter, already decoded, or `null`. */
function fragmentValue(key: string): string | null {
  if (typeof window === 'undefined') return null;
  const match = new RegExp(`(?:^#|&)${key}=([^&]+)`).exec(window.location.hash);
  const raw = match?.[1];
  if (raw === undefined) return null;
  try {
    /*
     * `+` is a space. The sender builds the fragment with `URLSearchParams`, which writes
     * `application/x-www-form-urlencoded` — and `decodeURIComponent` alone leaves every `+` in place,
     * so an address reached the half-filled form as "222+Margaret+St". Caught by a test that put a
     * space in a field.
     */
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/** The building a template or an import link carried, or `null`. */
export function templateFromFragment(): unknown | null {
  const raw = fragmentValue('template');
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * The customer a legacy `.sqd` carried, when the editor was opened from one.
 *
 * Every field is copied **explicitly** rather than spread: the payload came from a file written by a
 * different application, and a key this build does not have must not end up in the draft. Anything
 * unreadable falls back to the blank draft, which is a form the operator can fill in — not an error
 * worth blocking on.
 */
export function customerFromFragment(): { customer: DraftCustomer; site: DraftSite } | null {
  const raw = fragmentValue('customer');
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const block = parsed as { customer?: unknown; site?: unknown };
  const from = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const source = from(block.customer);
  const place = from(block.site);
  const blank = NEW_DRAFT;

  return {
    customer: {
      firstName: text(source, 'firstName', blank.customer.firstName),
      lastName: text(source, 'lastName', blank.customer.lastName),
      email: text(source, 'email', blank.customer.email),
      phone: text(source, 'phone', blank.customer.phone),
      mobile: text(source, 'mobile', blank.customer.mobile),
      fax: blank.customer.fax,
      address: text(source, 'address', blank.customer.address),
      suburb: text(source, 'suburb', blank.customer.suburb),
      state: text(source, 'state', blank.customer.state),
      postcode: text(source, 'postcode', blank.customer.postcode),
    },
    site: {
      address: text(place, 'address', blank.site.address),
      suburb: text(place, 'suburb', blank.site.suburb),
      state: text(place, 'state', blank.site.state),
      postcode: text(place, 'postcode', blank.site.postcode),
      deliveryAddress: blank.site.deliveryAddress,
      deliveryScope: blank.site.deliveryScope,
      deliveryAcknowledged: blank.site.deliveryAcknowledged,
    },
  };
}
