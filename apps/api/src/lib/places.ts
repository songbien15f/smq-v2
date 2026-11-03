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
}

/** What a caller may ask for. */
export interface PlacesTransport {
  autocomplete(input: string): Promise<AddressSuggestion[]>;
  details(placeId: string): Promise<ResolvedAddress | null>;
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
export function splitAddress(components: AddressComponent[], formatted: string): ResolvedAddress {
  const streetNumber = component(components, ['street_number']);
  const route = component(components, ['route']);
  // A street line is "number route" when both exist, and whichever exists when only one does. A
  // rural address often has no number, and a PO box has neither.
  const street = [streetNumber, route].filter((part) => part !== '').join(' ');

  return {
    formatted,
    street,
    suburb: component(components, ['locality', 'sublocality', 'sublocality_level_1', 'postal_town']),
    // The short name is the state code ("QLD"), which is what the quote stores and what selects the
    // price table. The long name ("Queensland") would not match.
    state: component(components, ['administrative_area_level_1'], 'short'),
    postcode: component(components, ['postal_code']),
  };
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
    async autocomplete(input) {
      const response = await fetchImpl('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: autocompleteHeaders,
        body: JSON.stringify({
          input,
          // Australia only: this app quotes Australian sheds, and an address in another country is a
          // typo or a mistake, not a delivery.
          includedRegionCodes: ['au'],
        }),
      });
      if (!response.ok) throw new Error(`Places autocomplete failed: ${response.status}`);

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

    async details(placeId) {
      const response = await fetchImpl(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
        {
          headers: {
            'x-goog-api-key': apiKey,
            // `addressComponents` is what makes the four fields fillable; asking for it is a
            // different (and slightly dearer) billing tier than `formattedAddress` alone, which is
            // the trade this product needs.
            'x-goog-fieldmask': 'formattedAddress,addressComponents',
          },
        },
      );
      if (!response.ok) return null;

      const body = (await response.json()) as {
        formattedAddress?: string;
        addressComponents?: AddressComponent[];
      };
      if (body.formattedAddress === undefined || body.formattedAddress.trim() === '') return null;

      return splitAddress(body.addressComponents ?? [], body.formattedAddress);
    },
  };
}
