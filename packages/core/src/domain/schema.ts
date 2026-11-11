/**
 * Zod schemas, validation, defaults, and unit normalisation for the AI boundary.
 *
 * Two schemas are exported deliberately:
 *
 *   - `shedConfigSchema` is the *complete* `ShedConfig`: every field the domain
 *     needs, including `colors` and `displayUnit`.
 *   - `extractionSchema` is *narrower*: only the fields the LLM is asked to
 *     extract. It excludes `colors` and `displayUnit`, which are UI concerns the
 *     model must not invent. Task 8 builds the gateway request schema from this
 *     one, so with `strict: true` the model is never forced to fabricate colour
 *     hexes it was never asked for.
 *
 * `normaliseShedConfig` is the tolerant entry point: it accepts whatever the LLM
 * or a user typed and always returns a usable `ShedConfig`, falling back per
 * field rather than throwing. `coerceToMillimetres` is the metric-drift guard
 * for configs the model expressed in metres.
 *
 * Pure TypeScript: imports only `zod` and sibling domain modules. No React,
 * Next.js, Zustand, Konva, or three.
 */

import { z } from 'zod';
import { clampBays } from './bays';
import { migrateColors } from './colors';
import { DEFAULT_OPENING_SIZE, DEFAULT_SHED } from './defaults';
import { normaliseCharge } from './charges';
import { normaliseOption } from './options';
import { internalPressureFor } from './internalPressure';
import { nearestTerrainCategory, windRegionLetter } from './wind';
import type { Charge, Opening, OptionKind, ShedConfig, ShedOption } from './types';

/** The structural families the model may choose from. */
const STRUCTURE_TYPES = [
  'gable',
  'skillion',
  'gable_carport',
  'skillion_carport',
  'tophot_64',
  'tophot_96',
  'zed_shed',
  'aircraft_hangar',
  'cyclonic',
  // The book's two `is_nonstandard = 1` families. See `StructureType` in `types.ts`.
  'custom_gable',
  'custom_skillion',
] as const;

const WALL_SIDES = ['front', 'back', 'left', 'right'] as const;
const OPENING_TYPES = ['roller_door', 'pa_door', 'sliding_door', 'window', 'opening'] as const;
const ALIGN_MODES = ['center', 'left', 'right', 'custom'] as const;
const SWING_DIRECTIONS = ['inward', 'outward'] as const;

/**
 * Per-field metric-drift thresholds, in millimetres. The unit is decided from
 * each field's own magnitude, not from the whole config, so a mixed-unit
 * response (or a partial object whose defaults are already millimetres) cannot
 * corrupt the fields that were expressed correctly.
 *
 * An overall shed dimension below 100 mm is implausible and a metre-expressed
 * one is never above 100 m, so `0 < v < 100` means metres. Openings are smaller
 * than the shed that contains them, so their threshold is 10: a 900 mm door is
 * clearly millimetres, while `0.9` is clearly metres. Zero is never scaled — a
 * zero sill stays zero.
 */
const SHED_METRE_THRESHOLD = 100;
const OPENING_METRE_THRESHOLD = 10;
/**
 * An option is a shed-sized object — a mezzanine can be 15 m across, an awning
 * 6 m — so it shares the shed threshold rather than the opening one. Using 10
 * would read a genuine "15" (metres) as 15 mm.
 */
const OPTION_METRE_THRESHOLD = SHED_METRE_THRESHOLD;

/**
 * Fallback dimensions for a malformed opening, in millimetres. These are
 * *opening*-plausible (a standard personal-access door), not whole-shed ones: a
 * bad opening must not silently become a 12 m door the width of the shed. Both
 * are above `OPENING_METRE_THRESHOLD`, so `coerceToMillimetres` leaves them
 * alone. They come from `DEFAULT_OPENING_SIZE`, the same constant the store
 * mints a new door from, so the fallback and the default cannot drift.
 */

/** Hex colour string, e.g. `#d9d9d9`. */
const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{3,8}$/);

// --- Base field schemas, shared by both exported schemas --------------------

const structureTypeSchema = z.enum(STRUCTURE_TYPES);
const wallSideSchema = z.enum(WALL_SIDES);
const openingTypeSchema = z.enum(OPENING_TYPES);
const alignModeSchema = z.enum(ALIGN_MODES);

/** A nullable swing direction; `null` means the field does not apply. */
const swingSchema = z.enum(SWING_DIRECTIONS).nullable();
/**
 * A stable's panel flag. Accepts a real boolean or the strings a form or a model
 * may produce, and reads "false"/"0"/"off" as false — which `z.coerce.boolean`
 * does not.
 */
const panelFlagSchema = z
  .union([z.boolean(), z.string(), z.number()])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    return !['false', '0', 'off', 'no', ''].includes(value.trim().toLowerCase());
  })
  .catch(true);

/** How a sliding door runs; cleared to `null` for every other opening type. */
const trackSchema = z.enum(['none', 'single', 'double']).nullable();
/** A nullable wall-local offset in millimetres. */
const offsetSchema = z.coerce.number().finite().nullable();

const dimensionSchema = z.coerce.number().finite();
const positiveDimensionSchema = z.coerce.number().finite().positive();
const bayCountSchema = z.coerce.number().finite().int();
const pitchSchema = z.coerce.number().finite().min(0).max(45);

/**
 * The site-condition fields.
 *
 * They are on the config because the span table is indexed by them and because a
 * quote revision must freeze the conditions it was priced under. That makes them
 * load-bearing rather than decorative: a schema that omits them drops them on
 * every `applyPartial`, undo and AI round-trip, and the next BOM is priced for a
 * different site than the one on screen.
 */
/**
 * A wind region code, as the certificate states it.
 *
 * **Not an enum.** ShedSafe answers `A1`, `A2`, `A5`, `B1` — measured across the 47 real buildings in
 * the legacy licence database — and the price book's `devided` table is keyed by exactly those codes.
 * The enum that used to be here accepted only `A`–`D`, so `"A5"` failed validation and the tolerant
 * schema's `.catch()` replaced it with `"A"`. Measured 2026-11-10, the consequence is steel, not a
 * label: on the reference book `A2` gives purlin_span 720, `A5` gives 830 and `A6` gives 1 300 — so
 * rewriting `A5` as `A2` prices a level-5 site with a smaller purlin at a shorter span.
 *
 * The rule is therefore "a short code starting with a region letter", and anything unexpected is
 * refused on the strict path rather than silently replaced. `windRegionCode()` decides how the code
 * becomes a book key; that is a separate question and it lives in `wind.ts`.
 */
