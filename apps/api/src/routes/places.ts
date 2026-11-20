/**
 * Address lookup, proxied so the Google key never reaches the browser.
 *
 * ## Why these routes exist
 *
 * The address fields are four plain text boxes today, so a suburb is spelled by hand and a postcode
 * can be wrong — and the state selects which price table a quote is priced from, so a wrong state is
 * a wrong price. Places fixes that, and the key stays here.
 *
 * ## Why the capability is `quote:write`
 *
 * A suggestion costs money. A viewer reads quotes and cannot edit one, so letting them spend the
 * company's Places budget on a field they cannot change is a cost with no benefit. The check is the
 * same one the editor uses for every other write.
 *
 * ## Why an unconfigured server answers 200 with `configured: false`
 *
 * A missing key is a deployment fact, not a client error. The field then renders as a plain text box
 * — which is what it was before this route existed — and the screen says so rather than showing an
 * empty suggestion list that reads as "no such address".
 *
 * ## Why a refusal from Google is 502 `upstream_failed`, not 503 `not_configured`
 *
 * On 2026-11-13 the live key began answering `403 PERMISSION_DENIED` (billing, API off, or key
 * restrictions — the body names which). The route reported "not configured", which sends the reader
 * to `.env` where the key is present and correct, and the transport had thrown Google's explanation
 * away. A present-but-refused key is an upstream failure: 502, and the message keeps Google's words.
 */

import type { FastifyInstance } from 'fastify';
import {
  MIN_QUERY_LENGTH,
  createGooglePlacesTransport,
  placesConfigured,
  withTimeout,
  type PlacesTransport,
} from '../lib/places.js';
import { sendFail, sendOk } from '../lib/http.js';
import { requireCompanyCapability } from '../lib/guard.js';

/** How long a suggestion request may take before the field gives up and stays a text box. */
const TIMEOUT_MS = 4000;

/**
 * Build the transport from the environment, or `null` when the key is not set.
 *
 * **The key lives in `.env` and nowhere else** — it is a deployment secret, not a setting. There is no
 * screen for it, so there is no row to leak and no audit trail of who typed it. Changing it means
 * editing the environment and restarting, which is the right amount of friction for a credential that
 * spends money on every keystroke.
 */
function transport(): PlacesTransport | null {
  if (!placesConfigured()) return null;
  const key = (process.env.GOOGLE_PLACES_API_KEY as string).trim();
  return createGooglePlacesTransport(key);
}

export function registerPlaces(app: FastifyInstance): void {
  /** Suggest addresses while the operator types. */
  app.get<{ Querystring: { q?: string } }>('/places/autocomplete', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:write');
    if (session === null) return;

    const places = transport();
    if (places === null) {
      return sendOk(reply, { configured: false, suggestions: [] });
    }

    const query = (request.query.q ?? '').trim();
    // Below the minimum the answer is empty rather than an error: the operator is still typing.
    if (query.length < MIN_QUERY_LENGTH) {
      return sendOk(reply, { configured: true, suggestions: [] });
    }

    try {
      const suggestions = await withTimeout(places.autocomplete(query), TIMEOUT_MS);
      return sendOk(reply, { configured: true, suggestions });
    } catch (error) {
      /*
       * A Google failure is upstream, not the operator's fault — 502 `upstream_failed`, and the field
       * falls back to a text box so the quote can still be written. It is deliberately **not**
       * `not_configured`: a key that Google refuses is configured, and answering "not configured"
       * sends the reader to check `.env` when the key is right there and the problem is on the
       * project (billing, a disabled API, key restrictions). The message carries Google's own words.
       */
      request.log.warn({ err: error }, 'address lookup failed');
      return sendFail(
        reply,
        'upstream_failed',
        `Address lookup is unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  });

  /** Resolve a picked suggestion into the four fields a quote keeps. */
  app.get<{ Querystring: { id?: string } }>('/places/details', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:write');
    if (session === null) return;

    const places = transport();
    if (places === null) {
      return sendOk(reply, { configured: false, address: null });
    }

    const placeId = (request.query.id ?? '').trim();
    if (placeId === '') return sendFail(reply, 'validation_failed', 'A place id is required.');

    try {
      const address = await withTimeout(places.details(placeId), TIMEOUT_MS);
      return sendOk(reply, { configured: true, address });
    } catch (error) {
      request.log.warn({ err: error }, 'address details failed');
      return sendFail(
        reply,
        'upstream_failed',
        `Address lookup is unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  });
}
