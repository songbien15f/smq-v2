/**
 * Canonical domain types for the shed generator.
 *
 * All linear values are millimetres, integers. `displayUnit` affects only how
 * numbers are shown and parsed at the UI edge; it never changes stored values.
 *
 * This module is pure TypeScript: it must not import React, Next.js, Zustand,
 * Konva, or three.
 */

/** How dimension values are shown and parsed at the UI edge. */
export type DisplayUnit = 'mm' | 'm';

/** Which wall of the shed an opening sits in. */
export type WallSide = 'front' | 'back' | 'left' | 'right';

/** Horizontal placement of an opening along its wall. */
export type AlignMode = 'center' | 'left' | 'right' | 'custom';

/**
 * Kind of opening cut into a wall.
 *
 * `opening` is a plain hole with no door or glass: the wall is cut and nothing
 * is fitted into it. It is an opening type rather than a separate option kind
 * so it inherits wall placement, dragging, selection, `sill`, and AI extraction
 * unchanged — the only difference is that the 3D layer renders no panel.
 */
export type OpeningType =
  | 'roller_door'
  | 'pa_door'
  | 'sliding_door'
  | 'window'
  | 'opening';

/** Swing sense; meaningful for pa_door / sliding_door only. */
export type SwingDirection = 'inward' | 'outward' | null;

/**
 * How a sliding door runs. Meaningful only for `sliding_door`: every other
 * opening type stores `null`.
 *
 * The desktop app models this with `ETrackSelection`, ten wall-relative values
 * (front side wall, left end wall on the front awning, …). All ten are derivable
 * from the door that owns the track, so only the count is stored here.
 */
export type OpeningTrack = 'none' | 'single' | 'double';

/** Structural family of the shed, determining roof shape and ridge orientation. */
export type StructureType =
  | 'gable'
  | 'skillion'
  | 'gable_carport'
  | 'skillion_carport'
  | 'tophot_64'
  | 'tophot_96'
  | 'zed_shed'
  | 'aircraft_hangar'
  | 'cyclonic'
  /*
   * The two **custom** (non-standard) families the book sells.
   *
   * They are structures, not a flag: `CUSTOM CROSSOVER GABLE BUILDING` and `CUSTOM CROSSOVER
   * SKILLION BUILDING` are rows 10 and 11 of `structure_type` with `is_nonstandard = 1`, and the
   * desktop's `IS_NON_STANDARD_BUILDING` flag is set from exactly that column
   * (`QuoteDetailsView.EventsStructureData.cs:32`). Without members here the exemption that flag
   * buys — the cantilever limit, and the wider dimension ranges — could never be reached, so the
   * branch was dead code.
   *
   * They carry `structure_lookup_code = 0` in the reference book, which means the book states **no
   * frame schedule** for them: the desktop designs those buildings by hand and the sections come
   * from an engineer, not from a table. So a quote on one of these prices its frame as an assumption
   * rather than as a looked-up row — which is the honest answer, and what `optimise.ts` already does
   * for any structure with no row.
   */
  | 'custom_gable'
  | 'custom_skillion';

/**
 * True for the structures whose roof falls to both long walls.
 *
 * A gable is a gable whether or not its bays are walled, and the price book says so: its
 * `structure_sub_code` names `CROSSOVER GABLE` for `gable`, `tophot_64`, `tophot_96`, `zed_shed`
 * (`GB_Z150` = *Crossover Gable, Series 6*), `aircraft_hangar` (`GB_AH`) and `cyclonic`
 * (`GB_Z100`), and `CROSSOVER GABLE - CARPORT SERIES` for `gable_carport`. Only the two skillions
 * are `CROSSOVER SKILLION`.
 *
 * So a principal rafter spans **half** the building in every family except a skillion, where the
 * roof falls the **whole width to one side** and the rafter is `width / cos(pitch)` — which is what
 * the desktop computes (`SkillionBuildingQuote.cs:242` divides the full width). Asking this question
 * instead of testing `structure === 'gable'` is what stops a skillion ordering half a rafter.
 */