const windRegionSchema = z
  .string()
  .trim()
  .min(1)
  .max(8)
  /*
   * A region letter `A`–`D` with an optional one- or two-digit suffix, **or** one of the obsolete
   * codes an old quote file carries (`W41`, `N2`).
   *
   * Not an enum: ShedSafe owns the vocabulary and issues `A1`, `A2`, `A5`, `B1`, so enumerating the
   * known codes would reject a real certificate the day they add one. It is strict enough to keep
   * nonsense out — `Z` and `open country` are refused — and lenient enough for the two shapes that
   * actually occur. A code the book does not list misses the lookup and is reported as an assumption,
   * which is visible; substituting a nearby code would not be.
   */
  .regex(
    /^([A-Da-d]\d{0,2}|[WN]\d{1,3}C?)$/,
    'A wind region is A–D with an optional digit (A, A5, B1), or an older code such as W41.',
  );
/**
 * Terrain category, snapped to the three the book lists.
 *
 * A certificate reports a **fraction**: ShedSafe answered `2.68`, `2.7`, `2.81`, `2.92` and `2.95`
 * across the real buildings measured on 2026-11-10. The book lists `2`, `2.5`, `3`, so the value is
 * snapped to the nearest — otherwise every lookup misses and the frame falls back to an assumed
 * section for a site the book could have priced.
 *
 * `nearestTerrainCategory` does the arithmetic, so the strict path and the tolerant one cannot snap
 * differently. Snapping is recorded rather than hidden: the quote states the category it was priced
 * from, which is the snapped one.
 */
const terrainCategorySchema = z
  .number()
  .finite()
  /*
   * A value that cannot be a terrain category must **fail**, not transform to `NaN`.
   *
   * `transform` cannot reject: it would return `NaN` and zod would call that a success, so a corrupt
   * row would reach the config as `NaN` and every comparison downstream would be false without ever
   * throwing. `pipe` into a refine makes the refusal real, which lets the tolerant schema's `.catch()`
   * put the documented default in its place.
   */
  .pipe(
    z
      .number()
      .refine((value) => value >= 1 && value <= 4, 'A terrain category is between 1 and 4.')
      .transform((value) => nearestTerrainCategory(value)),
  );
/**
 * BCA importance level, 1 to 4.
 *
 * Four, not two. ShedSafe certifies against all four, and the narrower union was not a validation
 * rule — it was a **silent downgrade**: the tolerant schema's `.catch()` turned a certificate's
 * level 3 into level 1, so the quote printed "Importance level 1" against a level-3 certificate.
 * Measured 2026-11-10. The price book lists only 1 and 2; that is reported as an assumption when it
 * causes a lookup to miss, which is visible — a wrong number is not.
 */
const importanceLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const stateCodeSchema = z.enum(['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT']);
const factorSchema = z.coerce.number().finite().positive();

/**
 * An opening as extracted by the model. Deliberately omits `id`: identifiers are
 * ours to mint, not the model's to invent, so the gateway schema never asks for
 * one.
 */
const extractionOpeningSchema = z.object({
  type: openingTypeSchema,
  width: positiveDimensionSchema,
  height: positiveDimensionSchema,
  sill: dimensionSchema,
  wall: wallSideSchema,
  align: alignModeSchema,
  offset: offsetSchema,
  swing: swingSchema,
  // Optional in the model response: track is meaningless for non-sliding doors,
  // and a model that omits it must not fail strict structured output validation.
  track: z.enum(['none', 'single', 'double']).nullable().optional(),
});

/** A complete opening, including the id the domain requires. */
const openingSchema = z.object({
  id: z.string().min(1),
  track: z.enum(['none', 'single', 'double']).nullable(),
  type: openingTypeSchema,
  width: positiveDimensionSchema,
  height: positiveDimensionSchema,
  sill: dimensionSchema,
  wall: wallSideSchema,
  align: alignModeSchema,
  offset: offsetSchema,
  swing: swingSchema,
  sku: z.string().nullable().default(null),
  prepOnly: z.boolean().default(false),
  series: z.enum(['A', 'AA', 'B']).nullable().default(null),
  windlock: z.boolean().default(false),
  trackSegments: z.number().int().min(1).max(20).optional(),
  trackWidth: z.number().min(1000).max(6000).optional(),
});

/** The fields the model is asked to extract. */
/**
 * One option as a **complete** value: the same discriminants and fields the
 * domain type has, with no fallbacks. Used only by `shedConfigSchema`, which
 * describes a config that is already valid; the tolerant version used at the
 * input boundary is `tolerantOptionSchema`.
 */
const completeOptionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skylight'), id: z.string().min(1), bay: z.number().int(),
    alongBay: z.number(), width: z.number(), height: z.number(),
    skylightType: z.enum(['Corro', 'TL-5']).optional() }),
  z.object({ kind: z.literal('mezzanine'), id: z.string().min(1),
    corner: z.enum(['front_left', 'front_right', 'back_left', 'back_right']),
    width: z.number(), depth: z.number(), level: z.number(),
    floorLoad: z.union([z.literal(1.5), z.literal(3), z.literal(5), z.literal(7.5)]).optional() }),
  z.object({ kind: z.literal('awning'), id: z.string().min(1), wall: wallSideSchema,
    align: alignModeSchema, offset: z.number().nullable(), width: z.number(), depth: z.number(),
    pitchDeg: z.number().min(0).max(45).optional() }),
  z.object({ kind: z.literal('outrigger'), id: z.string().min(1), wall: wallSideSchema,
    bay: z.number().int(), length: z.number(), height: z.number().optional() }),
  z.object({ kind: z.literal('dividing_wall'), id: z.string().min(1), axis: z.enum(['x', 'y']),
    at: z.number(), height: z.number() }),
  z.object({ kind: z.literal('gable_infill'), id: z.string().min(1), end: z.enum(['front', 'back']) }),
  z.object({ kind: z.literal('stable'), id: z.string().min(1), wall: wallSideSchema,
    align: alignModeSchema, offset: z.number().nullable(), width: z.number(), depth: z.number(),
    height: z.number(),
    panels: z.object({ left: z.boolean(), right: z.boolean(), front: z.boolean(), back: z.boolean() }) }),
  z.object({ kind: z.literal('carry_beam'), id: z.string().min(1), wall: wallSideSchema,
    beginBay: z.number().int(), openingId: z.string().nullable() }),
  z.object({ kind: z.literal('horizontal_cladding'), id: z.string().min(1), wall: wallSideSchema,
    from: z.number(), to: z.number() }),
  z.object({ kind: z.literal('overhang'), id: z.string().min(1), wall: wallSideSchema, depth: z.number() }),
  z.object({ kind: z.literal('cantilever'), id: z.string().min(1), wall: wallSideSchema,
    bay: z.number().int(), length: z.number() }),
  z.object({ kind: z.literal('misc_option'), id: z.string().min(1), name: z.string(),
    quantity: z.number(), unit: z.string() }),
]);

