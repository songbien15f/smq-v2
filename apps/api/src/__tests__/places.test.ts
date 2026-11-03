import { describe, it, expect } from 'vitest';
import { splitAddress, placesConfigured, createGooglePlacesTransport, MIN_QUERY_LENGTH } from '../lib/places';

/**
 * Address parsing, and the two rules that make the integration safe.
 *
 * The mapping is the part that goes wrong, and it is the part that decides which **state's price
 * table** a quote is priced from — so it is pinned here rather than left to a live Google call.
 */

/** A realistic Places `addressComponents` array for an Australian address. */
const components = [
  { longText: '12', shortText: '12', types: ['street_number'] },
  { longText: 'Example Street', shortText: 'Example St', types: ['route'] },
  { longText: 'Roma', shortText: 'Roma', types: ['locality', 'postal_town'] },
  { longText: 'Maranoa', shortText: 'Maranoa', types: ['administrative_area_level_2'] },
  { longText: 'Queensland', shortText: 'QLD', types: ['administrative_area_level_1'] },
  { longText: 'Australia', shortText: 'AU', types: ['country'] },
  { longText: '4455', shortText: '4455', types: ['postal_code'] },
];

describe('splitAddress', () => {
  it('splits an Australian address into the four fields a quote keeps', () => {
    const address = splitAddress(components, '12 Example Street, Roma QLD 4455, Australia');

    expect(address.street).toBe('12 Example Street');
    expect(address.suburb).toBe('Roma');
    // The SHORT name, because the quote stores a state code and the code selects the price table.
    // "Queensland" would not match any table.
    expect(address.state).toBe('QLD');
    expect(address.postcode).toBe('4455');
    expect(address.formatted).toBe('12 Example Street, Roma QLD 4455, Australia');
  });

  it('handles a rural address with no street number', () => {
    const address = splitAddress(
      [
        { longText: 'Roma Road', shortText: 'Roma Rd', types: ['route'] },
        { longText: 'Roma', shortText: 'Roma', types: ['locality'] },
        { longText: 'Queensland', shortText: 'QLD', types: ['administrative_area_level_1'] },
        { longText: '4455', shortText: '4455', types: ['postal_code'] },
      ],
      'Roma Road, Roma QLD 4455',
    );

    // No number, so the street is the route alone rather than a leading space.
    expect(address.street).toBe('Roma Road');
    expect(address.suburb).toBe('Roma');
  });

  it('falls back to sublocality when there is no locality', () => {
    // A suburb inside a city often has `sublocality` and no `locality`.
    const address = splitAddress(
      [
        { longText: '1 Queen Street', shortText: '1 Queen St', types: ['street_number', 'route'] },
        { longText: 'Brisbane City', shortText: 'Brisbane City', types: ['sublocality', 'sublocality_level_1'] },
        { longText: 'Queensland', shortText: 'QLD', types: ['administrative_area_level_1'] },
        { longText: '4000', shortText: '4000', types: ['postal_code'] },
      ],
      '1 Queen Street, Brisbane City QLD 4000',
    );

    expect(address.suburb).toBe('Brisbane City');
    expect(address.state).toBe('QLD');
  });

  it('returns empty parts rather than throwing when components are missing', () => {
    const address = splitAddress([], 'Somewhere');

    expect(address.formatted).toBe('Somewhere');
    expect(address.street).toBe('');
    expect(address.suburb).toBe('');
    expect(address.state).toBe('');
    expect(address.postcode).toBe('');
  });
});

describe('placesConfigured', () => {
  it('is false with no key, so the field stays a text box', () => {
    expect(placesConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(placesConfigured({ GOOGLE_PLACES_API_KEY: '   ' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('is true with a key', () => {
    expect(placesConfigured({ GOOGLE_PLACES_API_KEY: 'abc' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('the Google transport', () => {
  it('sends the key in a header, never in the URL', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ suggestions: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const transport = createGooglePlacesTransport('SECRET-KEY', fake);
    await transport.autocomplete('12 Example');

    const call = calls[0];
    expect(call?.url).not.toContain('SECRET-KEY');
    expect((call?.init?.headers as Record<string, string>)['x-goog-api-key']).toBe('SECRET-KEY');
  });

  it('asks only for the fields it needs, because Places bills by field', async () => {
    const calls: { init?: RequestInit }[] = [];
    const fake = (async (_url: string, init?: RequestInit) => {
      calls.push({ init });
      return new Response(JSON.stringify({ suggestions: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await createGooglePlacesTransport('k', fake).autocomplete('12 Example');

    const mask = (calls[0]?.init?.headers as Record<string, string>)['x-goog-fieldmask'];
    expect(mask).toContain('placeId');
    // A wildcard mask is the most expensive call the API offers.
    expect(mask).not.toBe('*');
  });

  it('restricts suggestions to Australia', async () => {
    let body: { includedRegionCodes?: string[] } = {};
    const fake = (async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? '{}')) as { includedRegionCodes?: string[] };
      return new Response(JSON.stringify({ suggestions: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await createGooglePlacesTransport('k', fake).autocomplete('12 Example');
    expect(body.includedRegionCodes).toEqual(['au']);
  });

  it('resolves details into the four parts, not just a formatted string', async () => {
    const fake = (async () =>
      new Response(
        JSON.stringify({
          formattedAddress: '12 Example Street, Roma QLD 4455, Australia',
          addressComponents: components,
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const address = await createGooglePlacesTransport('k', fake).details('place-1');

    expect(address).not.toBeNull();
    expect(address?.suburb).toBe('Roma');
    expect(address?.state).toBe('QLD');
    expect(address?.postcode).toBe('4455');
  });

  it('answers null rather than throwing when details fails', async () => {
    const fake = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    expect(await createGooglePlacesTransport('k', fake).details('place-1')).toBeNull();
  });

  it('skips a suggestion with no place id, because it cannot be resolved', async () => {
    const fake = (async () =>
      new Response(
        JSON.stringify({
          suggestions: [
            { placePrediction: { structuredFormat: { mainText: { text: 'Dead row' } } } },
            {
              placePrediction: {
                placeId: 'ok',
                structuredFormat: { mainText: { text: '12 Example St' }, secondaryText: { text: 'Roma NSW' } },
              },
            },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const suggestions = await createGooglePlacesTransport('k', fake).autocomplete('12 Ex');
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.placeId).toBe('ok');
  });

  it('uses a minimum query length, so a single keystroke is not a paid call', () => {
    expect(MIN_QUERY_LENGTH).toBeGreaterThanOrEqual(3);
  });
});
