/**
 * Shed options: defaults, physical bounds, and millimetre geometry.
 *
 * An option is an object added to a shed beyond its walls and openings — a
 * skylight, a mezzanine, an awning, an outrigger, a dividing wall, or the infill
 * that closes a gable end. This module owns everything about them that is pure
 * maths: what a fresh instance looks like, what values are physically legal, and
 * where the shape lands in plan and in height.
 *
 * Anchors are **relative**, never absolute: a skylight is placed by bay index and
 * a fraction across that bay, a mezzanine by the corner it hugs. That is what
 * lets an option survive a change to `span`, `length`, or `bays` — an absolute
 * X/Y would leave a mezzanine hanging outside a shed that shrank. The one
 * exception is a dividing wall's `at`, which is an absolute offset and therefore
 * clamps when the shed gets shorter; there is no meaningful relative position for
 * a partition near an end that no longer exists.
 *
 * Bounds mirror the desktop application's dictionaries (`DMezzanine`, `DAwning`,
 * `DOptions`) where they exist, and otherwise express the physical constraint
 * (a shape cannot exceed the shed that contains it).
 *
 * Plan convention, matching `plan.ts`: `x` runs along the span (`0 .. span`),
 * `y` along the length (`0 .. length`), origin at the front-left corner. All
 * values are millimetres, integers, except `alongBay` which is a 0..1 fraction.
 *
 * Pure TypeScript: no React, Next.js, Zustand, Konva, or three.
 */

import { computeBayPositions } from './bays';
import type {
  AwningOption,
  CantileverOption,
  CarryBeamOption,
  DividingWallOption,
  HorizontalCladdingOption,
  MezzanineOption,
  OptionKind,
  OutriggerOption,
  OverhangOption,
  ShedConfig,
  ShedOption,
  SkylightOption,
  StableOption,
  WallSide,
  MiscOption,
} from './types';

/** A plan-space rectangle in millimetres. */
export interface ResolvedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * An option resolved into plan coordinates and a height range. The renderers
 * consume this and draw; neither derives any geometry of its own.
 */
export interface ResolvedOption {
  id: string;
  kind: OptionKind;
  /** Plan footprint. For a gable infill this is the end strip. */
  rect: ResolvedRect;
  /** Lowest point above the floor, mm. */
  zLow: number;
  /** Highest point above the floor, mm. */
  zHigh: number;
  /** Present for a gable infill only: the triangle above wall height. */
  triangle?: { base: number; rise: number };
  /** Present for a dividing wall only: which axis it runs along. */
  along?: 'x' | 'y';
  /** Present for a stable only: which of its four walls are built. */
  panels?: { left: boolean; right: boolean; front: boolean; back: boolean };
}

// --- Bounds ----------------------------------------------------------------

const SKYLIGHT_MIN = 300;
const SKYLIGHT_MAX = 3000;
const MEZZ_MIN = 1000;
const MEZZ_LEVEL_MIN = 2100;
/** The four design loads the book prices; anything else snaps into this set. */
const MEZZ_LOADS = [1.5, 3, 5, 7.5] as const;
/** Clearance between a mezzanine's top and the eaves, mm. */
const MEZZ_HEADROOM = 300;
/** Slab thickness, mm. */
const MEZZ_SLAB = 150;
const AWNING_MIN_WIDTH = 1000;
const AWNING_MIN_DEPTH = 500;
const AWNING_MAX_DEPTH = 3000;
const OUTRIGGER_MIN = 500;
const OUTRIGGER_MAX = 3000;
/** Clearance between a dividing wall and the walls it runs between, mm. */
const DIVIDING_MARGIN = 300;
const DIVIDING_MIN_HEIGHT = 1000;
/** Drawn thickness of a dividing wall and of a gable-infill strip, mm. */
const PARTITION_THICKNESS = 100;
/** Half-width of an outrigger's drawn footprint, mm. */
const OUTRIGGER_HALF_WIDTH = 100;
/** Depth of the strip a gable infill is drawn in, mm. */
const GABLE_STRIP_DEPTH = 100;

