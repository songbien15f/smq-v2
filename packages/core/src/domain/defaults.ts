import type { DimensionedShed, OpeningType, ShedConfig } from './types';

/**
 * Colorbond colour values, keyed by the name the price book uses.
 *
 * The book indexes flashing, gutter and screws by colour *name*, so these hexes
 * are the bridge: the renderers paint with the hex, the price book matches the
 * name. Only the standard range is listed; a custom colour falls back to a
 * generic price rather than being rejected.
 */
export const COLORBOND: Record<string, string> = {
  Basalt: '#6d6c6e',
  'Blue Ridge': '#49666c',
  Bushland: '#9d9b8f',
  'Classic Cream': '#e9dcb8',
  Cove: '#7f7a6f',
  'Deep Ocean': '#1a3b47',
  Dune: '#b1ada3',
  'Evening Haze': '#b5b0a8',
  Gully: '#857e73',
  Headland: '#6b6a5f',
  Ironstone: '#3e434c',
  Jasper: '#6b5f52',
  Loft: '#5a5a5a',
  Mangrove: '#6b6354',
  'Manor Red': '#6b2b28',
  Monument: '#323232',
  'Night Sky': '#2b3033',
  Paperbark: '#a9a08c',
  Plantation: '#6f7261',
  Sandbank: '#c4b8a3',
  'Shale Grey': '#bdbfba',
  Surfmist: '#e4e2d5',
  Terrain: '#8a6a4f',
  Wallaby: '#8b8578',
  Wilderness: '#5c6350',
  Windspray: '#888b8a',
  'Woodland Grey': '#4b4c46',
  'Z450 Galv': '#b6b8b4',
  'Z600 Galv': '#b6b8b4',
  Zinc: '#eeeeee',
};

/**
 * Standard personal-access door size, in millimetres. The single source of truth
 * for the size `addOpening` mints when no size is given and for the fallback a
 * malformed opening falls back to. The three door entries of
 * `DEFAULT_OPENING_BY_TYPE` are built from it, so every door default shares one
 * size.
 *
 * **2040 mm, not the 2100 mm the desktop used.** The price book's personal-access
 * catalogue tops out at 2040 mm, so a 2100 mm request finds no door at all and
 * every default door came out unpriced. 820 × 2040 is the smallest catalogue size
 * and the one a shed is normally quoted with.
 */
export const DEFAULT_OPENING_SIZE = { width: 820, height: 2040 } as const;

/**
 * Per-type opening defaults. The three door types share the personal-access door
 * size; a window is a shorter opening that sits above the floor (`sill`), matching
 * what the fallback parser mints when the user does not state a window size. The
 * menu's add path reads both its clamp probe and its `addOpening` payload from
 * this table, so the probe can never drift from what is actually created.
 */
export const DEFAULT_OPENING_BY_TYPE: Record<
  OpeningType,
  { width: number; height: number; sill: number }
> = {
  roller_door: { width: DEFAULT_OPENING_SIZE.width, height: DEFAULT_OPENING_SIZE.height, sill: 0 },
  pa_door: { width: DEFAULT_OPENING_SIZE.width, height: DEFAULT_OPENING_SIZE.height, sill: 0 },
  sliding_door: { width: DEFAULT_OPENING_SIZE.width, height: DEFAULT_OPENING_SIZE.height, sill: 0 },
  window: { width: 900, height: 900, sill: 900 },
  // A plain hole is a personal-access-door-sized cut with nothing fitted into
  // it, which is what a "just leave an opening" request means in practice.
  opening: { width: DEFAULT_OPENING_SIZE.width, height: DEFAULT_OPENING_SIZE.height, sill: 0 },
};

/** The starting configuration for a new shed. All linear values are millimetres. */
export const DEFAULT_SHED: ShedConfig = {
  structureType: 'gable',
  /*
   * The three dimensions a new quote **does not have**.
   *
   * These used to be 12 000 × 24 000 × 4 200 — numbers with no source. They made a quote priceable,
   * and made ShedSafe rate a building, before anybody said what the shed was. The desktop's Building
   * Parameters panel opens empty and its `GO TO SITECHECK` stays disabled until these are entered;
   * `null` is how that absence travels through this codebase.
   *
   * Everything else below still has a value, because it is a **default somebody may change**
   * (structure type, pitch, bays, colours) rather than a fact about a building.
   */
  span: null,
  length: null,
  height: null,
  roofPitchDeg: 10,
  bays: 4,
  nomBaySpacing: 6000,
  openings: [],
  options: [],
  charges: [],
  internalPressure: 'closed',
  // Site conditions default to the mildest common Australian case: wind region A,
  // suburban terrain, no shielding, flat ground. A real quote must set these from
  // the site; the defaults exist so a new shed can be drawn before anyone has
  // looked at a map.
  windRegion: 'A',
  terrainCategory: 2.5,
  shieldingFactor: 1,
  /*
   * Importance level 2 — the desktop's default, and this API's own default.
   *
   * It was 1 here while `pinRequest` defaulted to 2 and the desktop's panel initialises to 2, so the
   * same quote could be **pinned at level 2 and then priced at level 1**: the pin recorded one number
   * and the frame table was read at another. Two of three places said 2; the odd one out was the one
   * that writes the stored config.
   *
   * The real value is the certificate's, not this file's. A default only decides what a brand-new
   * shed starts from, before anyone has run a site check.
   */
  importanceLevel: 2,
  topographyFactor: 1,
  stateCode: 'QLD',
  wallProfile: 'Corro',
  roofProfile: 'Corro',
  // The thickness the BOM has always priced. Stated here so a new quote records what it was
  // priced from, rather than leaving the reader to infer the default.
  wallBmt: 0.42,
  roofBmt: 0.42,
  downpipeType: '',
  footingType: '',
  footingSubType: '',
  endOpening: { left: false, right: false },
  sideOpening: { front: false, back: false },
  buildingClass: null,
  snowLoad: null,
  designWindSpeed: null,
  // Real Colorbond names and values. The colours are not decoration: flashing and
  // roof screws are priced per colour, so a made-up hex matches nothing in the
  // book and those lines silently fall back to a generic price. Shale Grey walls
  // with a Surfmist roof and trim is a common Australian combination.
  colors: {
    wall: COLORBOND['Shale Grey'],
    roof: COLORBOND['Surfmist'],
    barge: COLORBOND['Surfmist'],
    downpipe: COLORBOND['Surfmist'],
    gutter: COLORBOND['Surfmist'],
    window: COLORBOND['Monument'],
    paDoor: COLORBOND['Monument'],
    rollerDoor: COLORBOND['Monument'],
    slidingDoor: COLORBOND['Monument'],
    dividingWall: COLORBOND['Surfmist'],
  },
  displayUnit: 'm',
};

/**
 * A **described** building, for tests and for the editor's starting sketch.
 *
 * `DEFAULT_SHED` deliberately has no dimensions, because a new quote has no building. That makes it
 * useless as a fixture: almost every test wants a shed it can price. This is that shed — the same
 * 12 × 24 m figure the old `DEFAULT_SHED` carried, now named for what it is (a test building) instead
 * of pretending to be a default.
 *
 * Production code must not use it as a starting point. If something needs a building to exist before
 * an operator has described one, the answer is a gate, not this constant.
 */
export const TEST_SHED: DimensionedShed = {
  ...DEFAULT_SHED,
  span: 12000,
  length: 24000,
  height: 4200,
};

