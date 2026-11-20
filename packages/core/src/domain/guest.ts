/**
 * The Guest quote page's design rules (spec docs/specs/quote-tiers-guest.md, plan
 * docs/plans/quote-tiers-guest-ga2.md, decisions Q1–Q8 of 2026-11-19).
 *
 * A guest designs inside a **building type**: a base preset, a size window, the doors and
 * windows it allows (as size chips), and the colours on offer. This module turns a guest's
 * design into an ordinary `ShedConfig` and says whether the design fits its type. The page
 * and the API both call it, so the two can never disagree (A13).
 *
 * ## Version 2 (2026-11-19)
 *
 * The customer asked for six building types, a roof switch (gable / skillion) instead of a
 * separate "Skillion" type, editable bay lengths, slab connection, knee-brace preference and
 * cladding direction. v1 stored equal bays only (`size.bays` × `size.bayWidth`) and had no
 * roof field; the array of per-bay lengths is what lets a bay mismatch survive to the estimator
 * and what the frame table keys on (`bayWidthsFor`).
 *
 * `upgradeGuestDesign` reads a v1 document out of a returning guest's `localStorage`; the API
 * accepts **v2 only**.
 *
 * ## What this module does not decide
 *
 * Slab connection and knee brace are **wishes**, not engineering: the book decides the footing
 * (`shed_footing_type`, `shed_footing_sub_type`) and the knee-brace row (`view_system_lookup_data.KB_type`).
 * They ride along in `design_json` for the estimator and never reach `ShedConfig`.
 *
 * The shapes here are plain TypeScript. `@sq/contracts` holds the zod schemas for the same
 * shapes and asserts at compile time that the two agree; core cannot import contracts,
 * because contracts depends on core.
 *
 * No prices: a guest never sees one (D-T3), and nothing here reads the price book.
 *
 * Pure TypeScript: no React, Next.js, database or HTTP.
 */

import { COLORBOND } from './defaults';
import { wallLength } from './placement';
import { placeOpening } from './placementRules';
import { presetById, type PresetId } from './presets';
import { withDimensions, type Opening, type ShedConfig, type StateCode, type StructureType, type WallSide } from './types';
import type { GuestWindRegion } from './windRegion';

/**
 * AS/NZS 1170.2 wind regions for Australia.
 *
 * Defined in `windRegion.ts` alongside the estimator (`estimateWindRegion`); re-exported here so a
 * caller that already imports the guest shapes does not have to know which module owns it.
 */
export type { GuestWindRegion };

// ---------------------------------------------------------------- shapes

export type GuestOpeningKind = 'roller_door' | 'pa_door' | 'sliding_door' | 'window';

/** Gable or a single slope. Changing this changes the **engine structure**, not a flag. */
export type GuestRoof = 'gable' | 'skillion';

/**
 * What the guest stands the building on. `footing_only` is recorded only — Q5: the estimator
 * maps it onto the book's footing when they open the quote.
 */
export type GuestSlab = 'in_slab' | 'on_slab' | 'footing_only';

/** A preference, not a frame choice (Q, customer gap #10: "No Knee Brace – If Possible"). */
export type GuestKneeBrace = 'standard' | 'none_if_possible';

export type GuestCladding = 'vertical' | 'horizontal';

export interface GuestBuildingSpec {
  span: number;
  height: number;
  pitchDeg: number;
  roof: GuestRoof;
  /** One length per bay, mm. `length` is the sum — there is no separate length field. */
  bayWidths: number[];
  slab: GuestSlab;
  kneeBrace: GuestKneeBrace;
  cladding: GuestCladding;
}

export interface GuestOpeningSpec {
  type: GuestOpeningKind;
  wall: WallSide;
  /** mm from the wall's left corner, seen from outside (same as `Opening.offset`). */
  offset: number;
  size: { width: number; height: number };
  /** Roller doors only. Carried to the estimator; `Opening` has no motor field. */
  motorised?: boolean;
}

export interface GuestColourChoice {
  walls: string;
  roof: string;
  trim: { barge: string; gutter: string; downpipe: string };
}

export interface GuestSite {
  suburb: string;
  state: StateCode;
  postcode: string;
  street?: string;
  placeId?: string;
}

export interface GuestDesignInput {
  v: 2;
  typeId: string;
  typeVersion: number;
  site?: GuestSite;
  building: GuestBuildingSpec;
  openings: GuestOpeningSpec[];
  colours: GuestColourChoice;
}

export interface GuestRange {
  min: number;
  max: number;
}

export interface GuestOpeningRuleSpec {
  type: GuestOpeningKind;
  max: number;
  /** Size chips; the first is the default. */
  sizes: { width: number; height: number }[];
  defaultWall: WallSide;
}

export type GuestIcon =
  | 'shed'
  | 'garage'
  | 'carport'
  | 'skillion'
  | 'industrial'
  | 'arena'
  | 'hangar'
  | 'house';

/** Whether the page offers a design at all, or only takes a request (Q1: Class 1 House). */
export type GuestTypeMode = 'design' | 'enquiry';

/** Whether the building has walls. Roof Only is what makes a carport's internal pressure differ. */
export type GuestEnclosure = 'enclosed' | 'roof_only';

export interface GuestBuildingTypeConfigSpec {
  basePreset: PresetId;
  icon: GuestIcon;
  mode: GuestTypeMode;
  enclosure: GuestEnclosure;
  /** Roofs this type offers. The first is the default. */
  roofs: GuestRoof[];
  start: GuestBuildingSpec;
  limits: {
    span: GuestRange;
    height: GuestRange;
    bayWidth: GuestRange;
    bays: GuestRange;
    /** Pitch chips per roof, degrees. The first of each list is that roof's default. */
    pitchesByRoof: Record<GuestRoof, number[]>;
  };
  openings: {
    rules: GuestOpeningRuleSpec[];
    defaults: GuestOpeningSpec[];
    lockedReason?: string;
  };
  colours: { defaults: GuestColourChoice; allowed: string[] };
}