export function fallsToBothSides(structure: StructureType): boolean {
  return (
    structure !== 'skillion' &&
    structure !== 'skillion_carport' &&
    structure !== 'custom_skillion'
  );
}

/** A door or window cut into one wall. */
export interface Opening {
  id: string;
  type: OpeningType;
  width: number; // mm
  height: number; // mm
  sill: number; // mm above floor; 0 for doors, >0 for raised windows
  wall: WallSide;
  align: AlignMode;
  offset: number | null; // mm from the wall's left corner (as seen from
  // outside); required when align === 'custom'
  swing: SwingDirection; // meaningful for pa_door / sliding_door only
  /** How the door runs; `null` for every type except a sliding door. */
  track: OpeningTrack | null;
  /**
   * The catalogue row the operator chose, or `null` for a typed size.
   *
   * Informational today: the door BOM matches a size ladder by width and height, so the
   * SKU does not change the price. It is stored because the desktop form starts from a
   * catalogue item and the operator expects to see the one they picked when they reopen
   * the quote.
   */
  sku?: string | null;
  /** "Opening Only": the frame is prepared and no door is fitted. */
  prepOnly?: boolean;
  /** Roller door series; the book prices width/height bands per series. */
  series?: 'A' | 'AA' | 'B' | null;
  /** Roller door windlocks. The desktop defaults them on in wind regions C and D. */
  windlock?: boolean;
  /** Sliding door only: how many track segments the opening spans (1–20). */
  trackSegments?: number;
  /** Sliding door only: the width each segment covers, 1000–6000 mm (desktop R11). */
  trackWidth?: number;
}

/** Hex colours applied to 3D materials and to the 2D door/roof panels. */
export interface ShedColors {
  wall: string; // hex
  roof: string; // hex
  /** Barge and fascia. */
  barge: string; // hex
  downpipe: string; // hex
  gutter: string; // hex
  window: string; // hex
  paDoor: string; // hex
  rollerDoor: string; // hex
  slidingDoor: string; // hex
  dividingWall: string; // hex
}

/**
 * The eleven kinds of object that can be added to a shed beyond its walls and
 * openings. Each kind is a separate shape in both renderers, so the union is
 * discriminated on `kind` rather than sharing one generic parameter bag.
 */
export type OptionKind =
  | 'skylight'
  | 'mezzanine'
  | 'awning'
  | 'outrigger'
  | 'dividing_wall'
  | 'gable_infill'
  | 'stable'
  | 'carry_beam'
  | 'horizontal_cladding'
  | 'overhang'
  | 'cantilever'
  | 'misc_option';

interface OptionBase {
  id: string;
  kind: OptionKind;
}

/**
 * A roof light. Anchored to a bay rather than to millimetres so it stays in its
 * bay when `length` or `bays` changes: `bay` is a 0-based index and `alongBay`
 * is the fraction across that bay (0 = bay start, 1 = bay end).
 */
export interface SkylightOption extends OptionBase {
  kind: 'skylight';
  bay: number;
  alongBay: number;
  width: number; // mm
  height: number; // mm, along the length axis
  /** The sheet it is glazed with; the two are priced from different profiles. */
  skylightType?: 'Corro' | 'TL-5';
}

/** A raised floor slab in one corner of the shed. */
export interface MezzanineOption extends OptionBase {
  kind: 'mezzanine';
  corner: 'front_left' | 'front_right' | 'back_left' | 'back_right';
  width: number; // mm, along the span
  depth: number; // mm, along the length
  level: number; // mm, floor level above the slab
  /**
   * Design floor load, kPa. The book prices four rates only (1.5/3/5/7.5); a load
   * outside the set is snapped on normalise rather than priced at zero.
   */
  floorLoad?: 1.5 | 3 | 5 | 7.5;
}

/** A roof extension projecting outward from one wall. */
export interface AwningOption extends OptionBase {
  kind: 'awning';
  wall: WallSide;
  align: AlignMode;
  offset: number | null; // mm along the wall; required when align === 'custom'
  width: number; // mm, along the wall
  depth: number; // mm, projection outward
  /** Roof pitch in degrees; the outer edge drops by the pitch over the projection. */
  pitchDeg?: number;
}