/** A charge line as a complete value. */
const chargeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  quantity: z.number().min(0),
  unit: z.string().min(1),
  unitPriceCents: z.number().int().min(0),
});

export const extractionSchema = z.object({
  structureType: structureTypeSchema,
  span: positiveDimensionSchema,
  length: positiveDimensionSchema,
  height: positiveDimensionSchema,
  roofPitchDeg: pitchSchema,
  bays: bayCountSchema,
  openings: z.array(extractionOpeningSchema),
  options: z.array(completeOptionSchema),
  charges: z.array(chargeSchema),
  internalPressure: z.enum(['closed', 'open']),
});

/**
 * The extraction schema as it is **requested** from the model: every field is
 * optional, and a field the model gets wrong is dropped rather than failing the
 * whole answer.
 *
 * This exists because a real model answers partial questions partially. Asked
 * "a 15m shed, 8m wide, 3 bays" it states three things and omits the rest; with
 * the complete schema above (which `strict: true` turns into a `required` list)
 * that answer is rejected outright and the whole request falls back to the local
 * parser — the model is effectively never consulted. Marking the fields optional
 * lets the model say only what it knows, and `parseExtraction` merges that over
 * the current config, so the four unstated fields keep their existing values.
 *
 * `openings` is validated per entry by `parseOpeningEntry`, so one bad door
 * cannot discard the whole list.
 */
/**
 * The shape the model is asked to fill for one option.
 *
 * Every field is optional: a model that knows only "a skylight in bay 2" must be
 * able to answer with two fields, and `strict: true` would otherwise make each
 * missing one a violation. `kind` is required because it is the discriminant —
 * without it the entry is not an option at all.
 *
 * This is a *shape*, not the validator: `parseExtraction` still runs every entry
 * through `parseOptionEntry`, so a wrongly-typed field is dropped per entry
 * rather than failing the whole answer.
 */
const extractionOptionSchema = z.object({
  kind: z.enum([
    'skylight', 'mezzanine', 'awning', 'outrigger', 'dividing_wall', 'gable_infill',
    'stable', 'carry_beam', 'horizontal_cladding', 'overhang', 'cantilever',
  ]),
  bay: z.number().optional(),
  alongBay: z.number().optional(),
  corner: z.string().optional(),
  wall: z.string().optional(),
  align: z.string().optional(),
  offset: z.number().nullable().optional(),
  axis: z.string().optional(),
  at: z.number().optional(),
  beginBay: z.number().optional(),
  end: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  depth: z.number().optional(),
  level: z.number().optional(),
  length: z.number().optional(),
  from: z.number().optional(),
  to: z.number().optional(),
  openingId: z.string().nullable().optional(),
  panels: z.object({
    left: z.boolean().optional(),
    right: z.boolean().optional(),
    front: z.boolean().optional(),
    back: z.boolean().optional(),
  }).optional(),
});

/** The shape of one charge line, priced in dollars as a person would say it. */
const extractionChargeSchema = z.object({
  label: z.string(),
  quantity: z.number().optional(),
  unit: z.string().optional(),
  unitPrice: z.number().optional(),
});

const partialExtractionSchema = z.object({
  structureType: structureTypeSchema.optional().catch(undefined),
  span: positiveDimensionSchema.optional().catch(undefined),
  length: positiveDimensionSchema.optional().catch(undefined),
  height: positiveDimensionSchema.optional().catch(undefined),
  roofPitchDeg: pitchSchema.optional().catch(undefined),
  bays: bayCountSchema.optional().catch(undefined),
  // The array is optional (the user may not mention a door); when present, each
  // entry carries the full opening shape so the model knows what a door looks
  // like. The entries themselves are validated one at a time from the raw input
  // by `parseExtraction`, so a single malformed door cannot discard the rest.
  openings: z.array(extractionOpeningSchema).optional().catch(undefined),
  // Options are accepted as opaque input and parsed one entry at a time by
  // `parseOptionEntry`, for the same reason: one unknown kind must not discard
  // the options that were understood.
  options: z.array(extractionOptionSchema).optional().catch(undefined),
  // Charges are opaque at the gateway for the same reason: one unusable line
  // must not discard the rest. `internalPressure` is an enum, so the schema can
  // validate it directly.
  charges: z.array(extractionChargeSchema).optional().catch(undefined),
  internalPressure: z.enum(['closed', 'open']).optional().catch(undefined),
});

/** The schema actually sent to the gateway (all fields optional). */
export const requestExtractionSchema = partialExtractionSchema;

/**
 * The scalar fields only, with `openings` and `options` accepted as opaque
 * input. Parsing the scalars through this — rather than through
 * `partialExtractionSchema` — means an unusable door or option entry cannot fail
 * the whole answer and blank out the dimensions; `parseExtraction` handles both
 * arrays separately, one entry at a time.
 */
const scalarExtractionSchema = partialExtractionSchema.omit({ openings: true, options: true, charges: true });

/**
 * Parse whatever the model returned into a JSON value, or `null`.
 *
 * Models wrap JSON in a ```` ```json ```` fence, prefix it with "Sure! Here is
 * your shed:", or both — the `wiki` gateway model does all three. A strict
 * `JSON.parse` rejects every one of those, which is how a perfectly good answer
 * ends up in the fallback path. This tries, in order: the whole string, the
 * contents of a fenced block, then the first complete `{…}` object found by a
 * brace-balanced scan (so trailing prose cannot corrupt it). Returns `null` when
 * none of those is valid JSON.
 */
export function parseModelJson(raw: string): unknown | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '') return null;

  const whole = tryJson(text);
  if (whole !== undefined) return whole;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced !== null) {
    const inner = tryJson(fenced[1].trim());
    if (inner !== undefined) return inner;
  }

  const firstObject = firstBalancedObject(text);
  if (firstObject !== null) {
    const parsed = tryJson(firstObject);
    if (parsed !== undefined) return parsed;
  }

  return null;
}

/** `JSON.parse` returning `undefined` (not throwing) on anything unreadable. */
function tryJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The first brace-balanced `{…}` substring in `text`, or `null`. Braces inside
 * string literals are ignored, so `{"a":"}"}` is not cut short.
 */
function firstBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Reduce a model answer to the config fields it actually states.
 *
 * Every field is independent: one the model got wrong (a `structureType` outside
 * the enum, a non-numeric `span`) is dropped while the rest survive, so a single
 * bad value no longer throws away a good answer. A field the model did not
 * mention is simply absent from the result — the caller merges over the current
 * config, which is what makes a partial request ("3 things said, 4 not") work
 * and what makes an update ("change span to 7m") keep everything else.
 *
 * `openings` is only included when it yields at least one usable door: an answer
 * whose doors all failed validation must not silently delete the user's existing
 * doors. `options` follows the same rule.
 *
 * `base` is the config the answer will be merged into. Options are clamped
 * against it (overlaid with whatever this answer states), because an option's
 * bay index only means something relative to the real `bays`: clamping against
 * `DEFAULT_SHED` would move a skylight in bay 8 of an 8-bay shed into bay 4.
 */
export function parseExtraction(parsed: unknown, base: ShedConfig = DEFAULT_SHED): Partial<ShedConfig> {
  const result = scalarExtractionSchema.safeParse(parsed);
  const data = result.success ? result.data : {};
  const out: Partial<ShedConfig> = {};

  if (data.structureType !== undefined) out.structureType = data.structureType;
  if (data.span !== undefined) out.span = data.span;
  if (data.length !== undefined) out.length = data.length;
  if (data.height !== undefined) out.height = data.height;
  if (data.roofPitchDeg !== undefined) out.roofPitchDeg = data.roofPitchDeg;
  if (data.bays !== undefined) out.bays = data.bays;
  if (data.internalPressure !== undefined) out.internalPressure = data.internalPressure;

  // Doors are validated one entry at a time from the raw input, so a single bad
  // door cannot fail the parse and blank out the dimensions above.
  const rawOpenings = isPlainObject(parsed) ? (parsed as { openings?: unknown }).openings : undefined;
  if (Array.isArray(rawOpenings)) {
    const openings = rawOpenings
      .map((entry) => parseOpeningEntry(entry))
      .filter((opening): opening is Opening => opening !== undefined);
    // An **explicit** empty array is the model saying "none should remain", so
    // it clears the current doors. A non-empty array whose entries all failed is
    // a malformed answer, and keeps them — that distinction is the whole guard.
    if (openings.length > 0) out.openings = openings;
    else if (rawOpenings.length === 0) out.openings = [];
  }

  // Options are parsed last, against the dimensions this answer states, so a
  // bay index is clamped by the bay count that arrives with it rather than by
  // the current config's. An answer whose options all failed validation leaves
  // `options` absent, which keeps the existing ones — the same rule as doors.
  //
  // Each entry is rescaled **before** it is clamped: `parseOptionEntry` clamps
  // against the shed's bounds, and a value still in metres ("a 15m mezzanine")
  // would be clamped down to the 1000 mm minimum and then no longer look like
  // metres. `coerceToMillimetres` on a one-option config is the same per-field
  // rule the LLM path uses, applied before the clamps rather than after.
  const rawOptions = isPlainObject(parsed) ? (parsed as { options?: unknown }).options : undefined;
  if (Array.isArray(rawOptions)) {
    const shedForClamping: ShedConfig = {
      ...base,
      ...out,
      openings: out.openings ?? base.openings,
      options: [],
    };
    const options = rawOptions
      .map((entry) => {
        // Rescale the raw entry first, then clamp: `parseOptionEntry` clamps
        // into the shed's bounds, and a metre value clamped first would already
        // be at the minimum and no longer look like metres.
        const rescaled = rescaleOptionEntry(entry);
        return parseOptionEntry(rescaled, shedForClamping);
      })
      .filter((option): option is ShedOption => option !== undefined);
    if (options.length > 0) out.options = options;
    else if (rawOptions.length === 0) out.options = [];
  }

  // Charges are parsed last and one at a time, like options: a malformed line
  // leaves the rest intact. A model states a price in dollars, which
  // `normaliseCharge` converts to cents.
  const rawCharges = isPlainObject(parsed) ? (parsed as { charges?: unknown }).charges : undefined;
  if (Array.isArray(rawCharges)) {
    const charges = rawCharges
      .map((entry, index) => normaliseCharge(entry, `ch-${index + 1}`))
      .filter((charge): charge is Charge => charge !== undefined);
    if (charges.length > 0) out.charges = charges;
    else if (rawCharges.length === 0) out.charges = [];
  }

  return out;
}

/** The complete `ShedConfig` schema. */
export const shedConfigSchema = z.object({
  structureType: structureTypeSchema,
  span: positiveDimensionSchema,
  length: positiveDimensionSchema,
  height: positiveDimensionSchema,
  roofPitchDeg: pitchSchema,
  bays: bayCountSchema,
  nomBaySpacing: z.coerce.number().finite(),
  openings: z.array(openingSchema),
  options: z.array(completeOptionSchema),
  charges: z.array(chargeSchema),
  colors: z.object({
    wall: hexColorSchema,
    roof: hexColorSchema,
    barge: hexColorSchema,
    downpipe: hexColorSchema,
    gutter: hexColorSchema,
    window: hexColorSchema,
    paDoor: hexColorSchema,
    rollerDoor: hexColorSchema,
    slidingDoor: hexColorSchema,
    dividingWall: hexColorSchema,
  }),
  displayUnit: z.enum(['mm', 'm']),
  internalPressure: z.enum(['closed', 'open']),
  windRegion: windRegionSchema,
  terrainCategory: terrainCategorySchema,
  shieldingFactor: factorSchema,
  importanceLevel: importanceLevelSchema,
  topographyFactor: factorSchema,
  stateCode: stateCodeSchema,
  wallProfile: z.string(),
  roofProfile: z.string(),
  downpipeType: z.string(),
  footingType: z.string(),
  footingSubType: z.string(),
  endOpening: z.object({ left: z.boolean(), right: z.boolean() }),
  sideOpening: z.object({ front: z.boolean(), back: z.boolean() }),
  buildingClass: z.string().nullable(),
  snowLoad: z.number().nullable(),
  designWindSpeed: z.number().nullable(),
});

// --- Tolerant schema: every field falls back rather than throwing -----------

/**
 * `shedConfigSchema` with a per-field `.catch()` fallback, so a partially valid
 * object yields a usable config instead of an error. Missing or unreadable
 * fields fall back to `DEFAULT_SHED`. `openings` is handled per-item by the
 * caller (see `normaliseShedConfig`), so it is not part of this object schema.
 */