export interface GuestBuildingTypeSpec {
  id: string;
  name: string;
  description: string;
  /** 0 = a default from this file, never saved to the database. */
  version: number;
  sortOrder: number;
  config: GuestBuildingTypeConfigSpec;
}

export interface GuestDesignIssue {
  /** Dotted path into the design, e.g. `building.span`, `openings.1.offset`, `colours.walls`. */
  path: string;
  message: string;
}

/** The places inside the page's own limits that the price book does not state (Q4, Q6). */
export type GuestReviewFlag = 'pitch' | 'bay' | 'span';

export interface GuestSiteEstimate {
  buildingClass: '10a';
  enclosure: GuestEnclosure;
  importanceLevel: 2;
  /** `null` when the address is near a boundary or could not be placed. */
  region: GuestWindRegion | null;
  /** Design wind speed, m/s. Only filled when a citable source states it (S2). */
  windSpeedMs?: number;
}

// ---------------------------------------------------------------- defaults

/** Sill of a guest window, mm. Same as `DEFAULT_OPENING_BY_TYPE.window.sill`. */
export const GUEST_WINDOW_SILL = 900;

const PA_SIZE = { width: 820, height: 2040 };

const ALL_COLOURS = Object.keys(COLORBOND);

const DEFAULT_COLOURS: GuestColourChoice = {
  walls: 'Shale Grey',
  roof: 'Surfmist',
  trim: { barge: 'Surfmist', gutter: 'Surfmist', downpipe: 'Surfmist' },
};

/** Gable pitch chips (customer gap #8). The book's params 2 allow 7.5–30°. */
export const GABLE_PITCHES = [10, 15, 20, 25, 30] as const;

/**
 * Skillion pitch chips (Q4). 5° is below the book's 7.5° minimum for Skillion S4, so a 5°
 * design carries a `review` flag rather than being blocked.
 */
export const SKILLION_PITCHES = [5, 10] as const;

/** The book's own limits (`view_system_shed_parameters`, all six rows, checked 2026-11-19). */
export const BOOK_SPAN_MM: GuestRange = { min: 1800, max: 15000 };
export const BOOK_HEIGHT_MM: GuestRange = { min: 2200, max: 6000 };
export const BOOK_BAY_MM: GuestRange = { min: 1000, max: 4000 };
/** The largest bay the book will still price. Above it, an estimator has to look (Q6). */
export const BOOK_MAX_BAY_MM = 4000;
/** The lowest pitch the book states for a skillion. Below it → `review` (Q4). */
export const BOOK_MIN_SKILLION_PITCH_DEG = 7.5;

const BAY_COUNT: GuestRange = { min: 1, max: 12 };

/**
 * Door and window chips for an enclosed building (spec ③: roller 0–3, PA 0–2, sliding 0–2,
 * window 0–4).
 *
 * Whether the price book's catalogue holds each size is **not yet checked** — an estimator
 * prices the request and the guest never sees a price, so a size the catalogue lacks is a
 * pricing question, not a page error.
 */
const ENCLOSED_RULES: GuestOpeningRuleSpec[] = [
  {
    type: 'roller_door',
    max: 3,
    sizes: [
      { width: 3000, height: 2100 },
      { width: 2400, height: 2100 },
      { width: 3600, height: 2400 },
    ],
    defaultWall: 'front',
  },
  { type: 'pa_door', max: 2, sizes: [PA_SIZE], defaultWall: 'left' },
  {
    type: 'sliding_door',
    max: 2,
    sizes: [
      { width: 2400, height: 2400 },
      { width: 1800, height: 2100 },
    ],
    defaultWall: 'left',
  },
  {
    type: 'window',
    max: 4,
    sizes: [
      { width: 900, height: 900 },
      { width: 1200, height: 900 },
    ],
    defaultWall: 'right',
  },
];

/**
 * Chips for the large enclosed types (industrial, arena, hangar). The widest roller-door size
 * is 5100 × 3600, which is the catalogue's tallest wide opening (see `presets.ts`).
 */
const LARGE_ENCLOSED_RULES: GuestOpeningRuleSpec[] = [
  {
    type: 'roller_door',
    max: 4,
    sizes: [
      { width: 5100, height: 3600 },
      { width: 4200, height: 3600 },
      { width: 3000, height: 2100 },
    ],
    defaultWall: 'front',
  },
  { type: 'pa_door', max: 2, sizes: [PA_SIZE], defaultWall: 'left' },
  {
    type: 'sliding_door',
    max: 2,
    sizes: [
      { width: 2400, height: 2400 },
      { width: 1800, height: 2100 },
    ],
    defaultWall: 'left',
  },
  {
    type: 'window',
    max: 4,
    sizes: [
      { width: 1200, height: 900 },
      { width: 900, height: 900 },
    ],
    defaultWall: 'right',
  },
];

/** A building spec built from a span, eave height and one bay length repeated. */
function spec(
  span: number,
  height: number,
  pitchDeg: number,
  bays: number,
  bayWidth: number,
  over: Partial<GuestBuildingSpec> = {},
): GuestBuildingSpec {
  return {
    span,
    height,
    pitchDeg,
    roof: 'gable',
    bayWidths: Array.from({ length: bays }, () => bayWidth),
    slab: 'in_slab',
    kneeBrace: 'standard',
    cladding: 'vertical',
    ...over,
  };
}