/** A beam bracket projecting from a column line on one wall. */
export interface OutriggerOption extends OptionBase {
  kind: 'outrigger';
  wall: WallSide;
  bay: number; // 0-based index of the column line it hangs from
  length: number; // mm, projection outward
  /** Mounting height above the floor, mm. Defaults to 2000 and never exceeds the wall. */
  height?: number;
}

/** An internal partition wall. */
export interface DividingWallOption extends OptionBase {
  kind: 'dividing_wall';
  /** `x` runs across the span; `y` runs along the length. */
  axis: 'x' | 'y';
  /** Offset from the plan origin along the other axis, mm. */
  at: number;
  height: number; // mm
}

/**
 * The triangle of wall above wall height that closes a gable end. A gable end
 * is either closed or open, so there is exactly one per end and no size: the
 * shape follows `span`, `height`, and `roofPitchDeg`.
 */
export interface GableInfillOption extends OptionBase {
  kind: 'gable_infill';
  end: 'front' | 'back';
}

/**
 * An animal shelter against an outside wall.
 *
 * Each of the four walls can be left off, which is what makes a stable usable:
 * the wall against the shed is usually omitted, and a field shelter often has
 * only three sides.
 */
export interface StableOption extends OptionBase {
  kind: 'stable';
  wall: WallSide;
  align: AlignMode;
  offset: number | null;
  width: number; // mm, along the wall
  depth: number; // mm, projection outward
  height: number; // mm
  panels: { left: boolean; right: boolean; front: boolean; back: boolean };
}

/**
 * A beam spanning a bay so the wall beneath it can be opened.
 *
 * `openingId` references the opening it spans, or `null` when the bay is
 * deliberately left open. Desktop models this with `ECarryBeamType`
 * (`LeftOpen | WithRollingDoor | WithWideRollingDoor | WithSlidingDoor`), which
 * repeats the opening's own type; a reference keeps one source of truth.
 */
export interface CarryBeamOption extends OptionBase {
  kind: 'carry_beam';
  wall: WallSide;
  beginBay: number; // 0-based bay index the beam crosses
  openingId: string | null;
}

/**
 * Horizontal battens on a wall face.
 *
 * Desktop's BOM names this "Sidewall tophat batten / STB": it is the fixing
 * substrate behind horizontal cladding, drawn as a band of horizontal lines.
 */
export interface HorizontalCladdingOption extends OptionBase {
  kind: 'horizontal_cladding';
  wall: WallSide;
  from: number; // mm above the floor
  to: number; // mm above the floor
}

/** The main roof plane extended past a wall, unlike an awning's separate sheet. */
export interface OverhangOption extends OptionBase {
  kind: 'overhang';
  wall: WallSide;
  depth: number; // mm outward
}

/** A beam projecting with no supporting column under it. */
export interface CantileverOption extends OptionBase {
  kind: 'cantilever';
  wall: WallSide;
  bay: number;
  length: number; // mm outward
}

/**
 * A catalogue accessory sold by quantity — insulation, bird proofing, a screen.
 *
 * Deliberately has **no geometry**: it is a line on the materials list, not a shape
 * on the plan. The name is the price book's `misc_option.option_name`, which is also
 * the key the lookup prices it by.
 */
export interface MiscOption extends OptionBase {
  kind: 'misc_option';
  /** The catalogue row's `option_name`, e.g. `Insulation - Foil 1200w`. */
  name: string;
  quantity: number;
  /** The catalogue row's unit, e.g. `ea`, `m`, `roll`. */
  unit: string;
}

export type ShedOption =
  | SkylightOption
  | MezzanineOption
  | AwningOption
  | OutriggerOption
  | DividingWallOption
  | GableInfillOption
  | StableOption
  | CarryBeamOption
  | HorizontalCladdingOption
  | OverhangOption
  | CantileverOption
  | MiscOption;

