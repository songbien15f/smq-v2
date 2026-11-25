/**
 * Address suggestions, from Google Places.
 *
 * Two rules decide the shape of this module:
 *
 * 1. **The key never reaches the browser.** The API key is a server secret: a key in client code is
 *    a key anyone can copy from the network tab and spend. So the browser talks to our route, and our
 *    route talks to Google.
 * 2. **An unconfigured server says so.** With no key, the route returns `configured: false` and the
 *    field stays a plain text box. It does not fall back to a fake list, and it does not silently
 *    return nothing as though the address were unknown.
 * 3. **A refusal keeps Google's words.** `403` alone covers a revoked key, billing switched off, a
 *    disabled API and key restrictions — four different fixes, one number. `describeRefusal` reads the
 *    body so the message names which; discarding it is what made the 2026-11-13 outage undiagnosable.
 *
 * ## Why `details` parses address components here and not in the browser
 *
 * The upstream project resolved a picked suggestion to one `formattedAddress` string and stopped
 * there. That is enough for a single free-text field, and this product has **four** — address,
 * suburb, state, postcode — because an Australian quote states them separately and the state selects
 * the price table. Leaving the operator to retype them is how a quote ends up in the wrong state's
 * price list.
 *
 * So the field mask asks for `addressComponents` and the split happens here, once, where it can be
 * tested. The component mapping follows the desktop's own rules: `administrative_area_level_1` short
 * name is the state code, `locality`/`sublocality` long name is the suburb, `postal_code` is the
 * postcode.
 */

/** One suggestion while typing. */
export interface AddressSuggestion {
  /** Opaque id to pass to `details`. */
  placeId: string;
  /** The main line, e.g. "12 Example St". */
  primary: string;
  /** The rest, e.g. "Roma NSW 4455, Australia". */
  secondary: string;
}

/** A picked suggestion, resolved to the parts a quote stores. */
export interface ResolvedAddress {
  /** Google's own single-line form, for display and for the "as typed" case. */
  formatted: string;
  /** The street line, without the suburb/state/postcode. */
  street: string;
  suburb: string;
  /** A two- or three-letter code, matching the quote's `stateCode`. */
  state: string;
  postcode: string;
  /**
   * The place's coordinates, when the caller asked for them.
   *
   * Used to estimate a wind region (plan G-a2 S2) and **never stored or sent to a browser**:
   * Google's Places policy allows keeping the place ID only. Members of this interface are
   * internal to the server.
   */
  lat?: number;
  lng?: number;
}

/**
 * Per-call options.
 *
 * `sessionToken` groups a run of autocompletes and the one details call that ends it into a single
 * billing session (Google: a URL-safe base64 string of at most 36 characters; a v4 UUID is what Google
 * recommends). Omitted, every call is billed on its own — which is what the operator's editor routes
 * have always done, so leaving it out changes nothing for them.
 */
export interface PlacesCallOptions {
  sessionToken?: string;
}

/** What a caller may ask for. */
export interface PlacesTransport {
  autocomplete(input: string, options?: PlacesCallOptions): Promise<AddressSuggestion[]>;
  details(placeId: string, options?: PlacesCallOptions): Promise<ResolvedAddress | null>;
}

/** The smallest query worth sending to a paid API. */
export const MIN_QUERY_LENGTH = 3;

/** True when a key is configured, so the UI can say whether to offer suggestions. */
export function placesConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const key = env.GOOGLE_PLACES_API_KEY;
  return key !== undefined && key.trim() !== '';
}

/** One entry of Google's `addressComponents`. */
interface AddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

/** The first component carrying one of `types`, preferring `short` when asked. */
function component(
  components: AddressComponent[],
  types: readonly string[],
  which: 'long' | 'short' = 'long',
): string {
  for (const type of types) {
    const found = components.find((entry) => (entry.types ?? []).includes(type));
    if (found !== undefined) {
      const value = which === 'short' ? found.shortText : found.longText;
      if (value !== undefined && value.trim() !== '') return value.trim();
    }
  }
  return '';
}

/**
 * Split Google's address components into the four fields a quote keeps.
 *
 * Exported so a test can pin the mapping without a network call — the mapping is the part that goes
 * wrong, and it is the part that decides which state's price table a quote is priced from.
 */
export function splitAddress(
  components: AddressComponent[],
  formatted: string,
  location?: { latitude?: number; longitude?: number },
): ResolvedAddress {
  const streetNumber = component(components, ['street_number']);
  const route = component(components, ['route']);
  // A street line is "number route" when both exist, and whichever exists when only one does. A
  // rural address often has no number, and a PO box has neither.
  const street = [streetNumber, route].filter((part) => part !== '').join(' ');

  const lat = location?.latitude;
  const lng = location?.longitude;
  const coords =
    typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)
      ? { lat, lng }
      : {};

  return {
    formatted,
    street,
    suburb: component(components, ['locality', 'sublocality', 'sublocality_level_1', 'postal_town']),
    // The short name is the state code ("QLD"), which is what the quote stores and what selects the
    // price table. The long name ("Queensland") would not match.
    state: component(components, ['administrative_area_level_1'], 'short'),
    postcode: component(components, ['postal_code']),
    ...coords,
  };
}