/**
 * The six building types the page offers before a super admin saves any (Q1, plan §3.1).
 *
 * **The start sizes for Industrial, Riding Arena and Aircraft Hangar are proposals** — they are
 * plausible for the building class, not values the customer confirmed. Only Garage (6.00 × 3.00
 * × 6.00) and Carport (1 × 5.90 m) come from the customer's own list.
 */
export const GUEST_DEFAULT_TYPES: readonly GuestBuildingTypeSpec[] = [
  {
    id: 'garage',
    name: 'Garage',
    description: 'A gable-roof garage for one or two cars.',
    version: 0,
    sortOrder: 10,
    config: {
      basePreset: 'domestic_garage',
      icon: 'garage',
      mode: 'design',
      enclosure: 'enclosed',
      roofs: ['gable', 'skillion'],
      start: spec(6000, 3000, 10, 2, 3000),
      limits: {
        span: BOOK_SPAN_MM,
        height: BOOK_HEIGHT_MM,
        bayWidth: BOOK_BAY_MM,
        bays: BAY_COUNT,
        pitchesByRoof: { gable: [...GABLE_PITCHES], skillion: [...SKILLION_PITCHES] },
      },
      openings: {
        rules: ENCLOSED_RULES,
        defaults: [{ type: 'roller_door', wall: 'front', offset: 1500, size: { width: 3000, height: 2100 } }],
      },
      colours: { defaults: DEFAULT_COLOURS, allowed: ALL_COLOURS },
    },
  },
  {
    id: 'industrial',
    name: 'Industrial Building',
    description: 'A large enclosed workshop or storage building.',
    version: 0,
    sortOrder: 20,
    config: {
      basePreset: 'farm_machinery',
      icon: 'industrial',
      mode: 'design',
      enclosure: 'enclosed',
      roofs: ['gable', 'skillion'],
      start: spec(12000, 4500, 10, 4, 3000),
      limits: {
        span: BOOK_SPAN_MM,
        height: BOOK_HEIGHT_MM,
        bayWidth: BOOK_BAY_MM,
        bays: BAY_COUNT,
        pitchesByRoof: { gable: [...GABLE_PITCHES], skillion: [...SKILLION_PITCHES] },
      },
      openings: {
        rules: LARGE_ENCLOSED_RULES,
        defaults: [{ type: 'roller_door', wall: 'front', offset: 3450, size: { width: 5100, height: 3600 } }],
      },
      colours: { defaults: DEFAULT_COLOURS, allowed: ALL_COLOURS },
    },
  },
  {
    id: 'riding_arena',
    name: 'Riding Arena',
    description: 'A wide-span covered arena.',
    version: 0,
    sortOrder: 30,
    config: {
      basePreset: 'farm_machinery',
      icon: 'arena',
      mode: 'design',
      enclosure: 'enclosed',
      roofs: ['gable'],
      start: spec(15000, 4500, 10, 8, 3750),
      limits: {
        span: BOOK_SPAN_MM,
        height: BOOK_HEIGHT_MM,
        bayWidth: BOOK_BAY_MM,
        bays: BAY_COUNT,
        pitchesByRoof: { gable: [...GABLE_PITCHES], skillion: [...SKILLION_PITCHES] },
      },
      openings: {
        rules: LARGE_ENCLOSED_RULES,
        defaults: [{ type: 'roller_door', wall: 'front', offset: 4950, size: { width: 5100, height: 3600 } }],
      },
      colours: { defaults: DEFAULT_COLOURS, allowed: ALL_COLOURS },
    },
  },
  {
    id: 'aircraft_hangar',
    name: 'Aircraft Hangar',
    description: 'A tall wide-span hangar with a large door.',
    version: 0,
    sortOrder: 40,
    config: {
      basePreset: 'aircraft_hangar',
      icon: 'hangar',
      mode: 'design',
      enclosure: 'enclosed',
      roofs: ['gable'],
      start: spec(15000, 4500, 10, 4, 3000),
      limits: {
        span: BOOK_SPAN_MM,
        height: BOOK_HEIGHT_MM,
        bayWidth: BOOK_BAY_MM,
        bays: BAY_COUNT,
        pitchesByRoof: { gable: [...GABLE_PITCHES], skillion: [...SKILLION_PITCHES] },
      },
      openings: {
        rules: LARGE_ENCLOSED_RULES,
        defaults: [{ type: 'roller_door', wall: 'front', offset: 4950, size: { width: 5100, height: 3600 } }],
      },
      colours: { defaults: DEFAULT_COLOURS, allowed: ALL_COLOURS },
    },
  },
  {
    id: 'carport',
    name: 'Carport',
    description: 'An open gable carport — a roof on posts, no walls.',
    version: 0,
    sortOrder: 50,
    config: {
      basePreset: 'open_carport',
      icon: 'carport',
      mode: 'design',
      enclosure: 'roof_only',
      roofs: ['gable', 'skillion'],
      // Q6: the customer's 1 × 5.90 m. The book states no bay limit for a carport, and the
      // desktop falls back to 4 000 mm (`ServiceStructureData.cs:313`), so a 5.9 m bay carries
      // a `bay` review flag instead of being blocked.
      start: { ...spec(6000, 3000, 10, 1, 5900), slab: 'footing_only' },
      limits: {
        span: BOOK_SPAN_MM,
        height: BOOK_HEIGHT_MM,
        bayWidth: { min: BOOK_BAY_MM.min, max: 6000 },
        bays: BAY_COUNT,
        pitchesByRoof: { gable: [...GABLE_PITCHES], skillion: [...SKILLION_PITCHES] },
      },
      openings: {
        rules: [],
        defaults: [],
        lockedReason: 'Carports are open — no doors or windows.',
      },
      colours: { defaults: DEFAULT_COLOURS, allowed: ALL_COLOURS },
    },
  },
  {
    id: 'house',
    name: 'Class 1 House',
    description: "We'll contact you to discuss your project.",
    version: 0,
    sortOrder: 60,
    config: {
      // Never used for geometry: `mode: 'enquiry'` skips the designer entirely. The preset is
      // named because the shape requires one, not because a house is designed here.
      basePreset: 'domestic_garage',
      icon: 'house',
      mode: 'enquiry',
      enclosure: 'enclosed',
      roofs: ['gable'],
      start: spec(6000, 3000, 10, 2, 3000),
      limits: {
        span: BOOK_SPAN_MM,
        height: BOOK_HEIGHT_MM,
        bayWidth: BOOK_BAY_MM,
        bays: BAY_COUNT,
        pitchesByRoof: { gable: [...GABLE_PITCHES], skillion: [...SKILLION_PITCHES] },
      },
      openings: { rules: [], defaults: [] },
      colours: { defaults: DEFAULT_COLOURS, allowed: ALL_COLOURS },
    },
  },
];