/** Stable bounds, from the desktop's `MStableOption` and physical sense. */
const STABLE_MIN_WIDTH = 1500;
const STABLE_MAX_WIDTH = 6000;
const STABLE_MIN_DEPTH = 1200;
const STABLE_MAX_DEPTH = 6000;
const STABLE_MIN_HEIGHT = 1800;
const STABLE_MAX_HEIGHT = 3000;
/** Overhang: how far the main roof may extend past a wall, mm. */
const OVERHANG_MIN = 300;
const OVERHANG_MAX = 2000;
/** Cantilever projection, mm. */
const CANTILEVER_MIN = 500;
const CANTILEVER_MAX = 3000;
/** Drawn depth of a carry beam's footprint, mm. */
const CARRY_BEAM_DEPTH = 200;
/** How far a beam's underside sits below the eaves, mm. */
const CARRY_BEAM_DROP = 300;
/** A cladding band must be at least this tall, mm. */
const CLADDING_MIN_BAND = 100;

/** The id prefix each kind mints, so a log line names its kind. */
const ID_PREFIX: Record<OptionKind, string> = {
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

/** Clamp a value into `[min, max]`, rounding to whole millimetres. */
function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), max));
}

/**
 * The nearest load the book prices.
 *
 * Ties go **up**, the structurally safer side: a 4 kPa request becomes 5, not 3, so the
 * frame is never specified lighter than the operator asked for.
 */
function nearestMezzanineLoad(value: number | undefined): 1.5 | 3 | 5 | 7.5 {
  if (value === undefined || !Number.isFinite(value)) return 1.5;
  for (const load of MEZZ_LOADS) {
    if (value <= load) return load;
  }
  return 7.5;
}

/** A fresh id for one instance of `kind`. */
function mintId(kind: OptionKind): string {
  const suffix = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  return `${ID_PREFIX[kind]}-${suffix}`;
}

/** The run of `wall` in millimetres: front/back along the span, left/right along the length. */
function wallRun(shed: ShedConfig, wall: WallSide): number {
  return wall === 'front' || wall === 'back' ? shed.span : shed.length;
}

/**
 * The roof rise above wall height at plan position `(x, y)`.
 *
 * A gable roof rises from both eaves to a ridge at mid-span, so its height
 * depends only on `x`. A skillion (and every carport/tophot variant that shares
 * its single plane) falls **along the length**, matching `buildRoofGeometry` in
 * `Shed3D`: the high edge is at `y = 0` and the fall runs to `y = length`. Using
 * `x` for the skillion would put a skylight up to a metre inside the roof on one
 * side of the building and floating above it on the other.
 *
 * `height` is the wall height, not the roof height, which is why the rise is
 * added to it rather than replacing it.
 */
function roofRiseAt(shed: ShedConfig, x: number, y: number): number {
  const pitch = (shed.roofPitchDeg * Math.PI) / 180;
  const rise = Math.tan(pitch);
  if (shed.structureType === 'skillion' || shed.structureType === 'skillion_carport') {
    return rise * Math.max(0, shed.length - y);
  }
  return rise * Math.min(x, shed.span - x);
}

// --- Defaults --------------------------------------------------------------

/**
 * The instance(s) a "+" creates for `kind`.
 *
 * Gable infill is the exception to one-per-call: a gable end is either closed or
 * open, and creating one while leaving the other open is never what a user
 * means, so both ends are created together. They are still separate instances,
 * so removing one later is an ordinary `removeOption`.
 */
