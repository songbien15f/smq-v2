/**
 * The Guest quote page's public routes (plan G-a S2, S3).
 *
 * - `GET  /public/guest/building-types`        — the cards on tab ①.
 * - `POST /public/guest-requests`              — tab ④ "Send request".
 * - `POST /public/guest/places/session`        — a signed, three-minute address-search session.
 * - `GET  /public/guest/places/autocomplete`   — `?q=&s=`, at most five suggestions.
 * - `GET  /public/guest/places/details`        — `?id=&s=`, the picked suggestion's fields.
 * - `GET  /public/guest/suburbs`               — `?q=`, the price book's suburb list (the fallback).
 *
 * Spec: docs/specs/quote-tiers-guest.md. Every route is unauthenticated: a guest has no account.
 * The Places routes' guards are described in `lib/guestPlaces.ts`.
 *
 * ## What stands in for authentication on the POST
 *
 * The same three guards as the enquiry form (`enquiries.ts`), tuned for a lead that carries a design:
 *
 * - **Rate limits:** 5 per hour per address, consumed before the body is parsed, then 3 per day per
 *   normalised email (plan P12).
 * - **A honeypot** (`website`): a filled value is answered with the same 202 and a number of the
 *   same shape, and nothing is stored.
 * - **The core decides validity:** the body's shape is checked by zod, then the design is checked
 *   against the building type by `validateGuestDesign` — the same function the page calls (A13).
 *
 * ## Never a price
 *
 * No route answers a price. The suburb route reads the price book's `country_surburb` table and
 * nothing else from it; the answer to a request is its number (D-T3).
 */

import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';
import {
  GUEST_DEFAULT_TYPES,
  estimateWindRegion,
  guestReviewFlags,
  guestSiteEstimate,
  validateGuestDesign,
  type GuestBuildingTypeSpec,
  type GuestWindRegion,
} from '@sq/core/domain';
import {
  fail,
  guestAssistantTranscribeRequest,
  guestAssistantTurnRequest,
  guestBuildingTypeSchema,
  guestRequestBody,
  normaliseAuMobile,
  type GuestAssistantTranscribeResponse,
  type GuestBuildingTypesResponse,
  type GuestRequestAccepted,
} from '@sq/contracts';
import type {
  GuestPlaceDetailsResponse,
  GuestPlaceSuggestionsResponse,
  GuestSuburb,
  GuestSuburbsResponse,
} from '@sq/contracts';
import type { GuestPlacesConfig } from '../config.js';
import { clientIp, parseBody, sendFail, sendOk } from '../lib/http.js';
import { guestAccountFromRequest } from '../lib/guestAccount.js';
import {
  createGooglePlacesTransport,
  placesConfigured,
  withTimeout,
  type PlacesTransport,
} from '../lib/places.js';
import {
  MAX_SUGGESTIONS,
  allowAutocomplete,
  allowDetails,
  allowSession,
  checkPlaceId,
  checkQuery,
  issueSession,
  toGuestPlaceDetails,
  verifySession,
  warnCapReached,
  type Refusal,
} from '../lib/guestPlaces.js';
import { BookMissingError, activeBookHash, ensureBookOnDisk, openBookDatabase } from '../lib/priceBook.js';
import { consume } from '../lib/rateLimit.js';
import { hashIp } from '../lib/tokens.js';
import type { TransactionalDeps } from '../lib/mail/transactional.js';
import { trackEnquiryNotification } from '../lib/mail/enquiryMail.js';
import { guestNotifyRecipients, sendGuestRequestMail } from '../lib/mail/guestMail.js';
import {
  ASSISTANT_COOKIE,
  ASSISTANT_COOKIE_MAX_AGE,
  ASSISTANT_LIMITS,
  assistantEnabled,
  fullTranscript,
  hashAssistantToken,
  liveSessionId,
  redact,
  resolveAssistantSession,
  runAssistantTurn,
} from '../lib/guestAssistant.js';
import { repairTranscript, resolveAiConfig, transcribe } from '../lib/ai/index.js';
import { isShedTopic, normaliseShedTranscript, numberWarnings, shedRepairPrompt, shedSttPrompt } from '../lib/guestVoice.js';
import { upgradeGuestDesign } from '@sq/core/domain';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const IP_LIMIT = 5;
const EMAIL_LIMIT = 3;
/** Suburb lookups are local and free, but the list is still not something to hand a scraper. */
const SUBURB_IP_LIMIT = 300;
const SUBURB_MAX = 10;
/** How long a Places call may take before the page gives up and shows the suburb list. */
const PLACES_TIMEOUT_MS = 4000;