/** The default type with this id, or `undefined` when a saved type was since deleted. */
export function guestTypeById(id: string): GuestBuildingTypeSpec | undefined {
  return GUEST_DEFAULT_TYPES.find((t) => t.id === id);
}

// ---------------------------------------------------------------- conversion

/** The design a guest starts from after picking `type`. */
export function guestDesignFromType(type: GuestBuildingTypeSpec, site?: GuestSite): GuestDesignInput {
  const c = type.config;
  return {
    v: 2,
    typeId: type.id,
    typeVersion: type.version,
    ...(site === undefined ? {} : { site }),
    building: { ...c.start, bayWidths: [...c.start.bayWidths] },
    openings: c.openings.defaults.map((o) => ({ ...o, size: { ...o.size } })),
    colours: { ...c.colours.defaults, trim: { ...c.colours.defaults.trim } },
  };
}

/** Building length, mm — the sum of the bays. */
export function guestLengthMm(building: GuestBuildingSpec): number {
  return building.bayWidths.reduce((sum, w) => sum + w, 0);
}

/** The engine structure a roof choice means for a type (plan §3.1). */
export function guestStructureType(type: GuestBuildingTypeSpec, roof: GuestRoof): StructureType {
  if (type.id === 'aircraft_hangar') return 'aircraft_hangar';
  if (type.config.enclosure === 'roof_only') {
    return roof === 'skillion' ? 'skillion_carport' : 'gable_carport';
  }
  return roof === 'skillion' ? 'skillion' : 'gable';
}

/** A guest opening as an engine `Opening`, positioned by offset (`align: 'custom'`). */
function toOpening(o: GuestOpeningSpec, index: number): Opening {
  return {
    id: `guest-${index + 1}`,
    type: o.type,
    width: o.size.width,
    height: o.size.height,
    sill: o.type === 'window' ? GUEST_WINDOW_SILL : 0,
    wall: o.wall,
    align: 'custom',
    offset: o.offset,
    swing: o.type === 'pa_door' ? 'outward' : null,
    track: o.type === 'sliding_door' ? 'none' : null,
    leaves: o.type === 'sliding_door' ? 1 : null,
    hinge: o.type === 'pa_door' ? 'left' : null,
  };
}

/** A COLORBOND name as hex, or `fallback` for a name the palette does not hold. */
function hex(name: string, fallback: string): string {
  return COLORBOND[name] ?? fallback;
}

/** Horizontal cladding is one option per wall, spanning floor to eave (spec ③, gap #11). */
function claddingOptions(building: GuestBuildingSpec): ShedConfig['options'] {
  if (building.cladding !== 'horizontal') return [];
  const walls: WallSide[] = ['front', 'back', 'left', 'right'];
  return walls.map((wall, i) => ({
    id: `guest-hc-${i + 1}`,
    kind: 'horizontal_cladding' as const,
    wall,
    from: 0,
    to: building.height,
  }));
}

/**
 * The guest's design as a whole `ShedConfig`: the type's base preset, with the guest's size,
 * openings, colours and state laid over it. Door and window colours stay the preset's — a
 * guest does not choose them (spec ③).
 *
 * Does not validate; call `validateGuestDesign` first when the input is untrusted.
 */
export function configFromGuestDesign(design: GuestDesignInput, type: GuestBuildingTypeSpec): ShedConfig {
  const base = presetById(type.config.basePreset).config;
  const { building, colours } = design;
  const bayWidths = [...building.bayWidths];
  const config: ShedConfig = {
    ...base,
    structureType: guestStructureType(type, building.roof),
    span: building.span,
    length: guestLengthMm(building),
    height: building.height,
    roofPitchDeg: building.pitchDeg,
    bays: bayWidths.length,
    // The nominal spacing is the first bay; a mixed array is the point, so it is stored too.
    nomBaySpacing: bayWidths[0] ?? 0,
    bayWidths,
    openings: design.openings.map(toOpening),
    options: [...(base.options ?? []), ...claddingOptions(building)],
    stateCode: design.site?.state ?? base.stateCode,
    colors: {
      ...base.colors,
      wall: hex(colours.walls, base.colors.wall),
      roof: hex(colours.roof, base.colors.roof),
      barge: hex(colours.trim.barge, base.colors.barge),
      gutter: hex(colours.trim.gutter, base.colors.gutter),
      downpipe: hex(colours.trim.downpipe, base.colors.downpipe),
    },
  };
  return config;
}

