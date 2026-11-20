/**
 * The Guest quote page (`apps/site` `/quote`) — every shape it sends or receives.
 *
 * Spec: docs/specs/quote-tiers-guest.md. Plan: docs/plans/quote-tiers-guest-ga.md.
 *
 * ## No prices, on purpose
 *
 * A guest never sees a price (D-T3 / G2). Nothing in this file carries a cent value, so a
 * front-end that only imports these shapes cannot render one by accident.
 *
 * ## Who decides validity
 *
 * These schemas check **shape**: types, lengths, ranges that hold for every building type.
 * Whether a design fits the building type the guest chose (its size limits, which doors it
 * allows, whether two doors overlap) is decided by `validateGuestDesign` in `@sq/core/domain`,
 * which the page and the API both call (A13).
 */

import { z } from 'zod';
import {
  PRESET_IDS,
  type GuestBuildingSpec as CoreGuestBuildingSpec,
  type GuestBuildingTypeSpec,
  type GuestDesignInput,
  type GuestReviewFlag as CoreGuestReviewFlag,
  type GuestSiteEstimate as CoreGuestSiteEstimate,
} from '@sq/core/domain';

// ---------------------------------------------------------------- primitives

/** The opening types a guest may place. `opening` (a plain hole) is an estimator's choice. */
export const GUEST_OPENING_TYPES = ['roller_door', 'pa_door', 'sliding_door', 'window'] as const;
export const guestOpeningTypeSchema = z.enum(GUEST_OPENING_TYPES);
export type GuestOpeningType = z.infer<typeof guestOpeningTypeSchema>;

export const guestWallSchema = z.enum(['front', 'back', 'left', 'right']);

export const AU_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const;
export const auStateSchema = z.enum(AU_STATES);

/** Millimetres. The upper bound is a sanity cap, not a building rule. */
const mm = z.number().int().min(0).max(100_000);

/** A COLORBOND colour **name** (not a hex). Membership is checked against the type's list. */
const colourName = z.string().trim().min(1).max(40);

export const guestIconSchema = z.enum([
  'shed',
  'garage',
  'carport',
  'skillion',
  'industrial',
  'arena',
  'hangar',
  'house',
]);

export const guestRoofSchema = z.enum(['gable', 'skillion']);
export const guestSlabSchema = z.enum(['in_slab', 'on_slab', 'footing_only']);
export const guestKneeBraceSchema = z.enum(['standard', 'none_if_possible']);
export const guestCladdingSchema = z.enum(['vertical', 'horizontal']);
export const guestTypeModeSchema = z.enum(['design', 'enquiry']);
export const guestEnclosureSchema = z.enum(['enclosed', 'roof_only']);
export const guestWindRegionSchema = z.enum(['A', 'B', 'C', 'D']);

// ---------------------------------------------------------------- design

export const guestSiteSchema = z
  .object({
    suburb: z.string().trim().min(1).max(80),
    state: auStateSchema,
    postcode: z.string().regex(/^\d{4}$/, 'Postcode is four digits'),
    street: z.string().trim().max(120).optional(),
    /**
     * Google place ID of the address the guest picked, if they used the suggestions.
     * Google's policy allows a place ID to be stored indefinitely; nothing else from a
     * Places response is kept (plan G-a §3).
     */
    placeId: z.string().max(300).optional(),
  })
  .strict();

/**
 * One bay = one integer length in millimetres.
 *
 * The length of the building is their sum; there is deliberately no separate `length` field, so
 * the two can never disagree. A bay above the book's 4 000 mm maximum is allowed here — the
 * Carport's 5.9 m default is one (Q6) — and `guestReviewFlags` marks it for the estimator.
 */
export const guestBayWidthSchema = z.number().int().min(500).max(20_000);

const bayWidthsSchema = z.array(guestBayWidthSchema).min(1).max(12);

export const guestBuildingSpecSchema = z
  .object({
    span: mm,
    height: mm,
    pitchDeg: z.number().min(0).max(45),
    roof: guestRoofSchema,
    /** One length per bay, mm. The building's length is their sum. */
    bayWidths: bayWidthsSchema,
    /** Recorded for the estimator; never reaches the engine (`ShedConfig`). */
    slab: guestSlabSchema,
    /** A wish, not a frame choice — "No Knee Brace – If Possible". */
    kneeBrace: guestKneeBraceSchema,
    cladding: guestCladdingSchema,
  })
  .strict();
export type GuestBuildingSpec = z.infer<typeof guestBuildingSpecSchema>;