export function defaultOptionsFor(kind: OptionKind, shed: ShedConfig): ShedOption[] {
  switch (kind) {
    case 'skylight':
      return [
        {
          id: mintId(kind),
          kind,
          // The middle bay: with an even count there are two middle bays and
          // the later one wins, so a 4-bay shed centres on bay index 2.
          bay: Math.floor(shed.bays / 2),
          alongBay: 0.5,
          width: 900,
          height: 900,
        } satisfies SkylightOption,
      ];
    case 'mezzanine':
      return [
        {
          id: mintId(kind),
          kind,
          corner: 'back_left',
          width: Math.min(3000, shed.span),
          depth: Math.min(3000, shed.length),
          level: 2400,
        } satisfies MezzanineOption,
      ];
    case 'awning':
      return [
        {
          id: mintId(kind),
          kind,
          wall: 'front',
          align: 'center',
          offset: null,
          width: Math.min(3000, shed.span),
          depth: 1000,
        } satisfies AwningOption,
      ];
    case 'outrigger':
      return [
        { id: mintId(kind), kind, wall: 'front', bay: 0, length: 1900 } satisfies OutriggerOption,
      ];
    case 'dividing_wall':
      return [
        {
          id: mintId(kind),
          kind,
          axis: 'x',
          at: Math.round(shed.length / 2),
          height: shed.height,
        } satisfies DividingWallOption,
      ];
    case 'gable_infill':
      return [
        { id: mintId(kind), kind, end: 'front' },
        { id: mintId(kind), kind, end: 'back' },
      ];
    case 'stable':
      return [
        {
          id: mintId(kind),
          kind,
          wall: 'front',
          align: 'center',
          offset: null,
          width: Math.min(3000, shed.span),
          depth: 2400,
          height: 2400,
          panels: { left: true, right: true, front: true, back: true },
        } satisfies StableOption,
      ];
    case 'carry_beam':
      return [
        { id: mintId(kind), kind, wall: 'front', beginBay: 0, openingId: null } satisfies CarryBeamOption,
      ];
    case 'horizontal_cladding':
      return [
        {
          id: mintId(kind),
          kind,
          wall: 'front',
          from: 0,
          to: shed.height,
        } satisfies HorizontalCladdingOption,
      ];
    case 'overhang':
      return [{ id: mintId(kind), kind, wall: 'front', depth: 600 } satisfies OverhangOption];
    case 'cantilever':
      return [
        { id: mintId(kind), kind, wall: 'front', bay: 0, length: 1200 } satisfies CantileverOption,
      ];
    case 'misc_option':
      return [{ id: mintId(kind), kind, name: '', quantity: 1, unit: 'ea' } satisfies MiscOption];
  }
}

// --- Normalisation ---------------------------------------------------------

/**
 * Clamp one option to what is physically legal for `shed`, rounding every
 * numeric field to whole millimetres.
 *
 * This is the single place the bounds live, so a value can never reach the store
 * outside them — including values that were legal when the option was created but
 * are not after the user shrank the shed.
 */
export function normaliseOption(option: ShedOption, shed: ShedConfig): ShedOption {
  switch (option.kind) {
    case 'misc_option':
      return {
        ...option,
        name: option.name.trim().slice(0, 120),
        quantity: clamp(option.quantity, 1, 999),
        unit: option.unit.trim() === '' ? 'ea' : option.unit.trim().slice(0, 20),
      };
    case 'skylight': {
      const bay = clamp(option.bay, 0, Math.max(0, shed.bays - 1));
      const limit = Math.min(SKYLIGHT_MAX, shed.span, shed.length);
      return {
        ...option,
        bay,
        alongBay: Math.min(0.9, Math.max(0.1, option.alongBay)),
        width: clamp(option.width, Math.min(SKYLIGHT_MIN, limit), limit),
        height: clamp(option.height, Math.min(SKYLIGHT_MIN, limit), limit),
        skylightType: option.skylightType === 'TL-5' ? 'TL-5' : 'Corro',
      };
    }
    case 'mezzanine':
      return {
        ...option,
        width: clamp(option.width, Math.min(MEZZ_MIN, shed.span), shed.span),
        depth: clamp(option.depth, Math.min(MEZZ_MIN, shed.length), shed.length),
        level: clamp(option.level, MEZZ_LEVEL_MIN, Math.max(MEZZ_LEVEL_MIN, shed.height - MEZZ_HEADROOM)),
        floorLoad: nearestMezzanineLoad(option.floorLoad),
      };
    case 'awning': {
      const run = wallRun(shed, option.wall);
      return {
        ...option,
        width: clamp(option.width, Math.min(AWNING_MIN_WIDTH, run), run),
        depth: clamp(option.depth, AWNING_MIN_DEPTH, AWNING_MAX_DEPTH),
        offset: option.offset === null ? null : Math.max(0, Math.round(option.offset)),
        // Rounded to the half-degree the desktop's pitch dropdown offers.
        pitchDeg: Math.round(Math.min(Math.max(option.pitchDeg ?? 5, 0), 45) * 2) / 2,
      };
    }
    case 'outrigger':
      return {
        ...option,
        bay: clamp(option.bay, 0, Math.max(0, shed.bays - 1)),
        length: clamp(option.length, OUTRIGGER_MIN, OUTRIGGER_MAX),
        height: clamp(option.height ?? 2000, 0, shed.height),
      };
    case 'dividing_wall': {
      const run = option.axis === 'x' ? shed.length : shed.span;
      // A shed shorter than the two margins has no legal interior position; the
      // midpoint is the honest fallback rather than a negative bound.
      const min = Math.min(DIVIDING_MARGIN, Math.round(run / 2));
      const max = Math.max(min, run - DIVIDING_MARGIN);
      return {
        ...option,
        at: clamp(option.at, min, max),
        height: clamp(option.height, Math.min(DIVIDING_MIN_HEIGHT, shed.height), shed.height),
      };
    }
    case 'gable_infill':
      return option;

    case 'stable': {
      const run = wallRun(shed, option.wall);
      const width = clamp(
        option.width,
        Math.min(STABLE_MIN_WIDTH, run),
        Math.min(STABLE_MAX_WIDTH, run),
      );
      const depth = clamp(option.depth, STABLE_MIN_DEPTH, STABLE_MAX_DEPTH);
      // The offset is resolved from `align` first, then clamped so the shelter
      // stays on its wall — the same rule an awning follows.
      const offset = alignOffset(option.align, option.offset, width, run);
      return {
        ...option,
        width,
        depth,
        height: clamp(option.height, STABLE_MIN_HEIGHT, STABLE_MAX_HEIGHT),
        offset,
      };
    }

    case 'carry_beam':
      return {
        ...option,
        beginBay: clamp(option.beginBay, 0, Math.max(0, shed.bays - 1)),
      };

    case 'horizontal_cladding': {
      // `from` is clamped first, then `to` against the space above it. That
      // ordering is what makes an inverted band (from > to) legal again instead
      // of leaving a zero-height strip.
      const from = clamp(option.from, 0, Math.max(0, shed.height - CLADDING_MIN_BAND));
      return {
        ...option,
        from,
        to: clamp(option.to, from + Math.min(CLADDING_MIN_BAND, shed.height), shed.height),
      };
    }

    case 'overhang':
      return { ...option, depth: clamp(option.depth, OVERHANG_MIN, OVERHANG_MAX) };

    case 'cantilever':
      return {
        ...option,
        bay: clamp(option.bay, 0, Math.max(0, shed.bays - 1)),
        length: clamp(option.length, CANTILEVER_MIN, CANTILEVER_MAX),
      };
  }
}