// ---------------------------------------------------------------- upgrades

/** Narrow an unknown to a record, for reading a document written by an older build. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Read a saved design — v2 as-is, v1 upgraded — or `null` when it is too damaged to use.
 *
 * A returning guest's `localStorage` may hold the v1 shape (`size.bays` × `size.bayWidth`, no
 * roof). Upgrading fills the fields v1 never had with the same defaults `GUEST_DEFAULT_TYPES`
 * uses, so nothing a guest sees changes. Anything whose numbers cannot be read is dropped: a
 * broken saved design must not take the page down (`store.ts` already treats parse failure as
 * "no saved design").
 */
export function upgradeGuestDesign(raw: unknown): GuestDesignInput | null {
  const doc = asRecord(raw);
  if (doc === null) return null;

  const typeId = typeof doc.typeId === 'string' && doc.typeId !== '' ? doc.typeId : null;
  if (typeId === null) return null;
  const typeVersion = typeof doc.typeVersion === 'number' ? doc.typeVersion : 0;
  const openings = Array.isArray(doc.openings) ? (doc.openings as GuestOpeningSpec[]) : [];
  const colours = asRecord(doc.colours) as GuestColourChoice | null;
  if (colours === null) return null;
  const site = asRecord(doc.site) === null ? undefined : (doc.site as GuestSite);

  if (doc.v === 2) {
    const building = asRecord(doc.building);
    if (building === null) return null;
    const bayWidths = Array.isArray(building.bayWidths)
      ? building.bayWidths.map(finitePositive).filter((w): w is number => w !== null)
      : [];
    const span = finitePositive(building.span);
    const height = finitePositive(building.height);
    const pitchDeg = typeof building.pitchDeg === 'number' ? building.pitchDeg : null;
    if (bayWidths.length === 0 || span === null || height === null || pitchDeg === null) return null;
    return {
      v: 2,
      typeId,
      typeVersion,
      ...(site === undefined ? {} : { site }),
      building: {
        span,
        height,
        pitchDeg,
        roof: building.roof === 'skillion' ? 'skillion' : 'gable',
        bayWidths,
        slab:
          building.slab === 'on_slab' || building.slab === 'footing_only' ? building.slab : 'in_slab',
        kneeBrace: building.kneeBrace === 'none_if_possible' ? 'none_if_possible' : 'standard',
        cladding: building.cladding === 'horizontal' ? 'horizontal' : 'vertical',
      },
      openings,
      colours,
    };
  }

  // v1: `{ v: 1, size: { span, height, pitchDeg, bays, bayWidth } }`.
  if (doc.v !== 1) return null;
  const size = asRecord(doc.size);
  if (size === null) return null;
  const span = finitePositive(size.span);
  const height = finitePositive(size.height);
  const pitchDeg = typeof size.pitchDeg === 'number' ? size.pitchDeg : null;
  const bays = finitePositive(size.bays);
  const bayWidth = finitePositive(size.bayWidth);
  if (span === null || height === null || pitchDeg === null || bays === null || bayWidth === null) {
    return null;
  }
  return {
    v: 2,
    typeId,
    typeVersion,
    ...(site === undefined ? {} : { site }),
    building: {
      span,
      height,
      pitchDeg,
      // v1 had no roof switch; the old `skillion` type was a skillion, everything else a gable.
      roof: size.pitchDeg !== null && typeId === 'skillion' ? 'skillion' : 'gable',
      bayWidths: Array.from({ length: Math.max(1, Math.round(bays)) }, () => Math.round(bayWidth)),
      slab: 'in_slab',
      kneeBrace: 'standard',
      cladding: 'vertical',
    },
    openings,
    colours,
  };
}

// ---------------------------------------------------------------- bay edits

/**
 * Bay operations, pure: each returns a new design and never mutates its argument.
 *
 * Openings are carried unchanged. A bay edit that leaves a door hanging off the end of a wall is
 * reported by `validateGuestDesign` (which runs `placeOpening`), so the page can mark that door;
 * silently deleting it instead would lose work the guest did not ask to lose.
 */

function withBuilding(design: GuestDesignInput, building: GuestBuildingSpec): GuestDesignInput {
  return { ...design, building };
}

/** Add a bay, copying the neighbour's length, so a mixed design stays visually continuous. */
export function addBay(design: GuestDesignInput, type: GuestBuildingTypeSpec, atIndex?: number): GuestDesignInput {
  const widths = [...design.building.bayWidths];
  if (widths.length >= type.config.limits.bays.max) return design;
  const at = atIndex === undefined ? widths.length : Math.min(Math.max(0, atIndex), widths.length);
  const copyFrom = widths[Math.max(0, at - 1)] ?? type.config.start.bayWidths[0] ?? BOOK_BAY_MM.min;
  widths.splice(at, 0, copyFrom);
  return withBuilding(design, { ...design.building, bayWidths: widths });
}

/** Set one bay's length, rounded to whole millimetres. Out-of-range values are kept for validation to report. */
export function setBayWidth(design: GuestDesignInput, index: number, mm: number): GuestDesignInput {
  if (!Number.isFinite(mm)) return design;
  if (index < 0 || index >= design.building.bayWidths.length) return design;
  const widths = [...design.building.bayWidths];
  widths[index] = Math.round(mm);
  return withBuilding(design, { ...design.building, bayWidths: widths });
}

/** Remove a bay, unless that would go below the type's minimum count. */
export function removeBay(design: GuestDesignInput, index: number): GuestDesignInput {
  const widths = design.building.bayWidths;
  if (widths.length <= 1) return design;
  if (index < 0 || index >= widths.length) return design;
  const next = widths.filter((_, i) => i !== index);
  return withBuilding(design, { ...design.building, bayWidths: next });
}