/** What the Places routes need besides the database. */
export interface GuestPlacesDeps {
  config: GuestPlacesConfig;
  /**
   * The Google transport, or `null` when no key is set. Defaults to `GOOGLE_PLACES_API_KEY`, read per
   * request like the editor's routes; a test passes a fake so no call leaves the machine.
   */
  transport?: () => PlacesTransport | null;
}

function envTransport(): PlacesTransport | null {
  if (!placesConfigured()) return null;
  return createGooglePlacesTransport((process.env.GOOGLE_PLACES_API_KEY as string).trim());
}

/** `'800'` → `'0800'`: the price book lost the leading zero of NT and ACT postcodes. */
function postcode(raw: string | number): string {
  return String(raw).trim().padStart(4, '0');
}

/**
 * The request number's prefix, from `GUEST_REQUEST_PREFIX` (default `GR-`).
 *
 * Read per request so a test can change it. Anything outside a short run of capitals, digits and
 * dashes falls back to the default: the number is printed in mail subjects and read out on the phone.
 */
function requestPrefix(): string {
  const raw = (process.env.GUEST_REQUEST_PREFIX ?? '').trim();
  return /^[A-Z0-9-]{1,8}$/.test(raw) ? raw : 'GR-';
}

function formatNumber(n: number | string): string {
  return `${requestPrefix()}${String(n).padStart(6, '0')}`;
}

interface BuildingTypeRow {
  id: string;
  name: string;
  description: string;
  config_json: string;
  version: number;
  sort_order: number;
}

/**
 * The building types a guest may pick: the enabled rows, or the core defaults when the table has
 * no row at all (plan P3). A table whose rows are all disabled answers an empty list — a super admin
 * who switched every type off meant it.
 *
 * A row that no longer parses (a schema tightened after it was saved) is skipped and logged rather
 * than failing the whole page.
 */
async function loadBuildingTypes(db: Db, log: FastifyBaseLogger): Promise<GuestBuildingTypeSpec[]> {
  const total = await db.get<{ n: number | string }>('SELECT COUNT(*) AS n FROM guest_building_types');
  if (Number(total?.n ?? 0) === 0) return [...GUEST_DEFAULT_TYPES];

  const rows = await db.all<BuildingTypeRow>(
    `SELECT id, name, description, config_json, version, sort_order
       FROM guest_building_types
      WHERE enabled = 1
      ORDER BY sort_order, name`,
  );
  const types: GuestBuildingTypeSpec[] = [];
  for (const row of rows) {
    let config: unknown;
    try {
      config = JSON.parse(row.config_json);
    } catch {
      log.warn({ guestBuildingType: row.id }, 'guest building type has unreadable config_json; skipped');
      continue;
    }
    const parsed = guestBuildingTypeSchema.safeParse({
      id: row.id,
      name: row.name,
      description: row.description,
      version: Number(row.version),
      sortOrder: Number(row.sort_order),
      config,
    });
    if (parsed.success) types.push(parsed.data);
    else log.warn({ guestBuildingType: row.id }, 'guest building type no longer validates; skipped');
  }
  return types;
}

async function adminEmails(db: Db): Promise<string[]> {
  try {
    const rows = await db.all<{ email: string }>(
      `SELECT email FROM users
        WHERE platform_role IS NOT NULL AND disabled_at IS NULL
ORDER BY created_at, email`,
    );
    return rows.map((row) => row.email);
  } catch {
    return [];
  }
}

/**
 * The customer's free-text request, under either of its names.
 *
 * `additionalRequest` is what the page sends now (asked at step ①, Q2). `notes` is the v1 name,
 * accepted for one release so a page cached mid-deploy still lands; both write the same column and
 * an empty string in both means "nothing typed".
 */
function additionalRequestText(body: { additionalRequest?: string; notes?: string }): string | null {
  const text = (body.additionalRequest ?? body.notes ?? '').trim();
  return text === '' ? null : text;
}