// --- Geometry --------------------------------------------------------------

/** The bay interval `[start, end]` that `bay` names, clamped into the shed. */
function bayInterval(shed: ShedConfig, bay: number): { start: number; end: number } {
  const positions = computeBayPositions(shed.length, shed.bays);
  const index = Math.min(Math.max(0, Math.round(bay)), positions.length - 2);
  return { start: positions[index], end: positions[index + 1] };
}

/** Resolve one option into plan millimetres and a height range. */
export function resolveOption(option: ShedOption, shed: ShedConfig): ResolvedOption {
  const normalised = normaliseOption(option, shed);

  switch (normalised.kind) {
    case 'misc_option':
      // A catalogue line is not a shape: no plan rect, no height, nothing to draw.
      return {
        id: normalised.id,
        kind: normalised.kind,
        rect: { x: 0, y: 0, width: 0, height: 0 },
        zLow: 0,
        zHigh: 0,
      };
    case 'skylight': {
      const { start, end } = bayInterval(shed, normalised.bay);
      const centreY = start + (end - start) * normalised.alongBay;
      const y = Math.min(Math.max(centreY - normalised.height / 2, 0), shed.length - normalised.height);
      const x = Math.min(Math.max(shed.span / 2 - normalised.width / 2, 0), shed.span - normalised.width);
      const z = shed.height + roofRiseAt(shed, x + normalised.width / 2, y + normalised.height / 2);
      return {
        id: normalised.id,
        kind: normalised.kind,
        rect: { x, y, width: normalised.width, height: normalised.height },
        zLow: z,
        zHigh: z,
      };
    }

    case 'mezzanine': {
      const x = normalised.corner === 'front_left' || normalised.corner === 'back_left'
        ? 0
        : shed.span - normalised.width;
      const y = normalised.corner === 'front_left' || normalised.corner === 'front_right'
        ? 0
        : shed.length - normalised.depth;
      return {
        id: normalised.id,
        kind: normalised.kind,
        rect: { x, y, width: normalised.width, height: normalised.depth },
        zLow: normalised.level,
        zHigh: normalised.level + MEZZ_SLAB,
      };
    }

    case 'awning': {
      const run = wallRun(shed, normalised.wall);
      const u = alignOffset(normalised.align, normalised.offset, normalised.width, run);
      return {
        id: normalised.id,
        kind: normalised.kind,
        rect: wallStrip(shed, normalised.wall, u, normalised.width, normalised.depth),
        // The awning hangs from the wall at eave height and falls by the pitch over its
        // projection, so the outer edge is lower than the wall.
        zLow: shed.height - Math.round(normalised.depth * Math.tan(((normalised.pitchDeg ?? 5) * Math.PI) / 180)),
        zHigh: shed.height,
      };
    }

    case 'outrigger': {
      // An outrigger hangs from a **column line**, not the middle of a bay: the
      // column sits at the bay's start. `bay` indexes those lines, and the last
      // bay's end line is reachable with `bay === bays`, which is why the line
      // is looked up rather than derived from the bay interval.
      const positions = computeBayPositions(shed.length, shed.bays);
      const index = Math.min(Math.max(0, Math.round(normalised.bay)), positions.length - 1);
      const run = wallRun(shed, normalised.wall);
      // Front/back walls run along the span, so their column lines are the bay
      // lines projected onto the span; left/right walls run along the length and
      // use the bay line directly. Clamping keeps the strip on the wall.
      const along = Math.min(Math.max(positions[index], 0), run);
      const half = OUTRIGGER_HALF_WIDTH;
      const u = Math.min(Math.max(along - half, 0), Math.max(0, run - half * 2));
      return {
        id: normalised.id,
        kind: normalised.kind,
        rect: wallStrip(shed, normalised.wall, u, half * 2, normalised.length),
        zLow: normalised.height ?? 2000,
        zHigh: normalised.height ?? 2000,
      };
    }

    case 'dividing_wall': {
      const rect = normalised.axis === 'x'
        ? {
            x: 0,
            y: normalised.at - PARTITION_THICKNESS / 2,
            width: shed.span,
            height: PARTITION_THICKNESS,
          }
        : {
            x: normalised.at - PARTITION_THICKNESS / 2,
            y: 0,
            width: PARTITION_THICKNESS,
            height: shed.length,
          };
      return {
        id: normalised.id,
        kind: normalised.kind,
        rect,
        zLow: 0,
        zHigh: normalised.height,
        along: normalised.axis,
      };
    }

    case 'gable_infill': {
      const rise = Math.tan((shed.roofPitchDeg * Math.PI) / 180) * (shed.span / 2);
      return {
        id: normalised.id,
        kind: normalised.kind,
        rect: {
          x: 0,
          y: normalised.end === 'front' ? 0 : shed.length - GABLE_STRIP_DEPTH,
          width: shed.span,
          height: GABLE_STRIP_DEPTH,
        },
        zLow: shed.height,
        zHigh: shed.height + rise,
        triangle: { base: shed.span, rise },
      };
    }

    case 'stable': {
      const run = wallRun(shed, normalised.wall);
      const u = alignOffset(normalised.align, normalised.offset, normalised.width, run);
      return {
        id: normalised.id,
        kind: normalised.kind,
        rect: wallStrip(shed, normalised.wall, u, normalised.width, normalised.depth),
        zLow: 0,
        zHigh: normalised.height,
        panels: normalised.panels,
      };
    }

    case 'carry_beam': {
      const { start, end } = bayInterval(shed, normalised.beginBay);
      // `bayInterval` is measured along the **length**, which is the wall-local
      // axis only on a left/right wall. On a front/back wall the run is the
      // span, so the interval is clamped into it — otherwise bay 2 and 3 of a
      // 12 m x 24 m shed place the beam outside the building.
      const run = wallRun(shed, normalised.wall);
      const length = Math.min(end - start, run);
      const u = Math.min(Math.max(start, 0), Math.max(0, run - length));
      return {
        id: normalised.id,
        kind: normalised.kind,
        rect: wallStrip(shed, normalised.wall, u, length, CARRY_BEAM_DEPTH),
        zLow: Math.max(0, shed.height - CARRY_BEAM_DROP),
        zHigh: shed.height,
      };
    }

    case 'horizontal_cladding': {
      const run = wallRun(shed, normalised.wall);
      return {
        id: normalised.id,
        kind: normalised.kind,
        rect: wallStrip(shed, normalised.wall, 0, run, PARTITION_THICKNESS),
        zLow: normalised.from,
        zHigh: normalised.to,
      };
    }

    case 'overhang': {
      const run = wallRun(shed, normalised.wall);
      // An overhang continues the roof plane **past** the wall, so it sits at
      // the eave: wall height, no rise. Using the rise at mid-span put it at
      // ridge height — a metre above the roof on a 10-degree gable.
      const z = shed.height;
      return {
        id: normalised.id,
        kind: normalised.kind,
        rect: wallStrip(shed, normalised.wall, 0, run, normalised.depth),
        zLow: z,
        zHigh: z,
      };
    }

    case 'cantilever': {
      const positions = computeBayPositions(shed.length, shed.bays);
      const index = Math.min(Math.max(0, Math.round(normalised.bay)), positions.length - 1);
      const run = wallRun(shed, normalised.wall);
      const half = OUTRIGGER_HALF_WIDTH;
      const u = Math.min(Math.max(positions[index] - half, 0), Math.max(0, run - half * 2));
      return {
        id: normalised.id,
        kind: normalised.kind,
        rect: wallStrip(shed, normalised.wall, u, half * 2, normalised.length),
        zLow: Math.max(0, shed.height - CARRY_BEAM_DROP),
        zHigh: shed.height,
      };
    }
  }
}