/**
 * Switch the roof. Changing gable ↔ skillion changes the engine structure, so the pitch is
 * re-picked from the new roof's chips when the current one is not offered (plan §3.1).
 */
export function setRoof(design: GuestDesignInput, type: GuestBuildingTypeSpec, roof: GuestRoof): GuestDesignInput {
  if (!type.config.roofs.includes(roof)) return design;
  const pitches = type.config.limits.pitchesByRoof[roof];
  const keep = pitches.some((p) => Math.abs(p - design.building.pitchDeg) < 1e-6);
  const pitchDeg = keep ? design.building.pitchDeg : (pitches[0] ?? design.building.pitchDeg);
  return withBuilding(design, { ...design.building, roof, pitchDeg });
}

// ---------------------------------------------------------------- review flags

/**
 * Places inside the page's own limits that the price book does not state.
 *
 * These do **not** block sending (Q4, Q6). They travel to the estimator as
 * `guest_requests.review_flags` and show on the page as "Needs estimator check".
 */
export function guestReviewFlags(design: GuestDesignInput, type: GuestBuildingTypeSpec): GuestReviewFlag[] {
  if (type.config.mode === 'enquiry') return [];
  const flags: GuestReviewFlag[] = [];
  const { building } = design;

  if (building.roof === 'skillion' && building.pitchDeg < BOOK_MIN_SKILLION_PITCH_DEG) {
    flags.push('pitch');
  }
  if (building.bayWidths.some((w) => w > BOOK_MAX_BAY_MM)) {
    flags.push('bay');
  }
  // No type currently allows a span above the book's maximum, so this cannot fire today. It is
  // part of the union because the rule needs one home the day a type allows more.
  if (building.span > BOOK_SPAN_MM.max) {
    flags.push('span');
  }
  return flags;
}

// ---------------------------------------------------------------- admin: type checks

/**
 * Every way a building type is internally inconsistent; empty when it is sound.
 *
 * ## Why this exists beside the zod schema
 *
 * `guestBuildingTypeConfigSchema` in `@sq/contracts` checks each field on its own — a range is a
 * range, a roof is a roof. It cannot say "the starting pitch is not one of the pitches this roof
 * offers" or "a default door is on a wall it does not fit", because those compare fields to each
 * other and to the placement rules. Those are the mistakes an admin form makes, and they would
 * otherwise reach the Guest page as a type whose first render is broken.
 *
 * ## How
 *
 * The type's own start values are turned into a design (`guestDesignFromType`) and put through
 * `validateGuestDesign` — the same function the page and the send route use (A13), so a type that
 * passes here is one a guest can actually design with. Two structural checks are added that the
 * design check cannot see: a roof with no pitch chips, and a roof the type does not offer.
 *
 * `mode: 'enquiry'` has no geometry (Q1: Class 1 House), so only the structural checks apply.
 */
export function checkGuestBuildingType(type: GuestBuildingTypeSpec): string[] {
  const issues: string[] = [];
  const c = type.config;

  const roofOffered = c.roofs.includes(c.start.roof);
  if (!roofOffered) {
    issues.push(`The starting roof "${c.start.roof}" is not one of ${c.roofs.join(', ')}.`);
  }
  for (const roof of c.roofs) {
    if ((c.limits.pitchesByRoof[roof] ?? []).length === 0) {
      issues.push(`A ${roof} roof is offered but has no pitch to choose from.`);
    }
  }

  if (c.mode === 'enquiry') return issues;

  /*
   * The start design, checked by the page's own rules. `guestDesignFromType` copies the start values
   * verbatim, so anything wrong with them shows up here rather than on a guest's first screen.
   *
   * A roof the type does not offer is already reported above in the operator's words; the design
   * check would say the same thing a second time, so that one path is dropped here.
   */
  const start = guestDesignFromType(type);
  for (const issue of validateGuestDesign(start, type)) {
    if (!roofOffered && issue.path === 'building.roof') continue;
    issues.push(`${issue.path}: ${issue.message}`);
  }
  return issues;
}

/**
 * Places where the type's limits go beyond what the price book states.
 *
 * These are **warnings, not errors** (Q2): the operator may deliberately offer a wider building than
 * the book prices, and `guestReviewFlags` already marks such a request for an estimator. The form
 * shows them in amber next to the field; nothing refuses the save.
 */
export function bookWarnings(type: GuestBuildingTypeSpec): string[] {
  const warnings: string[] = [];
  const { limits, mode, roofs } = type.config;
  if (mode === 'enquiry') return warnings;

  const beyond = (label: string, range: GuestRange, book: GuestRange) => {
    if (range.min < book.min || range.max > book.max) {
      warnings.push(
        `${label} ${metres(range.min)}–${metres(range.max)} goes beyond the price book's ` +
          `${metres(book.min)}–${metres(book.max)}; requests outside it will be flagged for the estimator.`,
      );
    }
  };
  beyond('Width', limits.span, BOOK_SPAN_MM);
  beyond('Height', limits.height, BOOK_HEIGHT_MM);
  beyond('Bay width', limits.bayWidth, BOOK_BAY_MM);

  if (roofs.includes('skillion')) {
    const low = (limits.pitchesByRoof.skillion ?? []).filter((p) => p < BOOK_MIN_SKILLION_PITCH_DEG);
    if (low.length > 0) {
      warnings.push(
        `A skillion pitch of ${low.join(', ')}° is below the book's ${BOOK_MIN_SKILLION_PITCH_DEG}° minimum; ` +
          'such a design will be flagged for the estimator.',
      );
    }
  }
  return warnings;
}