export const guestOpeningSchema = z
  .object({
    type: guestOpeningTypeSchema,
    wall: guestWallSchema,
    /** mm from the wall's left corner, seen from outside — the same convention as `Opening.offset`. */
    offset: mm,
    size: z.object({ width: mm, height: mm }).strict(),
    /** Roller doors only; ignored on the others. */
    motorised: z.boolean().optional(),
  })
  .strict();
export type GuestOpening = z.infer<typeof guestOpeningSchema>;

export const guestColoursSchema = z
  .object({
    walls: colourName,
    roof: colourName,
    trim: z.object({ barge: colourName, gutter: colourName, downpipe: colourName }).strict(),
  })
  .strict();
export type GuestColours = z.infer<typeof guestColoursSchema>;

/**
 * A guest's design, version 2. Stored as `guest_requests.design_json`.
 *
 * `site` is optional so the page can keep a half-finished design (type chosen, no address
 * yet) in the same shape; `guestRequestBody` requires it.
 *
 * Version 1 (`{ size: { span, height, pitchDeg, bays, bayWidth } }`, no roof) is **not**
 * accepted here: `upgradeGuestDesign` in `@sq/core/domain` reads an old document out of a
 * returning guest's `localStorage`, and the API takes only what that function produces.
 *
 * `extras` arrives with slice G-h. Until then the schema is strict, so a design carrying
 * extras is refused rather than silently dropped.
 */
export const guestDesignSchema = z
  .object({
    v: z.literal(2),
    typeId: z.string().min(1).max(64),
    typeVersion: z.number().int().min(0),
    site: guestSiteSchema.optional(),
    building: guestBuildingSpecSchema,
    openings: z.array(guestOpeningSchema).max(20),
    colours: guestColoursSchema,
  })
  .strict();
export type GuestDesign = z.infer<typeof guestDesignSchema>;

// ---------------------------------------------------------------- building types

const range = z
  .object({ min: mm, max: mm })
  .strict()
  .refine((r) => r.min <= r.max, 'min must not exceed max');

export const guestOpeningRuleSchema = z
  .object({
    type: guestOpeningTypeSchema,
    /** Most of this type one design may have. */
    max: z.number().int().min(0).max(10),
    /** Size chips offered for this type, mm. The first is the default. */
    sizes: z.array(z.object({ width: mm, height: mm }).strict()).min(1).max(8),
    /** Wall a newly added opening of this type goes on. */
    defaultWall: guestWallSchema,
  })
  .strict();
export type GuestOpeningRule = z.infer<typeof guestOpeningRuleSchema>;

/** The building-type template a super admin defines (spec "① Building type"). */
export const guestBuildingTypeConfigSchema = z
  .object({
    basePreset: z.enum(PRESET_IDS),
    icon: guestIconSchema,
    /** `enquiry` = take a request only, no designer (Q1: Class 1 House). */
    mode: guestTypeModeSchema,
    enclosure: guestEnclosureSchema,
    /** Roofs the type offers; the first is the default. */
    roofs: z.array(guestRoofSchema).min(1).max(2),
    start: guestBuildingSpecSchema,
    limits: z
      .object({
        span: range,
        height: range,
        bayWidth: range,
        bays: z
          .object({ min: z.number().int().min(1).max(30), max: z.number().int().min(1).max(30) })
          .strict()
          .refine((r) => r.min <= r.max, 'min must not exceed max'),
        /** Pitch chips per roof, degrees. The first of each list is that roof's default. */
        pitchesByRoof: z
          .object({
            gable: z.array(z.number().min(0).max(45)).min(1).max(8),
            skillion: z.array(z.number().min(0).max(45)).min(1).max(8),
          })
          .strict(),
      })
      .strict(),
    openings: z
      .object({
        /** Empty = this type takes no doors or windows (a carport). */
        rules: z.array(guestOpeningRuleSchema).max(4),
        /** Openings placed when the guest first picks this type. */
        defaults: z.array(guestOpeningSchema).max(10),
        /** Shown when `rules` is empty, e.g. "Carports are open — no doors or windows". */
        lockedReason: z.string().max(120).optional(),
      })
      .strict(),
    colours: z
      .object({
        defaults: guestColoursSchema,
        /** COLORBOND names the guest may choose from. */
        allowed: z.array(colourName).min(1).max(40),
      })
      .strict(),
  })
  .strict();
export type GuestBuildingTypeConfig = z.infer<typeof guestBuildingTypeConfigSchema>;

