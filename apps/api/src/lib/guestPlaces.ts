/**
 * Address suggestions for the public Guest quote page (plan G-a P8–P11).
 *
 * The operator's editor has its own Places routes (`routes/places.ts`), behind a sign-in and the
 * `quote:write` capability. The Guest page has no sign-in, and every call it makes spends money on
 * the vendor's Google project. So this module is the list of things that stand in for a sign-in.
 *
 * ## The guards, in the order a request meets them
 *
 * 1. **The switch** (`GUEST_PLACES_ENABLED`, off by default) and a configured key. Either missing →
 *    503 `not_configured`, and the page shows the price book's suburb list instead.
 * 2. **A signed session.** `POST /places/session` hands the page `uuid.expiresMs.hmac`, valid for
 *    three minutes. A forged, altered or expired one is 401. The UUID alone is Google's
 *    `sessionToken` — Google allows at most 36 characters, so the signed form cannot be sent.
 * 3. **The input** (P11): 3–100 characters, not all digits, not one character repeated. Under three
 *    characters is an empty answer, not an error: the guest is still typing.
 * 4. **Per-address limits** (P10), on the hashed IP: 10 sessions an hour, 60 autocompletes an hour
 *    and 200 a day, 20 details a day.
 * 5. **Per-session limits** (P9): 12 autocompletes and one details. Google bills a session that ends
 *    in an Essentials details call for its first 12 autocompletes only; the cap keeps a session
 *    inside that. After its details call a session is spent — Google bills a reused token per call.
 * 6. **System-wide daily caps**, from the environment. Reaching one answers 503 `not_configured`
 *    (the page falls back) and sends at most one warning mail per UTC day.
 *
 * Every counter is a `rate_limits` row through `consume`, so the limits hold across processes and
 * survive a restart. `pnpm ratelimits:prune` removes the expired rows.
 *
 * ## What is never kept
 *
 * Google's terms allow a place ID to be stored and nothing else from a response to be cached. This
 * module stores no response; the page sends back the parts the guest kept.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Db } from '@sq/db';
import { estimateWindRegion, type GuestWindRegion } from '@sq/core/domain';
import { AU_STATES, type GuestPlaceDetails, type GuestPlacesSession } from '@sq/contracts';
import type { GuestPlacesConfig } from '../config.js';
import type { ResolvedAddress } from './places.js';
import { consume } from './rateLimit.js';
import type { OutboundMail } from './mail/transport.js';
import type { TransactionalDeps } from './mail/transactional.js';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How long a session id is accepted. */
export const SESSION_TTL_MS = 3 * MINUTE_MS;

/** The limits of P9/P10, in one place so the route and the docs cannot disagree. */
export const GUEST_PLACES_LIMITS = {
  sessionsPerIpHour: 10,
  autocompletePerIpHour: 60,
  autocompletePerIpDay: 200,
  autocompletePerSession: 12,
  detailsPerIpDay: 20,
  detailsPerSession: 1,
} as const;

/** The most suggestions one answer carries. */
export const MAX_SUGGESTIONS = 5;

const MIN_INPUT = 3;
const MAX_INPUT = 100;

// ---------------------------------------------------------------- session ids

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** A new session: `uuid.expiresMs.signature`. */
export function issueSession(secret: string, nowMs: number = Date.now()): GuestPlacesSession {
  const id = randomUUID();
  const expiresMs = nowMs + SESSION_TTL_MS;
  const payload = `${id}.${expiresMs}`;
  return { s: `${payload}.${sign(secret, payload)}`, expiresAt: new Date(expiresMs).toISOString() };
}

const SESSION_SHAPE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{13})\.([A-Za-z0-9_-]{43})$/;

/**
 * The session's UUID when `s` is one this server signed and it has not expired; otherwise `null`.
 *
 * The signature is compared in constant time. Expiry is checked after the signature, so an expired
 * id says nothing about whether it was ever genuine.
 */