/** `1800` → `1.8 m`, for the warning sentences above. */
function metres(mm: number): string {
  return `${Number((mm / 1000).toFixed(2))} m`;
}

// ---------------------------------------------------------------- site estimate

/**
 * The wind/hazard line the page shows under the address (Q3, "Indicative — confirmed in your
 * quote").
 *
 * `region` comes from `estimateWindRegion` (S2) and is `null` near a boundary. A Class 1 House
 * is not a Class 10a building, so an enquiry gets no estimate at all.
 */
export function guestSiteEstimate(input: {
  region: GuestWindRegion | null;
  enclosure: GuestEnclosure;
  mode: GuestTypeMode;
}): GuestSiteEstimate | null {
  if (input.mode === 'enquiry') return null;
  return {
    buildingClass: '10a',
    enclosure: input.enclosure,
    importanceLevel: 2,
    region: input.region,
  };
}

// ---------------------------------------------------------------- validation

const LABEL: Record<GuestOpeningKind, string> = {
  roller_door: 'roller door',
  pa_door: 'personal-access door',
  sliding_door: 'sliding door',
  window: 'window',
};

function inRange(value: number, r: GuestRange): boolean {
  return value >= r.min && value <= r.max;
}

/** The step the nearest-legal-spot search moves in, mm — the plan's snap grid. */
export const GUEST_SNAP_MM = 50;

/**
 * The legal offset for `spec`, as opening `index` of `design`, nearest to `wanted` (mm from the
 * wall's start); or why there is none.
 *
 * `wanted` is tried first (clamped onto the wall), then ±50 mm steps outward, each checked with
 * `placeOpening` against the engine's margins and the other openings. One rule for every way an
 * opening is placed — the page's add button, a drag, and the assistant's `addOpening` /
 * `moveOpening`. The assistant used to write `offset: 0` when it named no position, which is flush
 * against the corner post: the door was "added" but failed the check and was not drawn (2026-11-20).
 */
export function nearestLegalGuestOffset(
  design: GuestDesignInput,
  type: GuestBuildingTypeSpec,
  index: number,
  spec: GuestOpeningSpec,
  wanted: number,
): { ok: true; offset: number } | { ok: false; reason: string } {
  const openings = design.openings.slice();
  openings[index] = spec;
  const shed = withDimensions(configFromGuestDesign({ ...design, openings }, type));
  if (shed === null) return { ok: false, reason: 'Fix the building size first.' };

  const run = wallLength(shed, spec.wall);
  const max = run - spec.size.width;
  const at = (offset: number) => placeOpening(toOpening({ ...spec, offset: Math.round(offset) }, index), shed);

  const first = at(Math.min(Math.max(wanted, 0), Math.max(max, 0)));
  if (first.ok) return { ok: true, offset: first.opening.offset ?? 0 };
  if ('reason' in first) return { ok: false, reason: first.reason };
  if (max < 0) return { ok: false, reason: 'It is wider than this wall.' };

  for (let d = GUEST_SNAP_MM; d <= run; d += GUEST_SNAP_MM) {
    for (const u of [wanted - d, wanted + d]) {
      if (u < 0 || u > max) continue;
      const tried = at(u);
      if (tried.ok) return { ok: true, offset: tried.opening.offset ?? 0 };
    }
  }
  return { ok: false, reason: `There is no room for it on the ${spec.wall} wall.` };
}

/** Where an opening `width` wide starts when centred on `wall` of `design`, or `null` while the size is unusable. */
export function centredGuestOffset(
  design: GuestDesignInput,
  type: GuestBuildingTypeSpec,
  wall: WallSide,
  width: number,
): number | null {
  const shed = withDimensions(configFromGuestDesign(design, type));
  if (shed === null) return null;
  return Math.round((wallLength(shed, wall) - width) / 2 / GUEST_SNAP_MM) * GUEST_SNAP_MM;
}

/** Resize opening `index` to `size`, keeping its centre if that is legal, else the nearest legal spot. */
export function resizeGuestOpening(
  design: GuestDesignInput,
  type: GuestBuildingTypeSpec,
  index: number,
  size: { width: number; height: number },
): { ok: true; design: GuestDesignInput } | { ok: false; reason: string } {
  const spec = design.openings[index];
  if (spec === undefined) return { ok: false, reason: 'That opening no longer exists.' };
  const next: GuestOpeningSpec = { ...spec, size: { ...size } };
  const wanted = Math.round((spec.offset + (spec.size.width - size.width) / 2) / GUEST_SNAP_MM) * GUEST_SNAP_MM;
  const fit = nearestLegalGuestOffset(design, type, index, next, wanted);
  const place = (offset: number) => ({
    ok: true as const,
    design: { ...design, openings: design.openings.map((o, i) => (i === index ? { ...next, offset } : o)) },
  });
  if (fit.ok) return place(fit.offset);
  // Nothing can be judged while the building size is unusable: take the size, keep the position.
  if (fit.reason === 'Fix the building size first.') return place(spec.offset);
  return fit;
}

/**
 * After the building changes size, slide each opening (in order) to the nearest legal spot.
 *
 * `stuck` lists the openings that fit nowhere on their wall; they stay where they were, so
 * `validateGuestDesign` still reports them. While the building size is unusable nothing is judged.
 */