/**
 * Whether a second instance of `option` would be a distinct thing.
 *
 * An overhang and a cladding band span their whole wall, so a duplicate lands on
 * top of the original: the copy is either invisible or, once nudged, a
 * physically meaningless second roof over the same wall. Every other kind has a
 * position along its wall, so a copy is visibly somewhere else.
 */
export function canDuplicate(option: ShedOption): boolean {
  return option.kind !== 'overhang' && option.kind !== 'horizontal_cladding';
}

/**
 * The bay interval a carry beam crosses, in millimetres along the length.
 *
 * Exported because the beam's editor shows which opening it spans, and the
 * caller needs the same interval the resolver used.
 */
export function carryBeamSpan(shed: ShedConfig, beam: CarryBeamOption): { start: number; end: number } {
  return bayInterval(shed, beam.beginBay);
}

/**
 * True when an option of this kind is a shape on the plan.
 *
 * A catalogue accessory is a line on the materials list, not a drawing. Keeping the
 * predicate here — beside the resolver — means the plan, the model and the "no longer
 * fits" check all agree about which kinds to ask for, instead of each filtering by
 * name.
 */
export function hasPlanGeometry(kind: OptionKind): boolean {
  return kind !== 'misc_option';
}

/** Resolve every stored option that has a shape, in creation order. */
export function resolveOptions(shed: ShedConfig): ResolvedOption[] {
  return shed.options
    .filter((option) => hasPlanGeometry(option.kind))
    .map((option) => resolveOption(option, shed));
}