/** One card on tab ①, as `GET /public/guest/building-types` returns it. */
export const guestBuildingTypeSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(40),
    description: z.string().max(120),
    /** 0 = a core default that has never been saved to the database. */
    version: z.number().int().min(0),
    sortOrder: z.number().int(),
    config: guestBuildingTypeConfigSchema,
  })
  .strict();
export type GuestBuildingType = z.infer<typeof guestBuildingTypeSchema>;

export interface GuestBuildingTypesResponse {
  types: GuestBuildingType[];
}

// ---------------------------------------------------------------- send request

/**
 * An Australian mobile in any common spelling → E.164 (`+614xxxxxxxx`), or `null`.
 *
 * Accepts `0412 345 678`, `0412-345-678`, `+61 412 345 678`, `61412345678`. Only +61 mobiles:
 * suburb suggestions and wind regions are Australian, so NZ numbers are out (spec, open
 * questions).
 */
export function normaliseAuMobile(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, '');
  const m = /^(?:\+?61|0)(4\d{8})$/.exec(digits);
  return m === null ? null : `+61${m[1]}`;
}

export const guestContactSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    email: z.email().max(254),
    mobile: z
      .string()
      .max(30)
      .refine((v) => normaliseAuMobile(v) !== null, 'Enter an Australian mobile, e.g. 0412 345 678'),
  })
  .strict();
export type GuestContact = z.infer<typeof guestContactSchema>;

/** Campaign tags carried from the brand site's CTA link (plan G-a P16). */
export const guestSourceSchema = z
  .object({
    utm_source: z.string().max(100).optional(),
    utm_medium: z.string().max(100).optional(),
    utm_campaign: z.string().max(100).optional(),
    utm_content: z.string().max(100).optional(),
    utm_term: z.string().max(100).optional(),
  })
  .strict();

export const guestRequestBody = z
  .object({
    design: guestDesignSchema.extend({ site: guestSiteSchema }),
    contact: guestContactSchema,
    /**
     * The customer's free-text request, asked at step ① (Q2). 4 000 characters: enough for a
     * paragraph of requirements, short enough that a copied document is not the intent.
     */
    additionalRequest: z.string().max(4000).optional(),
    /**
     * The v1 name for the same field. Accepted for one release and written to the same column,
     * so a page cached in a browser mid-deploy still sends. Remove once no build sends it.
     */
    notes: z.string().max(4000).optional(),
    consent: z.literal(true),
    source: guestSourceSchema.optional(),
    /** Honeypot. Declared because the schema is strict; a filled value is answered 202 and dropped. */
    website: z.string().max(200).optional(),
    /** The signed-in guest's draft this request came from; deleted once the request is stored. */
    draftId: z.uuid().optional(),
  })
  .strict();
export type GuestRequestBody = z.infer<typeof guestRequestBody>;

/** The wind/hazard line the page shows, and what the server stores (`site_estimate_json`). */
export interface GuestSiteEstimate {
  buildingClass: '10a';
  enclosure: 'enclosed' | 'roof_only';
  importanceLevel: 2;
  region: 'A' | 'B' | 'C' | 'D' | null;
  windSpeedMs?: number;
}

/** A design place inside the page's limits that the price book does not state (Q4, Q6). */
export type GuestReviewFlag = 'pitch' | 'bay' | 'span';

export interface GuestRequestAccepted {
  /** e.g. `GR-000123`. */
  number: string;
}

// ---------------------------------------------------------------- address

export interface GuestPlacesSession {
  /** Signed session id; also Google's `sessionToken`. */
  s: string;
  expiresAt: string;
}

export interface GuestPlaceSuggestion {
  placeId: string;
  primary: string;
  secondary: string;
}

export interface GuestPlaceDetails {
  placeId: string;
  street?: string;
  suburb: string;
  state: (typeof AU_STATES)[number];
  postcode: string;
  /**
   * Wind region estimated from the place's coordinates (Q3, S2).
   *
   * `null` means the address is near a region boundary or could not be placed; the page then
   * says "Wind region confirmed in your quote". Coordinates themselves never leave the server:
   * Google's policy allows storing the place ID only, and the region is a derived value.
   */
  windRegion?: 'A' | 'B' | 'C' | 'D' | null;
}

/** A row of the price book's suburb list — the fallback when Places is off. */
export interface GuestSuburb {
  suburb: string;
  state: string;
  postcode: string;
}