export function refitGuestOpenings(
  design: GuestDesignInput,
  type: GuestBuildingTypeSpec,
): { design: GuestDesignInput; stuck: number[] } {
  let next = design;
  const stuck: number[] = [];
  for (let i = 0; i < design.openings.length; i++) {
    const spec = next.openings[i]!;
    const fit = nearestLegalGuestOffset(next, type, i, spec, spec.offset);
    if (fit.ok) {
      if (fit.offset !== spec.offset) {
        next = { ...next, openings: next.openings.map((o, j) => (j === i ? { ...spec, offset: fit.offset } : o)) };
      }
    } else if (fit.reason === 'Fix the building size first.') {
      return { design, stuck: [] };
    } else {
      stuck.push(i);
    }
  }
  return { design: next, stuck };
}

/**
 * Every way `design` breaks the rules of `type`; empty when it fits.
 *
 * Checks the size window, each bay length and the bay count, the roof and its pitch chips, the
 * opening types, counts and size chips, that every opening sits on its wall with the engine's
 * margins and overlaps no other (`placeOpening` R1/R2/R10), that it is no taller than the eave,
 * and that each colour is one the type offers.
 *
 * A **`mode: 'enquiry'`** type is not designed here at all (Q1: Class 1 House), so it has no
 * size, opening or colour rules to break: the request carries contact details and a note.
 *
 * Infill columns (R3) are not checked: they come from the price book, which the page cannot
 * read. The estimator who prices the request sees the design in the full editor.
 */
export function validateGuestDesign(design: GuestDesignInput, type: GuestBuildingTypeSpec): GuestDesignIssue[] {
  if (type.config.mode === 'enquiry') {
    return design.typeId === type.id ? [] : [{ path: 'typeId', message: `This design is for "${design.typeId}", not "${type.id}".` }];
  }

  const issues: GuestDesignIssue[] = [];
  const push = (path: string, message: string) => issues.push({ path, message });
  const { limits, openings: openingRules, colours: colourRules } = type.config;
  const { building } = design;

  if (design.typeId !== type.id) push('typeId', `This design is for "${design.typeId}", not "${type.id}".`);

  if (!inRange(building.span, limits.span)) {
    push('building.span', `Width must be between ${limits.span.min} and ${limits.span.max} mm.`);
  }
  if (!inRange(building.height, limits.height)) {
    push('building.height', `Height must be between ${limits.height.min} and ${limits.height.max} mm.`);
  }
  if (!type.config.roofs.includes(building.roof)) {
    push('building.roof', `A ${building.roof} roof is not offered on this building.`);
  }
  const pitches = limits.pitchesByRoof[building.roof] ?? [];
  if (!pitches.some((p) => Math.abs(p - building.pitchDeg) < 1e-6)) {
    push('building.pitchDeg', `Roof pitch must be one of ${pitches.join(', ')}°.`);
  }

  const widths = building.bayWidths;
  if (!Number.isInteger(widths.length) || !inRange(widths.length, limits.bays)) {
    push(
      'building.bayWidths',
      `The building needs between ${limits.bays.min} and ${limits.bays.max} bays.`,
    );
  }
  widths.forEach((w, i) => {
    if (!inRange(w, limits.bayWidth)) {
      push(
        `building.bayWidths.${i}`,
        `Bay ${i + 1} must be between ${limits.bayWidth.min} and ${limits.bayWidth.max} mm.`,
      );
    }
  });

  // Opening types, counts and size chips.
  if (openingRules.rules.length === 0 && design.openings.length > 0) {
    push('openings', openingRules.lockedReason ?? 'This building type takes no doors or windows.');
  }
  const counts = new Map<GuestOpeningKind, number>();
  design.openings.forEach((o, i) => {
    const rule = openingRules.rules.find((r) => r.type === o.type);
    if (rule === undefined) {
      if (openingRules.rules.length > 0) push(`openings.${i}.type`, `A ${LABEL[o.type]} is not offered on this building.`);
      return;
    }
    const n = (counts.get(o.type) ?? 0) + 1;
    counts.set(o.type, n);
    if (n === rule.max + 1) push(`openings.${i}.type`, `At most ${rule.max} × ${LABEL[o.type]}.`);
    if (!rule.sizes.some((s) => s.width === o.size.width && s.height === o.size.height)) {
      push(`openings.${i}.size`, `That ${LABEL[o.type]} size is not one of the offered sizes.`);
    }
    const top = (o.type === 'window' ? GUEST_WINDOW_SILL : 0) + o.size.height;
    if (top > building.height) {
      push(`openings.${i}.size`, `The ${LABEL[o.type]} is taller than the ${building.height} mm walls.`);
    }
  });

  // Position on the wall, against the engine's placement rules — only once the building is sane,
  // or every opening would also report the size error in a second voice.
  const sizeOk = !issues.some((x) => x.path.startsWith('building.'));
  if (sizeOk && design.openings.length > 0) {
    const shed = withDimensions(configFromGuestDesign(design, type));
    if (shed !== null) {
      shed.openings.forEach((opening, i) => {
        const result = placeOpening(opening, shed);
        if (result.ok) return;
        const message =
          'reason' in result
            ? result.reason
            : `The ${LABEL[design.openings[i]!.type]} no longer fits on the ${design.openings[i]!.wall} wall. Move it to another wall or remove it.`;
        push(`openings.${i}.offset`, message);
      });
    }
  }

  // Colours: offered by the type and known to the palette.
  const colourPaths: [string, string][] = [
    ['colours.walls', design.colours.walls],
    ['colours.roof', design.colours.roof],
    ['colours.trim.barge', design.colours.trim.barge],
    ['colours.trim.gutter', design.colours.trim.gutter],
    ['colours.trim.downpipe', design.colours.trim.downpipe],
  ];
  for (const [path, name] of colourPaths) {
    if (!colourRules.allowed.includes(name) || COLORBOND[name] === undefined) {
      push(path, `"${name}" is not one of the colours offered.`);
    }
  }

  return issues;
}