const tolerantShedConfigSchema = z.object({
  structureType: structureTypeSchema.catch(DEFAULT_SHED.structureType),
  span: positiveDimensionSchema.catch(DEFAULT_SHED.span),
  length: positiveDimensionSchema.catch(DEFAULT_SHED.length),
  height: positiveDimensionSchema.catch(DEFAULT_SHED.height),
  roofPitchDeg: pitchSchema.catch(DEFAULT_SHED.roofPitchDeg),
  bays: bayCountSchema.catch(DEFAULT_SHED.bays),
  nomBaySpacing: z.coerce.number().finite().catch(DEFAULT_SHED.nomBaySpacing),
  colors: z
    .object({
      wall: hexColorSchema.catch(DEFAULT_SHED.colors.wall),
      roof: hexColorSchema.catch(DEFAULT_SHED.colors.roof),
      barge: hexColorSchema.catch(DEFAULT_SHED.colors.barge),
      downpipe: hexColorSchema.catch(DEFAULT_SHED.colors.downpipe),
      gutter: hexColorSchema.catch(DEFAULT_SHED.colors.gutter),
      window: hexColorSchema.catch(DEFAULT_SHED.colors.window),
      paDoor: hexColorSchema.catch(DEFAULT_SHED.colors.paDoor),
      rollerDoor: hexColorSchema.catch(DEFAULT_SHED.colors.rollerDoor),
      slidingDoor: hexColorSchema.catch(DEFAULT_SHED.colors.slidingDoor),
      dividingWall: hexColorSchema.catch(DEFAULT_SHED.colors.dividingWall),
    })
    .catch(DEFAULT_SHED.colors),
  displayUnit: z.enum(['mm', 'm']).catch(DEFAULT_SHED.displayUnit),
  internalPressure: z.enum(['closed', 'open']).catch(DEFAULT_SHED.internalPressure),
  /*
   * A wind region that fails to parse falls back to the default — but the default is `A`, and the
   * fallback is now **rare** rather than routine: the schema above accepts every code ShedSafe issues
   * (`A1`, `A2`, `A5`, `B1`) and every obsolete one an old file carries (`W41`, `N2`). Before
   * 2026-11-10 the enum accepted only four strings, so `"A5"` took this branch on **every real
   * certificate** and became `"A"`. See `wind.ts` for what that cost.
   */
  windRegion: windRegionSchema.catch(DEFAULT_SHED.windRegion),
  // A certificate reports a fraction (`2.68`, `2.92`); the book lists 2, 2.5 and 3, so the value is
  // snapped to the nearest listed category rather than making every lookup miss.
  terrainCategory: terrainCategorySchema.catch(DEFAULT_SHED.terrainCategory),
  shieldingFactor: factorSchema.catch(DEFAULT_SHED.shieldingFactor),
  importanceLevel: importanceLevelSchema.catch(DEFAULT_SHED.importanceLevel),
  topographyFactor: factorSchema.catch(DEFAULT_SHED.topographyFactor),
  stateCode: stateCodeSchema.catch(DEFAULT_SHED.stateCode),
  wallProfile: z.string().catch(DEFAULT_SHED.wallProfile),
  roofProfile: z.string().catch(DEFAULT_SHED.roofProfile),
  downpipeType: z.string().catch(DEFAULT_SHED.downpipeType),
  footingType: z.string().catch(DEFAULT_SHED.footingType),
  footingSubType: z.string().catch(DEFAULT_SHED.footingSubType),
  endOpening: z
    .object({ left: panelFlagSchema, right: panelFlagSchema })
    .partial()
    .transform((value) => ({ left: value.left ?? false, right: value.right ?? false }))
    .catch({ left: false, right: false }),
  sideOpening: z
    .object({ front: panelFlagSchema, back: panelFlagSchema })
    .partial()
    .transform((value) => ({ front: value.front ?? false, back: value.back ?? false }))
    .catch({ front: false, back: false }),
  buildingClass: z.string().nullable().catch(null),
  snowLoad: z.number().nullable().catch(null),
  designWindSpeed: z.number().nullable().catch(null),
});

/**
 * A single opening as it may arrive from the model: every field is tolerated,
 * and `id` may be absent (the extraction schema never asks for one) and is
 * minted by the caller. `type` is required — an object with no recognised
 * opening type is not an opening and is dropped.
 */
const tolerantOpeningSchema = z.object({
  id: z.string().catch(''),
  type: openingTypeSchema,
  width: positiveDimensionSchema.catch(DEFAULT_OPENING_SIZE.width),
  height: positiveDimensionSchema.catch(DEFAULT_OPENING_SIZE.height),
  sill: dimensionSchema.catch(0),
  wall: wallSideSchema.catch('front'),
  align: alignModeSchema.catch('center'),
  offset: offsetSchema.catch(null),
  swing: swingSchema.catch(null),
  track: trackSchema.catch(null),
  sku: z.string().nullable().catch(null),
  prepOnly: z.boolean().catch(false),
  series: z.enum(['A', 'AA', 'B']).nullable().catch(null),
  // Left undefined when absent so the wind-region default can be applied later.
  windlock: z.boolean().optional().catch(undefined),
  trackSegments: z.coerce.number().optional().catch(undefined),
  trackWidth: z.coerce.number().optional().catch(undefined),
});

/** True for a non-null, non-array object (a "plain" record). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One option as it may arrive from the model or a stored config.
 *
 * `kind` is the discriminant and is **required**: an object with no recognised
 * kind is not an option at all, so it is dropped rather than guessed at. Every
 * other field falls back, which is what lets a partial answer ("a skylight in
 * bay 2" states no size) survive instead of being discarded wholesale. The
 * fallbacks are deliberately plain numbers — `normaliseOption` clamps them into
 * the shed's real bounds afterwards, so these only have to be type-correct.
 */
const tolerantOptionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('skylight'),
    id: z.string().catch(''),
    bay: z.coerce.number().catch(0),
    alongBay: z.coerce.number().catch(0.5),
    width: z.coerce.number().catch(900),
    height: z.coerce.number().catch(900),
    skylightType: z.enum(['Corro', 'TL-5']).optional().catch(undefined),
  }),
  z.object({
    kind: z.literal('mezzanine'),
    id: z.string().catch(''),
    corner: z.enum(['front_left', 'front_right', 'back_left', 'back_right']).catch('back_left'),
    width: z.coerce.number().catch(3000),
    depth: z.coerce.number().catch(3000),
    level: z.coerce.number().catch(2400),
    floorLoad: z.coerce.number().optional().catch(undefined),
  }),
  z.object({
    kind: z.literal('awning'),
    id: z.string().catch(''),
    wall: wallSideSchema.catch('front'),
    align: alignModeSchema.catch('center'),
    offset: offsetSchema.catch(null),
    width: z.coerce.number().catch(3000),
    depth: z.coerce.number().catch(1000),
    pitchDeg: z.coerce.number().optional().catch(undefined),
  }),
  z.object({
    kind: z.literal('outrigger'),
    id: z.string().catch(''),
    wall: wallSideSchema.catch('front'),
    bay: z.coerce.number().catch(0),
    length: z.coerce.number().catch(1900),
    height: z.coerce.number().optional().catch(undefined),
  }),
  z.object({
    kind: z.literal('dividing_wall'),
    id: z.string().catch(''),
    axis: z.enum(['x', 'y']).catch('x'),
    at: z.coerce.number().catch(0),
    height: z.coerce.number().catch(2400),
  }),
  z.object({
    kind: z.literal('gable_infill'),
    id: z.string().catch(''),
    end: z.enum(['front', 'back']).catch('front'),
  }),
  z.object({
    kind: z.literal('stable'),
    id: z.string().catch(''),
    wall: wallSideSchema.catch('front'),
    align: alignModeSchema.catch('center'),
    offset: offsetSchema.catch(null),
    width: z.coerce.number().catch(3000),
    depth: z.coerce.number().catch(2400),
    height: z.coerce.number().catch(2400),
    // `z.coerce.boolean()` treats the string "false" as true, and a partial
    // object would turn every missing key into `false`. Both matter here: a
    // stored config and a model answer are untrusted, and a panel the user
    // never mentioned should default to present.
    panels: z
      .object({
        left: panelFlagSchema,
        right: panelFlagSchema,
        front: panelFlagSchema,
        back: panelFlagSchema,
      })
      .partial()
      .transform((panels) => ({
        left: panels.left ?? true,
        right: panels.right ?? true,
        front: panels.front ?? true,
        back: panels.back ?? true,
      }))
      .catch({ left: true, right: true, front: true, back: true }),
  }),
  z.object({
    kind: z.literal('carry_beam'),
    id: z.string().catch(''),
    wall: wallSideSchema.catch('front'),
    beginBay: z.coerce.number().catch(0),
    openingId: z.string().nullable().catch(null),
  }),
  z.object({
    kind: z.literal('horizontal_cladding'),
    id: z.string().catch(''),
    wall: wallSideSchema.catch('front'),
    from: z.coerce.number().catch(0),
    to: z.coerce.number().catch(2400),
  }),
  z.object({
    kind: z.literal('overhang'),
    id: z.string().catch(''),
    wall: wallSideSchema.catch('front'),
    depth: z.coerce.number().catch(600),
  }),
  z.object({
    kind: z.literal('cantilever'),
    id: z.string().catch(''),
    wall: wallSideSchema.catch('front'),
    bay: z.coerce.number().catch(0),
    length: z.coerce.number().catch(1200),
  }),
  z.object({
    kind: z.literal('misc_option'),
    id: z.string().catch(''),
    name: z.string().catch(''),
    quantity: z.coerce.number().catch(1),
    unit: z.string().catch('ea'),
  }),
]);

/** The id prefix each option kind mints when one has to be repaired. */
const OPTION_ID_PREFIX: Record<OptionKind, string> = {
  skylight: 'sk',
  mezzanine: 'mz',
  awning: 'aw',
  outrigger: 'og',
  dividing_wall: 'dw',
  gable_infill: 'gi',
  stable: 'st',
  carry_beam: 'cb',
  horizontal_cladding: 'hc',
  overhang: 'oh',
  cantilever: 'cl',
  misc_option: 'mo',
};

/**
 * Rescale the length fields of a **raw** option entry from metres to
 * millimetres, before any clamping.
 *
 * Applied at the AI boundary only, where a model may answer in metres. It works
 * on the raw object (not a parsed option) precisely because clamping is
 * destructive: once a metre value has been clamped to the 1000 mm minimum it is
 * indistinguishable from a genuine 1000 mm, so the conversion has to happen
 * first. Unknown kinds and non-numeric fields pass through untouched for
 * `parseOptionEntry` to judge.
 */
function rescaleOptionEntry(entry: unknown): unknown {
  if (!isPlainObject(entry)) return entry;
  const scaleField = (value: unknown): unknown =>
    typeof value === 'number' && value > 0 && value < OPTION_METRE_THRESHOLD
      ? Math.round(value * 1000)
      : value;
  const out: Record<string, unknown> = { ...entry };
  switch (entry.kind) {
    case 'skylight':
      out.width = scaleField(entry.width);
      out.height = scaleField(entry.height);
      break;
    case 'mezzanine':
      out.width = scaleField(entry.width);
      out.depth = scaleField(entry.depth);
      out.level = scaleField(entry.level);
      break;
    case 'awning':
      out.width = scaleField(entry.width);
      out.depth = scaleField(entry.depth);
      if (entry.offset !== null && entry.offset !== undefined) out.offset = scaleField(entry.offset);
      break;
    case 'outrigger':
      out.length = scaleField(entry.length);
      break;
    case 'dividing_wall':
      out.at = scaleField(entry.at);
      out.height = scaleField(entry.height);
      break;
    case 'stable':
      out.width = scaleField(entry.width);
      out.depth = scaleField(entry.depth);
      out.height = scaleField(entry.height);
      if (entry.offset !== null && entry.offset !== undefined) out.offset = scaleField(entry.offset);
      break;
    case 'horizontal_cladding':
      out.from = scaleField(entry.from);
      out.to = scaleField(entry.to);
      break;
    case 'overhang':
      out.depth = scaleField(entry.depth);
      break;
    case 'cantilever':
      out.length = scaleField(entry.length);
      break;
    case 'carry_beam':
      // Only a bay index and a wall — no length to rescale.
      break;
    default:
      break;
  }
  return out;
}

/**
 * Parse one raw option entry against `shed`, returning `undefined` for anything
 * that is not a recognised option.
 *
 * `shed` is needed because normalisation clamps an option into the shed that
 * contains it: a skylight's bay index only means something relative to `bays`.
 * Callers pass the config the option will live in, so the clamps see final
 * values rather than raw ones.
 */
export function parseOptionEntry(entry: unknown, shed: ShedConfig): ShedOption | undefined {
  if (!isPlainObject(entry)) return undefined;
  const result = tolerantOptionSchema.safeParse(entry);
  if (!result.success) return undefined;
  return normaliseOption(result.data as ShedOption, shed);
}

/**
 * Parse one raw opening entry. Returns `undefined` for anything that is not a
 * recognised opening (non-objects, or objects with no valid `type`), so callers
 * can filter them out rather than throwing.
 */
function parseOpeningEntry(entry: unknown): Opening | undefined {
  if (!isPlainObject(entry)) return undefined;
  const result = tolerantOpeningSchema.safeParse(entry);
  return result.success ? result.data : undefined;
}