/**
 * A line on the Charges tab.
 *
 * Deliberately **not** a `ShedOption`: a charge has no geometry, cannot be
 * selected on the plan, and cannot be dragged, so putting it in the option union
 * would force every geometry function to handle a branch with nothing to draw.
 *
 * `unitPriceCents` is a whole number of cents so a subtotal over many lines
 * cannot accumulate floating-point drift.
 */
export interface Charge {
  id: string;
  label: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
}

/** Complete, self-contained shed specification. */
export interface ShedConfig {
  structureType: StructureType;
  span: number; // overall width / facade, mm
  length: number; // overall depth (bay direction), mm
  height: number; // wall height, mm
  roofPitchDeg: number; // 0..45
  bays: number; // 2..30, along `length`
  /**
   * The nominal spacing the bays were set to, mm.
   *
   * Stored rather than derived because the desktop lets a person type it and then
   * computes the overall length from it. `reconcileBays` keeps the three fields
   * consistent; `baySpacingMismatch` reports one that is not.
   */
  nomBaySpacing: number;
  /**
   * One length per bay, mm, summing exactly to `length`.
   *
   * Optional because it is **derived** when absent: equal division with the remainder in the last bay
   * (`bayWidthsFor`). It becomes present the moment somebody edits a single bay, which is the
   * desktop's `Adjust Bay Spacing` panel. Storing an array that merely repeats the division would be
   * a second copy of a fact and a chance for the two to disagree.
   *
   * Why it matters beyond the drawing: the frame table is keyed by the **largest** bay, so
   * 4 000/4 000/6 000 takes a different section from 4 666/4 666/4 666 at the same overall length.
   */
  bayWidths?: number[];
  openings: Opening[];
  /** Added objects, in creation order. Empty for a fresh shed. */
  options: ShedOption[];
  /** Charge lines for the Charges tab. Empty for a fresh shed. */
  charges: Charge[];
  /**
   * Wind-load coefficient for the whole building, not a placed object.
   * Desktop's `EInternalPressures`: closed is +0.2/−0.3, open is +0.7/−0.65.
   */
  internalPressure: 'closed' | 'open';
  /**
   * The wind region **as the certificate states it** — not a fixed list.
   *
   * ## Why this is a string, not `'A' | 'B' | 'C' | 'D'`
   *
   * ShedSafe does not answer with a letter. Across the 47 real buildings in the legacy licence
   * database the values it returned were `"A1"`, `"A2"`, `"A5"`, `"B1"` — and those are not cosmetic:
   * the price book's `devided` table is keyed by exactly those codes and they disagree. Measured
   * 2026-11-10 on the reference book:
   *
   * ```
   * A2 → purlin_span 720    A5 → purlin_span 830    A6 → purlin_span 1300
   * ```
   *
   * A wind region narrowed to `A` and then recombined as `A2` prices a **level-5 site as level 2**:
   * a smaller purlin at a shorter span, i.e. less steel than the certificate requires. That is the
   * same class of failure as the importance level being rewritten from 3 to 1, and it is worse
   * because it moves quantities rather than a label.
   *
   * So the stored value is whatever the certificate says, and `windRegionCode()` decides how to turn
   * it into a book key — keeping "what the certificate states" and "what the book is indexed by" as
   * two separate questions.
   */
  windRegion: WindRegion;
  /** AS/NZS 1170.2 terrain category. */
  terrainCategory: TerrainCategory;
  /** Wind shielding multiplier: 1.0 down to 0.8. */
  shieldingFactor: number;
  /**
   * BCA importance level: 1 normal, 2 high consequence, 3, 4.
   *
   * ## Why all four, when the price book only lists two
   *
   * Because **ShedSafe certifies against all four**, and this product's job is to record the rating
   * it was given. The type was `1 | 2`, and the store's normaliser is a `catch` chain — so a
   * certificate reading 3 was stored as **1**, silently, and the quote then printed
   * "Importance level 1" against a certificate that says 3. Measured 2026-11-10:
   * `normaliseShedConfig({ importanceLevel: 3 }).importanceLevel === 1`.
   *
   * Widening the type does not invent a price for levels 3 and 4: the shipped book has no
   * `view_system_lookup_data` rows for them (measured: 1 077 rows at level 1, 1 675 at level 2, none
   * above). It makes the **mismatch visible** instead of a wrong number — `frameSchedule` finds no
   * row, the frame falls back to one assumed section, and the BOM carries an assumption saying so.
   * That is the honest failure: a quote that says it could not price the building, rather than one
   * that prices a level-3 building as if it were level 1.
   */
  importanceLevel: ImportanceLevel;
  /** Topographic multiplier; 1.0 for flat ground. */
  topographyFactor: number;
  /** State the site is in, which selects the price margin. */
  stateCode: StateCode;
  /**
   * Wall sheeting profile, as the book names it (`'Corro'`, `'Lo-Rib'`, `'TL-5'`).
   *
   * Stored **without** the thickness. A `.sqd` joins the two (`'0.35 TL-5'`) and
   * `parseSheeting` splits them on import, because the book's lookup is keyed by the pair and a
   * joined string matches no row.
   */
  wallProfile: string;
  /** Roof sheeting profile. See `wallProfile`. */
  roofProfile: string;
  /**
   * Wall sheet thickness, mm (`0.35`, `0.42`, `0.48`).
   *
   * Separate from the profile because the book prices the **pair**: on the reference book a
   * `Corro` sheet is 8.45/m at 0.42 and 9.93/m at 0.48, a 17% difference on every square metre of
   * wall. Absent means the default the BOM has always used (0.42), which is why it is optional
   * rather than required — an old revision did not record it.
   */
  wallBmt?: number;
  /** Roof sheet thickness, mm. See `wallBmt`. */
  roofBmt?: number;
  /** Downpipe catalogue code. */
  downpipeType: string;
  /** Footing type code; the sub-type list is filtered by it. */
  footingType: string;
  /** Footing sub-type code. */
  footingSubType: string;
  /**
   * Wall-open switches from the desktop's Design block.
   *
   * A shed with an end or side wall open is priced for a different internal
   * pressure, so these are part of the building rather than a display preference.
   */
  endOpening: { left: boolean; right: boolean };
  sideOpening: { front: boolean; back: boolean };
  /** Certified ShedSafe values, read-only in the form. `null` = not calculated. */
  buildingClass: string | null;
  /** Ground snow load, kPa, from the ShedSafe check. */
  snowLoad: number | null;
  /** Design wind speed, m/s, from the ShedSafe check. */
  designWindSpeed: number | null;
  colors: ShedColors;
  displayUnit: DisplayUnit;
}