export function registerGuest(
  app: FastifyInstance,
  db: Db,
  /** Mail, or `null` on a server without it: the request is still stored and still a lead. */
  mail: TransactionalDeps | null = null,
  /** The Places proxy's settings, or `null`: its routes then answer 503 and the page falls back. */
  places: GuestPlacesDeps | null = null,
): void {
  const recipients = async (): Promise<string[]> =>
    guestNotifyRecipients({
      guestNotifyTo: process.env.GUEST_NOTIFY_TO ?? '',
      enquiryTo: process.env.ENQUIRY_TO ?? '',
      adminEmails: await adminEmails(db),
    });

  /** The transport when the switch is on and a key is set; otherwise `null` (the page falls back). */
  const placesTransport = (): PlacesTransport | null => {
    if (places === null || !places.config.enabled) return null;
    return (places.transport ?? envTransport)();
  };

  /**
   * The wind region for a place, recomputed at send time (plan §3.3).
   *
   * This asks Google again rather than believing the page, because the stored estimate is a
   * **record**: the page's region is browser state, editable, and stale the moment the guest changes
   * the address after the line was drawn. The cost is one Place Details call per accepted request,
   * already bounded by the 5-per-hour address limit; the alternative — a signed region inside the
   * search session — would need a token that outlives the three-minute session and would still let a
   * crafted token name a region the address does not have.
   *
   * Every failure answers `null`. A lead is never refused because an estimate could not be made.
   */
  const windRegionFor = async (placeId: string | undefined, log: FastifyBaseLogger): Promise<GuestWindRegion | null> => {
    if (placeId === undefined || placeId === '') return null;
    const transport = placesTransport();
    if (transport === null) return null;
    try {
      const address = await withTimeout(transport.details(placeId), PLACES_TIMEOUT_MS);
      if (address === null || address.lat === undefined || address.lng === undefined) return null;
      return estimateWindRegion(address.lat, address.lng);
    } catch (error) {
      log.warn({ err: error }, 'guest wind region: the address could not be resolved; storing no estimate');
      return null;
    }
  };

  app.get('/public/guest/building-types', async (request, reply) => {
    const types = await loadBuildingTypes(db, request.log);
    const data: GuestBuildingTypesResponse = { types };
    return sendOk(reply, data);
  });

  app.post('/public/guest-requests', async (request, reply) => {
    const ip = hashIp(clientIp(request));

    const ipLimit = await consume(db, `guest-request:ip:${ip}`, IP_LIMIT, HOUR_MS);
    if (!ipLimit.allowed) {
      return sendFail(reply, 'rate_limited', 'That is a lot of requests from one place. Please wait a little and try again.');
    }

    const body = parseBody(guestRequestBody, request.body, reply);
    if (body === null) return;

    // Honeypot: the same answer as a real request, so a script learns nothing.
    if (body.website !== undefined && body.website.trim() !== '') {
      const fake: GuestRequestAccepted = { number: formatNumber(100000 + Math.floor(Math.random() * 900000)) };
      return sendOk(reply, fake, 202);
    }

    const emailNorm = body.contact.email.trim().toLowerCase();
    const emailLimit = await consume(db, `guest-request:email:${emailNorm}`, EMAIL_LIMIT, 24 * HOUR_MS);
    if (!emailLimit.allowed) {
      return sendFail(
        reply,
        'rate_limited',
        'We already have several requests from this email today. We will be in touch — or reply to our confirmation email.',
      );
    }

    const types = await loadBuildingTypes(db, request.log);
    const type = types.find((t) => t.id === body.design.typeId);
    if (type === undefined) {
      return sendFail(reply, 'validation_failed', 'That building type is no longer offered. Please pick one again.', [
        { path: 'design.typeId', message: 'This building type is not available' },
      ]);
    }

    const issues = validateGuestDesign(body.design, type);
    if (issues.length > 0) {
      return sendFail(
        reply,
        'validation_failed',
        'The design needs attention.',
        issues.map((issue) => ({ path: `design.${issue.path}`, message: issue.message })),
      );
    }

    /*
     * The estimate and the flags are **recomputed here**, never taken from the browser (plan §3.3).
     * A page that showed "Region B" an hour ago, before the guest changed the address, cannot leave
     * that claim on the record — and a design edited after the line was drawn cannot leave the two
     * disagreeing. `windRegionFor` answers `null` when it cannot place the address; that is the
     * honest answer and it is what the page says too.
     */
    const region = await windRegionFor(body.design.site.placeId, request.log);
    const estimate = guestSiteEstimate({ region, enclosure: type.config.enclosure, mode: type.config.mode });
    const flags = guestReviewFlags(body.design, type);

    // The schema's refine already proved this parses; the fallback keeps the type honest.
    const mobile = normaliseAuMobile(body.contact.mobile) ?? body.contact.mobile;
    const at = now();

    /*
     * The conversation the guest had with the assistant, **copied** onto the lead (plan G-g).
     *
     * Copied rather than linked because the session is pruned 30 days after it expires and a lead can
     * be quoted months later; `assistant_session_id` is kept as a trace of where it came from, and
     * `pnpm assistant:prune` nulls it when the session goes. A guest who never opened the assistant
     * has no session, and both columns stay NULL.
     */
    const assistantSessionId = await liveSessionId(db, request.cookies[ASSISTANT_COOKIE]);
    const transcript = assistantSessionId === null ? [] : await fullTranscript(db, assistantSessionId);

    // Signed in (optional): the request joins the account's list, and the draft it came from goes.
    const guestAccount = await guestAccountFromRequest(db, request);
    const accountId = guestAccount === null ? null : guestAccount.account.id;

    const stored = await db.transaction(async (tx) => {
      /*
       * One profile per email. While the email is unverified, the latest request's name and mobile
       * win; once verified, the profile is the guest's own and a request typed by anyone who knows
       * the address must not overwrite it. What was typed is kept verbatim in contact_json.
       */
      const contact = await tx.get<{ id: string; email_verified_at: string | null }>(
        `INSERT INTO guest_contacts (id, email_norm, first_name, last_name, mobile, email_verified_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT (email_norm) DO UPDATE SET
           first_name = CASE WHEN guest_contacts.email_verified_at IS NULL THEN excluded.first_name ELSE guest_contacts.first_name END,
           last_name  = CASE WHEN guest_contacts.email_verified_at IS NULL THEN excluded.last_name  ELSE guest_contacts.last_name  END,
           mobile     = CASE WHEN guest_contacts.email_verified_at IS NULL THEN excluded.mobile     ELSE guest_contacts.mobile     END,
           updated_at = excluded.updated_at
         RETURNING id, email_verified_at`,
        [newId(), emailNorm, body.contact.firstName, body.contact.lastName, mobile, at, at],
      );
      if (contact === null) throw new Error('guest contact upsert returned no row');

      const seq = await tx.get<{ n: number | string }>(`SELECT nextval('guest_request_seq') AS n`);
      if (seq === null) throw new Error('guest_request_seq returned no value');
      const number = formatNumber(seq.n);

      await tx.run(
        `INSERT INTO guest_requests
           (id, number, contact_id, contact_json, design_json, notes, place_id, source_json,
            site_estimate_json, review_flags, assistant_session_id, assistant_transcript_json,
            status, ip_hash, account_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`,
        [
          newId(),
          number,
          contact.id,
          JSON.stringify({ ...body.contact, mobile }),
          JSON.stringify(body.design),
          // `additionalRequest` is the current name; `notes` is the one-release alias for it.
          additionalRequestText(body) ?? null,
          body.design.site.placeId ?? null,
          body.source === undefined ? null : JSON.stringify(body.source),
          estimate === null ? null : JSON.stringify(estimate),
          flags.length === 0 ? null : JSON.stringify(flags),
          assistantSessionId,
          transcript.length === 0 ? null : JSON.stringify(transcript),
          ip,
          accountId,
          at,
          at,
        ],
      );
      if (accountId !== null && body.draftId !== undefined) {
        await tx.run('DELETE FROM guest_drafts WHERE id = ? AND account_id = ?', [body.draftId, accountId]);
      }
      return { number, emailVerified: contact.email_verified_at !== null };
    });

    if (mail !== null) {
      const recipients = guestNotifyRecipients({
        guestNotifyTo: process.env.GUEST_NOTIFY_TO ?? '',
        enquiryTo: process.env.ENQUIRY_TO ?? '',
        adminEmails: await adminEmails(db),
      });
      trackEnquiryNotification(
        sendGuestRequestMail(
          mail,
          {
            number: stored.number,
            body,
            type,
            mobile,
            emailVerified: stored.emailVerified,
            estimate,
            reviewFlags: flags,
            transcript,
          },
          recipients,
          (result) => {
            request.log.info(
              {
                guestRequest: stored.number,
                kind: result.kind,
                sent: result.ok,
                ...(result.reason === undefined ? {} : { reason: result.reason }),
              },
              'guest request mail',
            );
          },
        ),
      );
    } else {
      // Without mail the request is still stored; say so, or a missing email looks like a lost lead.
      request.log.info({ guestRequest: stored.number }, 'guest request mail skipped: mail is not configured');
    }

    const data: GuestRequestAccepted = { number: stored.number };
    return sendOk(reply, data, 202);
  });

  // ---------------------------------------------------------------- assistant (G-g S10)

  /*
   * One turn of the Guest assistant.
   *
   * Off unless `GUEST_ASSISTANT_ENABLED` is on **and** a key is configured: the page then shows its
   * "unavailable" strip, which it already knows how to render, and everything else works. That is why
   * this answers `not_configured` rather than a 500 — a missing key is a configuration state, not a
   * fault.
   *
   * The design and the type travel in the body; the **contact details never do**, and the sentence is
   * redacted before a model sees it (see `lib/guestAssistant.ts`).
   */
  app.post('/public/guest/assistant/turn', async (request, reply) => {
    const config = assistantEnabled() ? await resolveAiConfig(db) : null;
    if (config === null) {
      return sendFail(reply, 'not_configured', 'The assistant is unavailable right now. The designer works as normal.');
    }

    const body = parseBody(guestAssistantTurnRequest, request.body, reply);
    if (body === null) return;

    // Honeypot: a script that fills every field gets the same shape of answer and nothing happens.
    if (body.website !== undefined && body.website.trim() !== '') {
      return sendOk(reply, { message: '', ops: [], design: body.design, failures: [], needsConfirm: false });
    }

    const types = await loadBuildingTypes(db, request.log);
    const type = types.find((t) => t.id === body.typeId);
    if (type === undefined) {
      return sendFail(reply, 'validation_failed', 'That building type is no longer offered.', [
        { path: 'typeId', message: 'Unknown building type' },
      ]);
    }

    // The design is checked here as well as by zod, because the server must apply the change set
    // against a design that is actually usable.
    const design = upgradeGuestDesign(body.design);
    if (design === null) {
      return sendFail(reply, 'validation_failed', 'That design could not be read.', [
        { path: 'design', message: 'Unreadable design' },
      ]);
    }

    const session = await resolveAssistantSession(db, request.cookies[ASSISTANT_COOKIE]);
    if (session.created) {
      reply.setCookie(ASSISTANT_COOKIE, session.token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: ASSISTANT_COOKIE_MAX_AGE,
        secure: process.env.NODE_ENV === 'production',
      });
    }

    const outcome = await runAssistantTurn(db, {
      sessionId: session.id,
      ipHash: hashIp(clientIp(request)),
      request: body,
      design,
      type,
      region: body.region ?? null,
      config,
    });

    if (!outcome.ok) {
      if (outcome.kind === 'rate_limited') return sendFail(reply, 'rate_limited', outcome.message);
      if (outcome.kind === 'invalid') return sendFail(reply, 'validation_failed', outcome.message);
      request.log.warn({ reason: outcome.reason }, 'guest assistant unavailable');
      return sendFail(reply, 'not_configured', 'The assistant is unavailable right now. The designer works as normal.');
    }

    if (outcome.replacedMessage) {
      // The prompt forbids prices and the schema has no price field; a model saying one anyway is
      // worth knowing about. The guest sees the safe sentence, not the model's.
      request.log.warn({ guestAssistant: session.id }, 'assistant reply mentioned money or internals; replaced with the safe sentence');
    }

    return sendOk(reply, {
      message: outcome.message,
      ops: outcome.ops,
      design: outcome.design,
      failures: outcome.failures,
      needsConfirm: outcome.needsConfirm,
    });
  });

  /*
   * Speech to text for the composer (plan 2026-11-22, spec line 675).
   *
   * ## What it is not
   *
   * It is **not** a turn. Nothing is recorded, nothing reaches the model's chat, and the transcript
   * never sends itself: it goes back to the browser, the visitor reads it, edits it if the recogniser
   * misheard, and presses Send. So there is no `recordTurn` here and no design in the body.
   *
   * ## Audio does not survive the request
   *
   * The bytes are decoded, passed to the gateway and dropped. They are not written to disk or the
   * database, and not logged: only the decoded length and the mime type appear in a failure line.
   * The transcript is redacted (`redact`) before it is answered, so a mobile number spoken by accident
   * never leaves the server.
   *
   * ## Its own quota
   *
   * The counters are separate from the turn's, because a transcription is a second paid call on top of
   * the turn it feeds. The per-address and per-session limits answer 429 like the turn does; the
   * platform's daily budget answers `unavailable` and the page retires the mic for that visit.
   */
  app.post(
    '/public/guest/assistant/transcribe',
    // base64 of 1 MB is ~1.4 MB; the app-wide 1 MB limit would refuse a legitimate clip.
    { bodyLimit: Math.ceil(1.5 * 1024 * 1024) },
    async (request, reply) => {
      const voiceFlag = (process.env.GUEST_ASSISTANT_VOICE ?? '').trim().toLowerCase();
      const voiceOn = voiceFlag === '1' || voiceFlag === 'true' || voiceFlag === 'on';
      const config = assistantEnabled() && voiceOn ? await resolveAiConfig(db) : null;
      if (config === null) {
        const data: GuestAssistantTranscribeResponse = { text: '', onTopic: false, alternatives: [], numberWarnings: [], unavailable: true };
        return sendOk(reply, data);
      }

      const body = parseBody(guestAssistantTranscribeRequest, request.body, reply);
      if (body === null) return;

      const types = await loadBuildingTypes(db, request.log);
      const type = types.find((t) => t.id === body.typeId);
      if (type === undefined) {
        return sendFail(reply, 'validation_failed', 'That building type is no longer offered.', [
          { path: 'typeId', message: 'Unknown building type' },
        ]);
      }

      const session = await resolveAssistantSession(db, request.cookies[ASSISTANT_COOKIE]);
      if (session.created) {
        reply.setCookie(ASSISTANT_COOKIE, session.token, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: ASSISTANT_COOKIE_MAX_AGE,
          secure: process.env.NODE_ENV === 'production',
        });
      }

      // Money is spent by the call below, so every counter is consumed first — the same order, and the
      // same reason, as `runAssistantTurn`.
      const ipHash = hashIp(clientIp(request));
      const perIp = await consume(db, `ga:voice:ip:${ipHash}`, ASSISTANT_LIMITS.voicePerIpDay, DAY_MS);
      if (!perIp.allowed) {
        return sendFail(reply, 'rate_limited', 'That is a lot of recordings from one place. Please wait a while.');
      }
      const perSession = await consume(db, `ga:voice:s:${session.id}`, ASSISTANT_LIMITS.voicePerSession, DAY_MS);
      if (!perSession.allowed) {
        return sendFail(reply, 'rate_limited', 'This conversation has reached its recording limit. You can still type.');
      }
      const daily = Number(process.env.GUEST_ASSISTANT_DAILY_VOICE ?? 300);
      const cap = await consume(
        db,
        `ga:voice:day:${new Date().toISOString().slice(0, 10)}`,
        Number.isFinite(daily) && daily > 0 ? daily : 300,
        DAY_MS,
      );
      if (!cap.allowed) {
        request.log.info('guest voice daily budget spent');
        const data: GuestAssistantTranscribeResponse = { text: '', onTopic: false, alternatives: [], numberWarnings: [], unavailable: true };
        return sendOk(reply, data);
      }

      const bytes = Buffer.from(body.audio, 'base64');
      if (bytes.length === 0) {
        request.log.warn({ mimeType: body.mimeType, durationMs: body.durationMs }, 'guest voice: empty audio');
        return sendFail(reply, 'validation_failed', 'That recording was empty. Try again.');
      }
      if (bytes.length > 1024 * 1024) {
        request.log.warn({ mimeType: body.mimeType, durationMs: body.durationMs, bytes: bytes.length }, 'guest voice: audio over the limit');
        /*
         * 413 with the product's usual envelope and the nearest existing code. A `payload_too_large`
         * code would be more exact, but `ERROR_CODES` is a shared contract with every front-end and one
         * route is not a reason to widen it.
         */
        return reply.status(413).send(fail('validation_failed', 'That recording was too long. Keep it under a minute.'));
      }

      const raw = await transcribe(config, new Uint8Array(bytes), body.mimeType, {
        prompt: shedSttPrompt(type),
        language: 'en',
        // The router needs the clip's length to tell "no speech" from "the provider failed silently".
        durationMs: body.durationMs,
      });
      if (raw === '') {
        // The failure side of `transcribe` is a silent `''`. Length and type say whether the clip was
        // unusable or the gateway was; the audio itself is gone by now, on purpose.
        request.log.warn({ mimeType: body.mimeType, durationMs: body.durationMs, bytes: bytes.length }, 'guest voice: no transcript');
      }

      /*
       * The model repairs what the recogniser misheard (lib/guestVoice.ts says why a model and not a
       * table). Redacted before it is sent, so a number spoken by accident never reaches the gateway
       * twice, and again after, because the model writes new text. It is counted by the voice quota
       * already consumed above: one recording, one repair.
       */
      const heard = redact(normaliseShedTranscript(raw));
      const repaired = heard === '' ? null : await repairTranscript(config, shedRepairPrompt(type), heard);
      if (heard !== '' && repaired === null) request.log.warn('guest voice: repair unavailable, raw transcript kept');

      const text = repaired === null ? heard : redact(repaired.text);
      const alternatives = repaired === null ? [] : repaired.alternatives.map((a) => redact(a)).filter((a) => a !== text);
      const data: GuestAssistantTranscribeResponse = {
        text,
        onTopic: repaired === null ? isShedTopic(text) : repaired.onTopic,
        alternatives,
        numberWarnings: numberWarnings(text, type),
      };
      return sendOk(reply, data);
    },
  );

  // ---------------------------------------------------------------- address (S3)

  const unavailable = (reply: FastifyReply) =>
    sendFail(reply, 'not_configured', 'Address suggestions are not available. Pick your suburb from the list instead.');

  const refuse = (request: FastifyRequest, reply: FastifyReply, refusal: Refusal) => {
    if (refusal.code === 'not_configured') {
      request.log.warn({ guestPlacesCap: refusal.cap }, 'guest places daily cap reached');
      trackEnquiryNotification(
        warnCapReached(db, mail, recipients, refusal.cap, (result) => {
          request.log.info({ guestPlacesCap: refusal.cap, ...result }, 'guest places cap warning');
        }),
      );
    }
    return sendFail(reply, refusal.code, refusal.message);
  };

  const upstreamFailed = (request: FastifyRequest, reply: FastifyReply, error: unknown) => {
    // Google's words go to the log, not to a stranger's browser: they can name the project's billing state.
    request.log.warn({ err: error }, 'guest address lookup failed');
    return sendFail(
      reply,
      'upstream_failed',
      'Address suggestions are unavailable right now. Pick your suburb from the list instead.',
    );
  };

  const expired = (reply: FastifyReply) =>
    sendFail(reply, 'unauthorized', 'The address search expired. Start typing again.');

  app.post('/public/guest/places/session', async (request, reply) => {
    if (places === null || placesTransport() === null) return unavailable(reply);
    const refusal = await allowSession(db, hashIp(clientIp(request)));
    if (refusal !== null) return refuse(request, reply, refusal);
    return sendOk(reply, issueSession(places.config.sessionSecret), 201);
  });

  app.get<{ Querystring: { q?: string; s?: string } }>('/public/guest/places/autocomplete', async (request, reply) => {
    const transport = placesTransport();
    if (places === null || transport === null) return unavailable(reply);

    const sessionId = verifySession(places.config.sessionSecret, request.query.s);
    if (sessionId === null) return expired(reply);

    const check = checkQuery(request.query.q);
    if (check.kind === 'empty') {
      const empty: GuestPlaceSuggestionsResponse = { suggestions: [] };
      return sendOk(reply, empty);
    }
    if (check.kind === 'invalid') {
      return sendFail(reply, 'validation_failed', check.message, [{ path: 'q', message: check.message }]);
    }

    const refusal = await allowAutocomplete(db, places.config, hashIp(clientIp(request)), sessionId);
    if (refusal !== null) return refuse(request, reply, refusal);

    try {
      const found = await withTimeout(
        transport.autocomplete(check.query, { sessionToken: sessionId }),
        PLACES_TIMEOUT_MS,
      );
      const data: GuestPlaceSuggestionsResponse = {
        suggestions: found
          .slice(0, MAX_SUGGESTIONS)
          .map((s) => ({ placeId: s.placeId, primary: s.primary, secondary: s.secondary })),
      };
      return sendOk(reply, data);
    } catch (error) {
      return upstreamFailed(request, reply, error);
    }
  });

  app.get<{ Querystring: { id?: string; s?: string } }>('/public/guest/places/details', async (request, reply) => {
    const transport = placesTransport();
    if (places === null || transport === null) return unavailable(reply);

    const sessionId = verifySession(places.config.sessionSecret, request.query.s);
    if (sessionId === null) return expired(reply);

    const placeId = checkPlaceId(request.query.id);
    if (placeId === null) {
      return sendFail(reply, 'validation_failed', 'That suggestion is not valid.', [
        { path: 'id', message: 'Pick a suggestion from the list' },
      ]);
    }

    const refusal = await allowDetails(db, places.config, hashIp(clientIp(request)), sessionId);
    if (refusal !== null) return refuse(request, reply, refusal);

    try {
      const address = await withTimeout(transport.details(placeId, { sessionToken: sessionId }), PLACES_TIMEOUT_MS);
      const data: GuestPlaceDetailsResponse = { details: toGuestPlaceDetails(placeId, address) };
      return sendOk(reply, data);
    } catch (error) {
      return upstreamFailed(request, reply, error);
    }
  });

  /**
   * The price book's suburb list: a prefix of the name, or of the postcode when the query is digits.
   *
   * Works with Places switched off — it is what the page offers instead. The table's own spelling
   * (`country_surburb`) is the desktop's. DISTINCT folds its one exact duplicate, and a name shared
   * by several states (Richmond: six) comes back once per state, which is why the state is shown.
   */
  app.get<{ Querystring: { q?: string } }>('/public/guest/suburbs', async (request, reply) => {
    const limit = await consume(db, `guest-suburbs:ip:${hashIp(clientIp(request))}`, SUBURB_IP_LIMIT, HOUR_MS);
    if (!limit.allowed) {
      return sendFail(reply, 'rate_limited', 'That is a lot of lookups from one place. Please wait a little and try again.');
    }

    const q = (request.query.q ?? '').trim().replace(/\s+/g, ' ');
    const empty: GuestSuburbsResponse = { suburbs: [] };
    if (q.length < 2) return sendOk(reply, empty);
    if (q.length > 60) {
      return sendFail(reply, 'validation_failed', 'Type at most 60 characters.', [{ path: 'q', message: 'Too long' }]);
    }

    const hash = await activeBookHash(db);
    if (hash === null) return sendFail(reply, 'not_configured', 'The suburb list is not available yet.');

    try {
      await ensureBookOnDisk(db, hash);
      const book = openBookDatabase(hash);
      // A typed `%` or `_` is a character, not a wildcard.
      const like = `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const padded = `substr('0000' || trim(surburb_code), -4, 4)`;
      const column = /^\d+$/.test(q) ? padded : 'trim(surburb_name)';
      const rows = book
        .prepare(
          `SELECT DISTINCT trim(surburb_name) AS name, ${padded} AS code, upper(trim(State_id)) AS state
             FROM country_surburb
            WHERE ${column} LIKE ? ESCAPE '\\'
            ORDER BY CASE WHEN lower(trim(surburb_name)) = lower(?) THEN 0 ELSE 1 END, name, state, code
            LIMIT ${SUBURB_MAX}`,
        )
        .all(like, q) as { name: string; code: string | number; state: string }[];

      const suburbs: GuestSuburb[] = rows.map((row) => ({
        suburb: row.name,
        state: row.state,
        postcode: postcode(row.code),
      }));
      const data: GuestSuburbsResponse = { suburbs };
      return sendOk(reply, data);
    } catch (error) {
      if (error instanceof BookMissingError) {
        request.log.error({ err: error }, 'guest suburb list: the price book is not on disk');
        return sendFail(reply, 'not_configured', 'The suburb list is not available yet.');
      }
      throw error;
    }
  });
}