/**
 * Parse an unknown value into a complete, valid `ShedConfig`.
 *
 * Never throws. A bad or missing field falls back to its `DEFAULT_SHED` value,
 * non-object and unrecognised entries in `openings` are discarded, and bays are
 * clamped to `[2, 30]`. Opening ids are repaired so each is a non-empty, unique
 * string; the model is never asked for ids, so ones it omits are minted here.
 *
 * Values are taken as already being millimetres. This is deliberately **not** a
 * unit converter: the form parses user input into mm before it reaches the store
 * (see `parseDimension`), so rescaling here would corrupt a small-but-valid mm
 * value — the bug that turned a typed "1" into 1000. Only the LLM path, whose
 * model has been observed answering in metres, calls `coerceToMillimetres`
 * explicitly (extract.ts).
 */
export function normaliseShedConfig(input: unknown): ShedConfig {
  const source = isPlainObject(input) ? input : {};
  const { openings: rawOpenings, options: rawOptions, charges: rawCharges, ...rest } = source;
  /*
   * Read the colour block **before** the tolerant parse.
   *
   * A revision written before the parity change stores four roles. The tolerant
   * schema only knows the ten current keys, so it would replace the old block
   * with `DEFAULT_SHED.colors` — the quote would open in a palette the customer
   * never saw. `migrateColors` maps the old roles onto the new ones instead, and
   * is idempotent on a block that already has all ten.
   */
  const parsed = tolerantShedConfigSchema.parse({
    ...rest,
    colors: migrateColors((rest as { colors?: unknown }).colors),
  });

  const entries = Array.isArray(rawOpenings) ? rawOpenings : [];
  const parsedOpenings: Opening[] = [];
  for (const entry of entries) {
    const opening = parseOpeningEntry(entry);
    if (opening !== undefined) parsedOpenings.push(opening);
  }

  const seen = new Set<string>();
  const openings: Opening[] = parsedOpenings.map((opening, index) => {
    let id = opening.id;
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) {
      // Mint a fresh id and keep going until it does not clash with one already
      // kept, so input like ['op-2', ''] cannot yield two 'op-2's.
      let candidate = index + 1;
      do {
        id = `op-${candidate}`;
        candidate += 1;
      } while (seen.has(id));
    }
    seen.add(id);
    // Canonical linear values are integer millimetres, openings included. A
    // track only means something on a sliding door, so every other type is
    // cleared rather than keeping a value no renderer reads.
    return {
      ...opening,
      id,
      width: Math.round(opening.width),
      height: Math.round(opening.height),
      sill: Math.round(opening.sill),
      offset: opening.offset === null ? null : Math.round(opening.offset),
      track: opening.type === 'sliding_door' ? (opening.track ?? 'none') : null,
      // Only a roller door has a series and windlocks. The desktop turns windlocks on by
      // default in wind regions C and D, where a door without them lifts in a gust.
      series: opening.type === 'roller_door' ? (opening.series ?? null) : null,
      windlock:
        opening.type === 'roller_door'
          /*
           * Default on in regions C and D, read by **letter**: the stored value is a certificate
           * code (`C2`, `D3`), so comparing the whole string never matched after the field began
           * holding what ShedSafe returns — and a roller door missing its windlocks is the physical
           * failure this default exists to prevent.
           */
          ? (opening.windlock ??
              (['C', 'D'] as const).includes(windRegionLetter(parsed.windRegion) as 'C' | 'D'))
          : false,
      prepOnly: opening.prepOnly ?? false,
      sku: opening.sku ?? null,
      // The track belongs to the sliding door that runs on it. 1000–6000 mm per segment
      // is the desktop's R11 bound; a segment outside it is not a track the factory sells.
      trackSegments:
        opening.type === 'sliding_door'
          ? Math.round(Math.min(Math.max(opening.trackSegments ?? 1, 1), 20))
          : undefined,
      trackWidth:
        opening.type === 'sliding_door'
          ? Math.round(Math.min(Math.max(opening.trackWidth ?? 3000, 1000), 6000))
          : undefined,
    };
  });

  // Options are clamped against the *final* scalar config: `bays` has already
  // been clamped above, so a skylight in bay 40 of a 500-bay request lands in
  // the last real bay rather than in a bay that no longer exists.
  const finalBays = clampBays(parsed.bays);
  const finalLength = Math.round(parsed.length);
  const finalShed: ShedConfig = {
    ...DEFAULT_SHED,
    ...parsed,
    span: Math.round(parsed.span),
    length: finalLength,
    height: Math.round(parsed.height),
    roofPitchDeg: Math.min(45, Math.max(0, parsed.roofPitchDeg)),
    bays: finalBays,
    // Derived when the stored spacing is absent or unusable, so every config has
    // a spacing that divides its own length into its own bays.
    nomBaySpacing:
      Number.isFinite(parsed.nomBaySpacing) && parsed.nomBaySpacing > 0
        ? Math.round(parsed.nomBaySpacing)
        : Math.floor(finalLength / finalBays),
    openings,
    options: [],
  };

  const rawOptionEntries = Array.isArray(rawOptions) ? rawOptions : [];
  const parsedOptions: ShedOption[] = [];
  for (const entry of rawOptionEntries) {
    const option = parseOptionEntry(entry, finalShed);
    if (option !== undefined) parsedOptions.push(option);
  }

  const seenOptions = new Set<string>();
  const options: ShedOption[] = parsedOptions.map((option, index) => {
    let id = option.id;
    if (id.length === 0 || seenOptions.has(id)) {
      const prefix = OPTION_ID_PREFIX[option.kind];
      let candidate = index + 1;
      do {
        id = `${prefix}-${candidate}`;
        candidate += 1;
      } while (seenOptions.has(id));
    }
    seenOptions.add(id);
    return { ...option, id } as ShedOption;
  });

  // A carry beam's reference must point at a real opening on its own wall. A
  // dangling or cross-wall pointer is cleared rather than kept: the beam still
  // records "a beam spans this bay", but it no longer claims to span a door
  // that is not there. Clearing is silent because it is a repair, not a change
  // the user asked for.
  const openingsById = new Map(openings.map((opening) => [opening.id, opening]));
  const resolvedOptions = options.map((option) => {
    if (option.kind !== 'carry_beam' || option.openingId === null) return option;
    const referenced = openingsById.get(option.openingId);
    if (referenced === undefined || referenced.wall !== option.wall) {
      return { ...option, openingId: null };
    }
    return option;
  });

  const charges = parseCharges(rawCharges);

  /*
   * Internal pressure is **derived**, not stored-and-trusted.
   *
   * It is recomputed from the four opening switches and the final option list every time a config is
   * normalised, so a value typed or carried in from a file cannot survive a change to the walls. The
   * desktop's own field is disabled for the same reason — it selects which frame row is read, and a
   * frame designed for walls that are not there is a structural claim nobody can support.
   *
   * Recomputing here rather than in the form means every path gets it: typing, a template, an imported
   * `.sqd`, an undo. A rule enforced in one component is a rule the other paths do not have.
   */
  const withOptions: ShedConfig = { ...finalShed, options: resolvedOptions, charges };
  return {
    ...withOptions,
    internalPressure: internalPressureFor(withOptions),
  };
}