/**
 * The wall-local offset an `align` mode resolves to, clamped into the wall.
 *
 * Mirrors `resolveOpeningPlacement`'s rule so an awning lines up with a door
 * placed by the same vocabulary.
 */
function alignOffset(
  align: AwningOption['align'],
  offset: number | null,
  width: number,
  run: number,
): number {
  const max = Math.max(0, run - width);
  switch (align) {
    case 'left':
      return 0;
    case 'right':
      return max;
    case 'custom':
      return Math.min(Math.max(offset ?? 0, 0), max);
    case 'center':
    default:
      return max / 2;
  }
}

/**
 * The plan rect of a strip on `wall` that starts `u` along it and projects
 * `depth` outward from the building.
 *
 * Wall-local `u` runs from the wall's left corner as seen from outside, which is
 * the same convention openings use (`planPointToWallU`). The projection is what
 * makes an awning or outrigger visible outside the footprint in plan.
 */
function wallStrip(
  shed: ShedConfig,
  wall: WallSide,
  u: number,
  width: number,
  depth: number,
): ResolvedRect {
  switch (wall) {
    case 'front':
      return { x: u, y: -depth, width, height: depth };
    case 'back':
      return { x: shed.span - u - width, y: shed.length, width, height: depth };
    case 'left':
      return { x: -depth, y: shed.length - u - width, width: depth, height: width };
    case 'right':
      return { x: shed.span, y: u, width: depth, height: width };
  }
}
