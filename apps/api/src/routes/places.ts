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
 */

import type { FastifyInstance } from 'fastify';
import {
  MIN_QUERY_LENGTH,
  createGooglePlacesTransport,
  placesConfigured,
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
      // A Google failure is upstream, not the operator's fault — 502, and the field falls back to a
      // text box so the quote can still be written.
      return sendFail(
        reply,
        'not_configured',
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
      return sendFail(
        reply,
        'not_configured',
        `Address lookup is unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  });
}

/**
 * Reject after `ms`, so a hung upstream does not hold the operator's field open.
 *
 * `AbortSignal.timeout` would be tidier but the transport takes a `fetch` implementation, and a
 * promise race is what can be applied to any transport — including the fake one a test injects.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('the lookup timed out')), ms);
      // Do not keep the process alive for a timer whose answer nobody is waiting for any more.
      if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    }),
  ]);
}