/**
 * A wind region code, as the certificate states it.
 *
 * The four AS/NZS 1170.2 regions are `A`–`D`, but ShedSafe issues **site codes** that carry a terrain
 * digit as well — `A1`, `A2`, `A5`, `B1` — and the price book is indexed by those codes, not by the
 * bare region. See `ShedConfig.windRegion` for the measured difference between them.
 *
 * Typed as `string` rather than a union on purpose: a certificate is an external document, and a
 * union would make the compiler reject a valid code the day ShedSafe adds one — turning a data fact
 * into a build error, and tempting the next person to add a `.catch()` that silently substitutes
 * another code. The known codes are documented on `KNOWN_WIND_REGIONS` instead, for a UI that wants
 * to offer them.
 */
export type WindRegion = string;

/** Terrain categories used for Australian shed design. */
export type TerrainCategory = 2 | 2.5 | 3;

/**
 * BCA importance levels 1 to 4.
 *
 * Four values because ShedSafe certifies against four. The price book happens to list only 1 and 2,
 * and that is a **book** fact, not a limit on what a quote may record — see `ShedConfig.importanceLevel`.
 */
export type ImportanceLevel = 1 | 2 | 3 | 4;

/** The eight Australian states and territories, as the price book spells them. */
export type StateCode = 'ACT' | 'NSW' | 'NT' | 'QLD' | 'SA' | 'TAS' | 'VIC' | 'WA';