/**
 * Google's own words for a refusal, so the screen and the log can say why.
 *
 * The status alone is not enough: `403` covers a revoked key, a key whose restrictions no longer
 * list Places, billing switched off, and a disabled API — four different fixes, one number. The body
 * names which. It is read here, once, rather than left to whoever debugs it next with `curl`.
 */
async function describeRefusal(response: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: { message?: string; status?: string } };
    const message = body.error?.message?.trim() ?? '';
    const status = body.error?.status?.trim() ?? '';
    if (message !== '') detail = status === '' ? message : `${status}: ${message}`;
  } catch {
    // A body that is not the documented error shape tells us nothing; the status still does.
  }
  return detail === '' ? `Places refused with ${response.status}` : `Places refused with ${response.status} — ${detail}`;
}

/**
 * A transport backed by the Places API (New).
 *
 * Field masks are explicit and narrow: Places bills by the fields requested, and a wildcard mask is
 * the most expensive call the API offers.
 */
export function createGooglePlacesTransport(apiKey: string, fetchImpl: typeof fetch = fetch): PlacesTransport {
  const autocompleteHeaders = {
    'content-type': 'application/json',
    'x-goog-api-key': apiKey,
    'x-goog-fieldmask':
      'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text',
  };

  return {
    async autocomplete(input, options = {}) {
      const response = await fetchImpl('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: autocompleteHeaders,
        body: JSON.stringify({
          input,
          // Australia only: this app quotes Australian sheds, and an address in another country is a
          // typo or a mistake, not a delivery.
          //
          /*
           * Street addresses — and the two forms that are still a *place to build on*.
           *
           * The first version of this filter named only `street_address`, which a rural lot without a
           * number and a unit inside a block do not have: Google types those `premise` and
           * `subpremise`, so the suggestion disappeared from a customer's list entirely (E5, round 3).
           * A business (`establishment`) or a station still does not belong here.
           */
          includedRegionCodes: ['au'],
          includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
          ...(options.sessionToken === undefined ? {} : { sessionToken: options.sessionToken }),
        }),
      });
      if (!response.ok) throw new Error(await describeRefusal(response));

      const body = (await response.json()) as {
        suggestions?: {
          placePrediction?: {
            placeId?: string;
            structuredFormat?: {
              mainText?: { text?: string };
              secondaryText?: { text?: string };
            };
          };
        }[];
      };

      return (body.suggestions ?? []).flatMap((suggestion) => {
        const prediction = suggestion.placePrediction;
        if (prediction?.placeId === undefined) return [];
        return [
          {
            placeId: prediction.placeId,
            primary: prediction.structuredFormat?.mainText?.text ?? '',
            secondary: prediction.structuredFormat?.secondaryText?.text ?? '',
          },
        ];
      });
    },

    async details(placeId, options = {}) {
      const session =
        options.sessionToken === undefined ? '' : `?sessionToken=${encodeURIComponent(options.sessionToken)}`;
      const response = await fetchImpl(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${session}`,
        {
          headers: {
            'x-goog-api-key': apiKey,
            // `addressComponents` is what makes the four fields fillable; asking for it is a
            // different (and slightly dearer) billing tier than `formattedAddress` alone, which is
            // the trade this product needs. `location` is in the **same** Essentials tier (checked
            // 2026-11-19, docs/research/places-location-sku.md), so the wind-region estimate costs
            // nothing extra.
            'x-goog-fieldmask': 'formattedAddress,addressComponents,location',
          },
        },
      );
      if (!response.ok) {
        /*
         * `400`/`404` mean the suggestion this id came from is stale — a normal answer, and `null` is
         * what a caller can act on. Every other refusal (revoked key, API off, quota) is the same
         * failure autocomplete reports; answering `null` there would look like "no such address" and
         * leave all four fields blank with nothing to explain it.
         */
        if (response.status === 400 || response.status === 404) return null;
        throw new Error(await describeRefusal(response));
      }

      const body = (await response.json()) as {
        formattedAddress?: string;
        addressComponents?: AddressComponent[];
        location?: { latitude?: number; longitude?: number };
      };
      if (body.formattedAddress === undefined || body.formattedAddress.trim() === '') return null;

      return splitAddress(body.addressComponents ?? [], body.formattedAddress, body.location);
    },
  };
}

/**
 * Reject after `ms`, so a hung upstream does not hold an address field open.
 *
 * `AbortSignal.timeout` would be tidier but the transport takes a `fetch` implementation, and a
 * promise race is what can be applied to any transport — including the fake one a test injects.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('the lookup timed out')), ms);
      // Do not keep the process alive for a timer whose answer nobody is waiting for any more.
      if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    }),
  ]);
}
