'use client';

/**
 * Talking to the Guest address routes (plan G-a S3/S5): the Places proxy and the suburb list.
 *
 * ## The address-search session (P9)
 *
 * Each search is a signed, three-minute session the server hands out. It is asked for lazily, when
 * the guest types the third character — not on focus, so tabbing through the page costs nothing — and
 * it ends once a suggestion is picked (the server allows one `details` per session). A session also
 * ends after 12 suggestion calls or when it expires; the next keystroke then asks for a new one.
 *
 * ## Failures are values
 *
 * Every call returns a result, never throws (an aborted request does, as `AbortError`, so the caller
 * can ignore a search it superseded). `fallback: true` means "Places cannot help on this page now —
 * use the suburb list": switched off, the daily cap reached, rate-limited, Google failing.
 */

import type {
  GuestPlaceDetails,
  GuestPlaceDetailsResponse,
  GuestPlaceSuggestion,
  GuestPlaceSuggestionsResponse,
  GuestPlacesSession,
  GuestSuburb,
  GuestSuburbsResponse,
} from '@sq/contracts';
import { guestApi } from './api';

export type SearchResult<T> = { ok: true; data: T } | { ok: false; fallback: boolean; message: string };

/** Mirrors the server's per-session limit (P9); the 13th call would only be refused. */
const CALLS_PER_SESSION = 12;
/** Treat a session as expired a little early, so a slow request does not arrive just after. */
const EXPIRY_MARGIN_MS = 5_000;

const UNAVAILABLE = 'Address search is unavailable — type your suburb instead.';

interface Session {
  s: string;
  expiresAt: number;
  calls: number;
}

export interface PlacesClient {
  suggest(q: string, signal: AbortSignal): Promise<SearchResult<GuestPlaceSuggestion[]>>;
  details(placeId: string): Promise<SearchResult<GuestPlaceDetails | null>>;
}

export function createPlacesClient(): PlacesClient {
  let session: Session | null = null;
  let pending: Promise<SearchResult<Session>> | null = null;

  const fresh = (s: Session | null): s is Session =>
    s !== null && s.calls < CALLS_PER_SESSION && s.expiresAt - EXPIRY_MARGIN_MS > Date.now();

  /** The current session, or a new one. Concurrent callers share one request; it is never aborted. */
  async function current(): Promise<SearchResult<Session>> {
    if (fresh(session)) return { ok: true, data: session };
    if (pending === null) {
      pending = (async (): Promise<SearchResult<Session>> => {
        const result = await guestApi<GuestPlacesSession>('public/guest/places/session', { method: 'POST' });
        if (!result.ok) return { ok: false, fallback: true, message: UNAVAILABLE };
        const expiresAt = Date.parse(result.data.expiresAt);
        const next: Session = {
          s: result.data.s,
          expiresAt: Number.isNaN(expiresAt) ? Date.now() + 60_000 : expiresAt,
          calls: 0,
        };
        session = next;
        return { ok: true, data: next };
      })().finally(() => {
        pending = null;
      });
    }
    return pending;
  }

  async function suggest(q: string, signal: AbortSignal, retried = false): Promise<SearchResult<GuestPlaceSuggestion[]>> {
    const got = await current();
    if (!got.ok) return got;
    signal.throwIfAborted();
    const s = got.data;
    s.calls += 1;
    const query = new URLSearchParams({ q, s: s.s });
    const result = await guestApi<GuestPlaceSuggestionsResponse>(`public/guest/places/autocomplete?${query}`, { signal });
    if (result.ok) return { ok: true, data: result.data.suggestions };
    if (result.code === 'unauthorized' && !retried) {
      // Expired or used up on the server's clock: one more try on a new session.
      if (session === s) session = null;
      return suggest(q, signal, true);
    }
    if (result.code === 'validation_failed') return { ok: false, fallback: false, message: result.message };
    return { ok: false, fallback: true, message: UNAVAILABLE };
  }

  async function details(placeId: string): Promise<SearchResult<GuestPlaceDetails | null>> {
    const s = session;
    // A pick ends the session whatever the answer: the server allows one details call per session.
    session = null;
    if (s === null) return { ok: false, fallback: false, message: 'The address search expired. Start typing again.' };
    const query = new URLSearchParams({ id: placeId, s: s.s });
    const result = await guestApi<GuestPlaceDetailsResponse>(`public/guest/places/details?${query}`);
    if (result.ok) return { ok: true, data: result.data.details };
    if (result.code === 'unauthorized') return { ok: false, fallback: false, message: result.message };
    return { ok: false, fallback: true, message: UNAVAILABLE };
  }

  return { suggest: (q, signal) => suggest(q, signal), details };
}

/** The price book's suburb list (works with Places off). `fallback: true` here means "type it in". */
export async function searchSuburbs(q: string, signal: AbortSignal): Promise<SearchResult<GuestSuburb[]>> {
  const result = await guestApi<GuestSuburbsResponse>(`public/guest/suburbs?${new URLSearchParams({ q })}`, { signal });
  if (result.ok) return { ok: true, data: result.data.suburbs };
  if (result.code === 'validation_failed') return { ok: false, fallback: false, message: result.message };
  return {
    ok: false,
    fallback: true,
    message: 'The suburb list is not available right now — enter your suburb, state and postcode below.',
  };
}