/** `GET /public/guest/places/autocomplete` — at most five. */
export interface GuestPlaceSuggestionsResponse {
  suggestions: GuestPlaceSuggestion[];
}

/** `GET /public/guest/places/details` — `null` when the place is not a usable Australian site. */
export interface GuestPlaceDetailsResponse {
  details: GuestPlaceDetails | null;
}

/** `GET /public/guest/suburbs` — at most ten. */
export interface GuestSuburbsResponse {
  suburbs: GuestSuburb[];
}

// ---------------------------------------------------------------- admin: building types

/**
 * The id an admin may give a new type (Q5).
 *
 * A slug, because the id is copied into a guest's `localStorage`, into `guest_requests.design_json`
 * and into the deep link `?type=<id>` — it has to survive all three unchanged, and it is fixed once
 * the type exists.
 */
export const GUEST_TYPE_ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

/**
 * What the admin form sends to create or update a type.
 *
 * `id` is present on create and absent on update (Q5: the id never changes). `expectedVersion` is
 * present on update only, and is the optimistic lock (Q7): the server refuses with 409 when the row
 * has moved on since the form was opened. 0 is the version a code default reports (empty table).
 */
export const guestBuildingTypeWriteSchema = z
  .object({
    id: z.string().regex(GUEST_TYPE_ID_PATTERN, 'Use lowercase letters, digits and _, starting with a letter').optional(),
    name: z.string().trim().min(1).max(40),
    description: z.string().trim().max(120),
    sortOrder: z.number().int().min(-10_000).max(10_000),
    enabled: z.boolean(),
    config: guestBuildingTypeConfigSchema,
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict();
export type GuestBuildingTypeWrite = z.infer<typeof guestBuildingTypeWriteSchema>;

/** The two quick edits the list screen makes without opening the form. */
export const guestBuildingTypePatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().min(-10_000).max(10_000).optional(),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((v) => v.enabled !== undefined || v.sortOrder !== undefined, 'Send enabled or sortOrder.');
export type GuestBuildingTypePatch = z.infer<typeof guestBuildingTypePatchSchema>;

/** Reorder: the ids in the order they should appear, top first. */
export const guestBuildingTypeReorderSchema = z
  .object({ ids: z.array(z.string().min(1).max(64)).min(1).max(100) })
  .strict();

/**
 * One row of `GET /admin/guest-types`.
 *
 * `source` says where the list came from: `default` means the table is still empty and these six are
 * the code defaults, so the first save will copy them all in (Q4). `invalid` means the stored config
 * no longer parses — the Guest page is skipping that row, and the admin needs to see it rather than
 * wonder why a type vanished.
 */
export interface GuestBuildingTypeAdminRow extends GuestBuildingType {
  enabled: boolean;
  updatedAt: string | null;
  /** The email of whoever last saved it, or `null` for a seeded default. */
  updatedBy: string | null;
  source: 'database' | 'default';
  invalid?: { reason: string };
}

export interface GuestBuildingTypesAdminResponse {
  items: GuestBuildingTypeAdminRow[];
  /**
   * Where the Guest page is served, so "Open on the Guest page" needs no hard-coded port (Q8).
   * Derived by the API from `SITE_ORIGIN` / `SITE_PORT`.
   */
  siteOrigin: string;
}

/** `GET /admin/guest-types/:id` — one row, plus the checks the form shows. */
export interface GuestBuildingTypeAdminDetail {
  item: GuestBuildingTypeAdminRow;
  /** Empty when the type is internally sound; each string is shown next to its field. */
  issues: string[];
  /** Beyond the price book. Amber in the form; never blocks a save (Q2). */
  warnings: string[];
}

// ---------------------------------------------------------------- agreement with core

/**
 * `@sq/core/domain` keeps plain-TypeScript twins of the design and building-type shapes
 * (core cannot import this package). These fail to compile the moment the two drift.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type _GuestDesignAgreesWithCore = Assert<Same<GuestDesign, GuestDesignInput>>;
export type _GuestBuildingTypeAgreesWithCore = Assert<Same<GuestBuildingType, GuestBuildingTypeSpec>>;
export type _GuestBuildingSpecAgreesWithCore = Assert<Same<GuestBuildingSpec, CoreGuestBuildingSpec>>;
export type _GuestSiteEstimateAgreesWithCore = Assert<Same<GuestSiteEstimate, CoreGuestSiteEstimate>>;
export type _GuestReviewFlagAgreesWithCore = Assert<Same<GuestReviewFlag, CoreGuestReviewFlag>>;
