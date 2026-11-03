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
  | 'cyclonic';

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
}

/** Hex colours applied to 3D materials and to the 2D door/roof panels. */
export interface ShedColors {
  wall: string; // hex
  roof: string; // hex
  trim: string; // hex
  door: string; // hex
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
  | 'cantilever';

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
}

/** A raised floor slab in one corner of the shed. */
export interface MezzanineOption extends OptionBase {
  kind: 'mezzanine';
  corner: 'front_left' | 'front_right' | 'back_left' | 'back_right';
  width: number; // mm, along the span
  depth: number; // mm, along the length
  level: number; // mm, floor level above the slab
}

/** A roof extension projecting outward from one wall. */
export interface AwningOption extends OptionBase {
  kind: 'awning';
  wall: WallSide;
  align: AlignMode;
  offset: number | null; // mm along the wall; required when align === 'custom'
  width: number; // mm, along the wall
  depth: number; // mm, projection outward
}

/** A beam bracket projecting from a column line on one wall. */
export interface OutriggerOption extends OptionBase {
  kind: 'outrigger';
  wall: WallSide;
  bay: number; // 0-based index of the column line it hangs from
  length: number; // mm, projection outward
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
  | CantileverOption;

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
   * Site conditions, in the vocabulary ShedSafe publishes.
   *
   * These are not decoration: the purlin/girt span table is indexed by the wind
   * region and terrain, and an Australian quote must state them (ShedSafe warns
   * that a quote using obsolete `W41`/`N2` codes is a red flag). They live on the
   * config rather than being passed alongside it so that freezing a quote
   * revision freezes the conditions it was priced under.
   */
  windRegion: WindRegion;
  /** AS/NZS 1170.2 terrain category. */
  terrainCategory: TerrainCategory;
  /** Wind shielding multiplier: 1.0 down to 0.8. */
  shieldingFactor: number;
  /** BCA importance level: 1 (normal) or 2. */
  importanceLevel: 1 | 2;
  /** Topographic multiplier; 1.0 for flat ground. */
  topographyFactor: number;
  /** State the site is in, which selects the price margin. */
  stateCode: StateCode;
  colors: ShedColors;
  displayUnit: DisplayUnit;
}

/** The four AS/NZS 1170.2 wind regions. */
export type WindRegion = 'A' | 'B' | 'C' | 'D';

/** Terrain categories used for Australian shed design. */
export type TerrainCategory = 2 | 2.5 | 3;

/** The eight Australian states and territories, as the price book spells them. */
export type StateCode = 'ACT' | 'NSW' | 'NT' | 'QLD' | 'SA' | 'TAS' | 'VIC' | 'WA';