export function verifySession(secret: string, s: string | undefined, nowMs: number = Date.now()): string | null {
  if (s === undefined) return null;
  const match = SESSION_SHAPE.exec(s.trim());
  if (match === null) return null;
  const [, id, expires, signature] = match as unknown as [string, string, string, string];

  const expected = Buffer.from(sign(secret, `${id}.${expires}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  return Number(expires) > nowMs ? id : null;
}

// ---------------------------------------------------------------- input

export type QueryCheck =
  | { kind: 'ok'; query: string }
  /** Too short to be worth a paid call. The answer is an empty list. */
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string };

/**
 * P11. A string of digits or one repeated character is not an address anyone is typing — it is a
 * script measuring the endpoint, and each one would be a billed call.
 */
export function checkQuery(raw: string | undefined): QueryCheck {
  const query = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (query.length < MIN_INPUT) return { kind: 'empty' };
  if (query.length > MAX_INPUT) return { kind: 'invalid', message: `Type at most ${MAX_INPUT} characters.` };
  if (/^[\d\s]+$/.test(query)) {
    return { kind: 'invalid', message: 'Add the street or suburb name, not just numbers.' };
  }
  if (new Set(query.replace(/\s/g, '').toLowerCase()).size === 1) {
    return { kind: 'invalid', message: 'That does not look like an address.' };
  }
  return { kind: 'ok', query };
}

/** A Places id is base64url-ish and short; anything else never came from an autocomplete answer. */
export function checkPlaceId(raw: string | undefined): string | null {
  const id = (raw ?? '').trim();
  return /^[A-Za-z0-9_-]{10,300}$/.test(id) ? id : null;
}

// ---------------------------------------------------------------- limits

/** `YYYY-MM-DD` in UTC, and the milliseconds left in that day. */
function utcDay(nowMs: number): { day: string; msLeft: number } {
  const date = new Date(nowMs);
  const day = date.toISOString().slice(0, 10);
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return { day, msLeft: Math.max(1000, midnight - nowMs) };
}

/** Why a call may not go to Google. */
export type Refusal =
  | { code: 'rate_limited'; message: string }
  /** A system-wide cap: the page falls back, and the operator hears about it. */
  | { code: 'not_configured'; message: string; cap: { kind: 'autocomplete' | 'details'; limit: number } }
  | { code: 'unauthorized'; message: string };

const TOO_MANY = 'That is a lot of address lookups from one place. Type your suburb instead, or try again later.';
const SESSION_SPENT = 'That address search has finished. Start typing again for new suggestions.';
const RESTING = 'Address suggestions are resting for today. Pick your suburb from the list instead.';

export async function allowSession(db: Db, ipHash: string): Promise<Refusal | null> {
  const limit = await consume(db, `gplaces:session:ip:${ipHash}`, GUEST_PLACES_LIMITS.sessionsPerIpHour, HOUR_MS);
  return limit.allowed ? null : { code: 'rate_limited', message: TOO_MANY };
}

/** True when this session's details call has been made — Google bills a reused token per call. */
async function sessionSpent(db: Db, sessionId: string, nowMs: number): Promise<boolean> {
  const row = await db.get<{ count: number | string; window_end: string }>(
    'SELECT count, window_end FROM rate_limits WHERE key = ?',
    [`gplaces:det:s:${sessionId}`],
  );
  return row !== null && Number(row.count) > 0 && Date.parse(row.window_end) > nowMs;
}

export async function allowAutocomplete(
  db: Db,
  config: GuestPlacesConfig,
  ipHash: string,
  sessionId: string,
  nowMs: number = Date.now(),
): Promise<Refusal | null> {
  if (await sessionSpent(db, sessionId, nowMs)) return { code: 'unauthorized', message: SESSION_SPENT };

  const L = GUEST_PLACES_LIMITS;
  if (!(await consume(db, `gplaces:ac:ip:${ipHash}`, L.autocompletePerIpHour, HOUR_MS)).allowed) {
    return { code: 'rate_limited', message: TOO_MANY };
  }
  if (!(await consume(db, `gplaces:ac:ipday:${ipHash}`, L.autocompletePerIpDay, DAY_MS)).allowed) {
    return { code: 'rate_limited', message: TOO_MANY };
  }
  if (!(await consume(db, `gplaces:ac:s:${sessionId}`, L.autocompletePerSession, SESSION_TTL_MS)).allowed) {
    return {
      code: 'rate_limited',
      message: 'That is a lot of suggestions for one address. Pick one, or type your suburb instead.',
    };
  }
  const { day, msLeft } = utcDay(nowMs);
  if (!(await consume(db, `gplaces:ac:day:${day}`, config.dailyAutocompleteCap, msLeft)).allowed) {
    return { code: 'not_configured', message: RESTING, cap: { kind: 'autocomplete', limit: config.dailyAutocompleteCap } };
  }
  return null;
}

export async function allowDetails(
  db: Db,
  config: GuestPlacesConfig,
  ipHash: string,
  sessionId: string,
  nowMs: number = Date.now(),
): Promise<Refusal | null> {
  const L = GUEST_PLACES_LIMITS;
  if (!(await consume(db, `gplaces:det:ip:${ipHash}`, L.detailsPerIpDay, DAY_MS)).allowed) {
    return { code: 'rate_limited', message: TOO_MANY };
  }
  // The window outlives the session, so `sessionSpent` still sees it until the id has expired anyway.
  if (!(await consume(db, `gplaces:det:s:${sessionId}`, L.detailsPerSession, SESSION_TTL_MS + MINUTE_MS)).allowed) {
    return { code: 'unauthorized', message: SESSION_SPENT };
  }
  const { day, msLeft } = utcDay(nowMs);
  if (!(await consume(db, `gplaces:det:day:${day}`, config.dailyDetailsCap, msLeft)).allowed) {
    return { code: 'not_configured', message: RESTING, cap: { kind: 'details', limit: config.dailyDetailsCap } };
  }
  return null;
}

// ---------------------------------------------------------------- the answer

/**
 * Google's resolved address → the fields the Guest page fills, or `null` when it is not a usable
 * Australian site (no suburb, no four-digit postcode, or a state code outside the eight). `null`
 * means "type it yourself", which is better than a half-filled form that fails at Send.
 *
 * The wind region is **derived from the coordinates and then thrown away**: the coordinates
 * themselves are not part of the answer (Google's policy allows storing the place ID only), so the
 * browser receives a letter and no location.
 */
export function toGuestPlaceDetails(
  placeId: string,
  address: ResolvedAddress | null,
  estimateRegion: (lat: number, lng: number) => GuestWindRegion | null = estimateWindRegion,
): GuestPlaceDetails | null {
  if (address === null) return null;
  const state = AU_STATES.find((code) => code === address.state.toUpperCase());
  if (state === undefined || address.suburb === '' || !/^\d{4}$/.test(address.postcode)) return null;
  const windRegion =
    address.lat !== undefined && address.lng !== undefined ? estimateRegion(address.lat, address.lng) : null;
  return {
    placeId,
    ...(address.street === '' ? {} : { street: address.street }),
    suburb: address.suburb,
    state,
    postcode: address.postcode,
    windRegion,
  };
}

// ---------------------------------------------------------------- the cap warning

export function capWarningMail(
  deps: TransactionalDeps,
  to: string,
  cap: { kind: 'autocomplete' | 'details'; limit: number },
  day: string,
): OutboundMail {
  const from = deps.from.trim();
  if (from === '') throw new Error('Mail is not configured: there is no From address to send as.');
  const setting = cap.kind === 'autocomplete' ? 'GUEST_PLACES_DAILY_AUTOCOMPLETE_CAP' : 'GUEST_PLACES_DAILY_DETAILS_CAP';
  return {
    from,
    replyTo: from,
    to,
    subject: `Guest page address suggestions reached today's cap (${day})`,
    text:
      `The Guest quote page sent Google its ${cap.limit} ${cap.kind} calls for ${day} (UTC).\n\n` +
      `Until midnight UTC the page offers the suburb list instead of address suggestions; guests can ` +
      `still send requests.\n\n` +
      `If this is real traffic, raise ${setting}. If it is not, the per-address limits are being ` +
      `spread across many addresses — set GUEST_PLACES_ENABLED=0 until it stops.\n\n` +
      `This message is sent at most once a day.\n`,
    messageId: `guest-places-cap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

/**
 * Send the cap warning, at most once per UTC day across every process. Never throws: a guest's
 * fallback answer must not wait on, or fail because of, mail.
 */
export async function warnCapReached(
  db: Db,
  mail: TransactionalDeps | null,
  recipients: () => Promise<string[]>,
  cap: { kind: 'autocomplete' | 'details'; limit: number },
  onResult: (result: { sent: number; failed: number; skipped?: string }) => void,
  nowMs: number = Date.now(),
): Promise<void> {
  try {
    const { day, msLeft } = utcDay(nowMs);
    const once = await consume(db, `gplaces:capmail:${day}`, 1, msLeft);
    if (!once.allowed) return;
    if (mail === null) {
      onResult({ sent: 0, failed: 0, skipped: 'mail is not configured' });
      return;
    }
    const to = await recipients();
    let sent = 0;
    let failed = 0;
    for (const address of to) {
      try {
        await mail.transport.send(capWarningMail(mail, address, cap, day));
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    onResult({ sent, failed });
  } catch (error) {
    onResult({ sent: 0, failed: 0, skipped: error instanceof Error ? error.message : String(error) });
  }
}