/**
 * Read any stored config — including a revision written before this build — as
 * the current shape.
 *
 * The name exists because the read path should say what it is doing. The work is
 * `normaliseShedConfig`'s: per-field fallbacks, the colour-block mapping, and the
 * derived `nomBaySpacing`. It is pure and does not rewrite the revision; a frozen
 * revision is never edited.
 */
export const migrateShedConfig = normaliseShedConfig;

/**
 * Parse and normalise the charge list, one entry at a time.
 *
 * A malformed entry is dropped without discarding the rest, and duplicate ids
 * are repaired with the same loop openings and options use.
 */
function parseCharges(rawCharges: unknown): Charge[] {
  const entries = Array.isArray(rawCharges) ? rawCharges : [];
  const parsed: Charge[] = [];
  for (const entry of entries) {
    const charge = normaliseCharge(entry, `ch-${parsed.length + 1}`);
    if (charge !== undefined) parsed.push(charge);
  }

  const seen = new Set<string>();
  return parsed.map((charge, index) => {
    let id = charge.id;
    if (id.length === 0 || seen.has(id)) {
      let candidate = index + 1;
      do {
        id = `ch-${candidate}`;
        candidate += 1;
      } while (seen.has(id));
    }
    seen.add(id);
    return { ...charge, id };
  });
}

/**
 * User-facing notes for values `normaliseShedConfig` had to clamp, so the caller
 * can surface them rather than silently changing what the user asked for (spec
 * §8.2: "Clamp to `[2, 30]` and note the clamp").
 *
 * The note must be produced from the *raw input* here, at the normalisation
 * boundary: once a config is normalised, a clamped `bays: 30` is
 * indistinguishable from a user who genuinely asked for 30, so the fact cannot
 * be recovered later. `input` is untrusted, so anything unreadable yields no
 * note. Pure: no framework imports.
 */
export function clampNotices(input: unknown): string[] {
  const notices: string[] = [];
  if (!isPlainObject(input)) return notices;

  const rawBays = input.bays;
  const requested =
    typeof rawBays === 'number'
      ? rawBays
      : typeof rawBays === 'string' && rawBays.trim() !== ''
        ? Number(rawBays)
        : NaN;
  if (!Number.isFinite(requested)) return notices;

  // Only the range clamp is worth reporting (spec §8.2). A plain rounding, e.g.
  // 3.7 → 4, is ordinary integer normalisation and not a "clamp".
  const rounded = Math.round(requested);
  if (rounded < 2 || rounded > 30) {
    notices.push(`Bays clamped to ${clampBays(requested)} (you asked for ${requested}).`);
  }

  return notices;
}

/**
 * Rescale a config whose fields were expressed in metres into canonical
 * millimetres.
 *
 * The unit is decided **per field** from that field's own magnitude: an overall
 * dimension (`span`, `length`, `height`) is metres when `0 < v < 100`, and an
 * opening dimension (`width`, `height`, `sill`, `offset`) is metres when
 * `0 < v < 10`. This means a mixed-unit response — or a partial object whose
 * defaults are already millimetres — cannot have its already-millimetre fields
 * multiplied by 1000. A value of exactly `0` is never scaled, so a zero sill
 * stays `0`. `roofPitchDeg` is an angle and is never scaled. A genuine
 * millimetre config (including a small but plausible 3000 mm shed) passes
 * through unchanged.
 */
export function coerceToMillimetres(config: ShedConfig): ShedConfig {
  const scale = (value: number, threshold: number): number =>
    value > 0 && value < threshold ? Math.round(value * 1000) : value;

  return {
    ...config,
    span: scale(config.span, SHED_METRE_THRESHOLD),
    length: scale(config.length, SHED_METRE_THRESHOLD),
    height: scale(config.height, SHED_METRE_THRESHOLD),
    openings: config.openings.map((opening) => ({
      ...opening,
      width: scale(opening.width, OPENING_METRE_THRESHOLD),
      height: scale(opening.height, OPENING_METRE_THRESHOLD),
      sill: scale(opening.sill, OPENING_METRE_THRESHOLD),
      offset: opening.offset === null ? null : scale(opening.offset, OPENING_METRE_THRESHOLD),
    })),
    // Option dimensions follow the same per-field rule as openings, but with a
    // wider threshold: an option can legitimately be tens of metres long (a 15 m
    // mezzanine), so the opening threshold of 10 would leave "15" unscaled and
    // produce a 15 mm slab. Anchors that are not lengths — a bay index, a 0..1
    // fraction — are never scaled, and neither is an enum.
    options: config.options.map((option) => {
      const dim = (value: number) => scale(value, OPTION_METRE_THRESHOLD);
      switch (option.kind) {
        case 'skylight':
          return { ...option, width: dim(option.width), height: dim(option.height) };
        case 'mezzanine':
          return {
            ...option,
            width: dim(option.width),
            depth: dim(option.depth),
            level: dim(option.level),
          };
        case 'awning':
          return {
            ...option,
            width: dim(option.width),
            depth: dim(option.depth),
            offset: option.offset === null ? null : dim(option.offset),
          };
        case 'outrigger':
          return { ...option, length: dim(option.length) };
        case 'dividing_wall':
          return { ...option, at: dim(option.at), height: dim(option.height) };
        case 'gable_infill':
          return option;
        case 'stable':
          return {
            ...option,
            width: dim(option.width),
            depth: dim(option.depth),
            height: dim(option.height),
            offset: option.offset === null ? null : dim(option.offset),
          };
        case 'carry_beam':
          return option;
        case 'horizontal_cladding':
          return { ...option, from: dim(option.from), to: dim(option.to) };
        case 'overhang':
          return { ...option, depth: dim(option.depth) };
        case 'cantilever':
          return { ...option, length: dim(option.length) };
        case 'misc_option':
          // A quantity of 3 is three rolls, not three metres; never rescaled.
          return option;
      }
    }),
  };
}
