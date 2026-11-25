/**
 * Everything the 3D view draws that is not a wall or an opening: the roof, its trim, the gutters,
 * and the steel frame.
 *
 * ## Why it lives here and not in the component
 *
 * Two rules decide this file's shape.
 *
 * 1. **Draw only what the quote includes.** Every piece below corresponds to a BOM group that is
 *    always present (`gutter.ts` emits gutters, downpipes, ridge, barge and eave capping for every
 *    building; `frame.ts` emits columns and rafters; `purlin.ts` emits roof purlins and wall girts).
 *    The one exception is the gable end: a gable triangle is **closed** on a building with end walls,
 *    but `gable_infill` has no BOM line at all (`lib/bom/options.ts:400-403`), which is a gap on the
 *    quoting side recorded in `docs/KNOWN-DEVIATIONS.md`. Drawing it is right; pricing it is still to
 *    do.
 * 2. **No guessing.** Purlin and girt row positions come from the price book's span table, which the
 *    client never sees until an evaluation runs. `frameRows()` therefore takes a layout rather than
 *    computing one: before an evaluation there are no purlins to draw, and that is the honest state.
 *
 * All values are millimetres in the shed's own frame: `x` across the span, `y` up from the floor,
 * `z` along the length. A renderer scales by 1/1000.
 *
 * Pure TypeScript: no React, Next.js, Zustand, Konva, or three.
 */

import type { DimensionedShed, WallSide } from './types';
import { fallsToBothSides } from './types';
import { skillionRiseMm } from './roof';
import { bayWidthsFor, positionsFromWidths } from './bays';
import { wallHolesFor } from './walls';
import type { OpeningPart } from './openings3d';

/** A part of the shell — the same descriptor the opening hardware uses. */
export type StructurePart = OpeningPart;

/** Roof eave overhang beyond the wall line, mm. */
export const EAVE = 300;
/** Roof sheet thickness, mm. */
export const ROOF_SHEET = 40;
/**
 * Wall cladding thickness, mm.
 *
 * Lives here because the frame has to be placed **behind** it. The cladding is extruded from the wall
 * line inward (`ExtrudeGeometry` depth 50 in `Shed3D`), so its outer face is the plane `x = 0` on the
 * left wall and `x = span` on the right. A column whose own face lands on that plane z-fights the
 * sheet — the flicker a person sees as "chờp chờp" — so every steel member starts at `WALL_DEPTH`.
 */
export const WALL_DEPTH = 50;
/** Frame member section, mm. */
export const FRAME_SECTION = 150;
/** Purlin and girt section, mm. */
export const PURLIN_SECTION = 100;
/** Floor slab thickness, mm. */
export const SLAB = 150;
/** Gutter diameter, mm. */
export const GUTTER_RADIUS = 85;
/** Downpipe diameter, mm. */
export const DOWNPIPE_RADIUS = 48;
/**
 * Height of the base trim along the foot of every sheeted wall, mm.
 *
 * 75 mm: the desktop's corner flashing reaches the wall height and its eave capping is a similar
 * profile, so a base of the same order reads as the same flashing system rather than as a skirting
 * board. It is deep enough to cover the bottom row of fixings and the sheet's cut edge, and shallow
 * enough that a 2.4 m wall still looks like a wall.
 *
 * **3D only.** The desktop's flashing list (`EFlashingType`) has no base profile, and this build's
 * BOM emits none — see `docs/KNOWN-DEVIATIONS.md`. This is a drawing of the bottom detail, not a
 * priced line.
 */
export const BASE_TRIM_HEIGHT = 75;
/** How far the base and corner trim stand off the sheeting, mm. */
export const BASE_TRIM_PROUD = 3;
/**
 * How far the same trim laps *into* the cladding, mm.
 *
 * A flashing whose back face sat exactly on the sheeting plane would share a surface with it and
 * flicker. One millimetre of lap puts the back face inside the 50 mm cladding volume, where nothing
 * can be coplanar with it.
 */
export const BASE_TRIM_LAP = 1;
/** Full thickness of the base and corner trim, mm. */
export const BASE_TRIM_THICK = BASE_TRIM_PROUD + BASE_TRIM_LAP;
/** Face width of one leg of the corner trim, mm. */
export const CORNER_TRIM_FACE = 60;
/**
 * How far the corner trim stands off the sheeting, mm.
 *
 * One millimetre prouder than the base trim. Both run the wall's full height at the corner, so at
 * equal stand-off their outer faces would be the **same plane** for the bottom 75 mm — two coplanar
 * surfaces, which is the flicker this codebase has chased twice. A corner flashing laps a base
 * flashing in reality, and 1 mm is enough to say so.
 */
export const CORNER_TRIM_PROUD = BASE_TRIM_PROUD + 1;
/** Full thickness of the corner trim, mm. */
export const CORNER_TRIM_THICK = CORNER_TRIM_PROUD + BASE_TRIM_LAP;
/** Face width of one wing of the ridge cap, mm, measured down each slope. */
export const RIDGE_CAP_WING = 175;
/** Face width of a barge flashing, mm — one leg down the raking edge, one under the sheet. */
export const BARGE_FACE = 100;
/** How thick a flashing is, mm. */
export const FLASHING_THICK = 3;

/** True when the roof falls to both sides of a ridge (a gable), not to one (a skillion). */
export function hasRidge(shed: Pick<DimensionedShed, 'structureType'>): boolean {
  return fallsToBothSides(shed.structureType);
}

/**
 * True when the building has end walls, so its gable triangles are closed.
 *
 * A carport is a roof on columns: it has no wall sheeting (`isOpenStructure` in
 * `lib/bom/groups/sheeting.ts`), so there is no end wall for a triangle to sit on.
 */
export function hasEndWalls(shed: Pick<DimensionedShed, 'structureType'>): boolean {
  return shed.structureType !== 'gable_carport' && shed.structureType !== 'skillion_carport';
}

/** The roof's own measurements, derived once so every trim piece agrees. */
export interface RoofGeometry {
  /** Height of the ridge above the floor, mm. */
  ridgeY: number;
  /** How far the eave falls below wall height, mm. */
  eaveDrop: number;
  /** Centre height of one slope, mm. */
  midY: number;
  /** Length of a slope measured down the slope, mm. */
  slope: number;
  /** Angle of a slope from horizontal, radians. */
  slopeAngle: number;
  /** Centre of the left slope in x, mm. */
  leftX: number;
  /** Centre of the right slope in x, mm. */
  rightX: number;
  /** Full depth of the roof including both eave overhangs, mm. */
  depth: number;
}

export function roofGeometry(shed: DimensionedShed): RoofGeometry {
  const pitch = (shed.roofPitchDeg * Math.PI) / 180;
  const rise = Math.tan(pitch) * (shed.span / 2);
  const eaveDrop = Math.tan(pitch) * EAVE;
  const halfRun = shed.span / 2 + EAVE;
  return {
    ridgeY: shed.height + rise,
    eaveDrop,
    midY: (shed.height - eaveDrop + shed.height + rise) / 2,
    slope: Math.hypot(halfRun, rise + eaveDrop),
    slopeAngle: Math.atan2(rise + eaveDrop, halfRun),
    leftX: (shed.span / 2 - EAVE) / 2,
    rightX: (shed.span / 2 + shed.span + EAVE) / 2,
    depth: shed.length + EAVE * 2,
  };
}

/**
 * The two roof slopes, plus a ridge cap when the roof has a ridge.
 *
 * A skillion is a single plane falling along the length; drawing a ridge cap on it would put a
 * piece of trim where the roof has no joint.
 */
export function roofParts(shed: DimensionedShed, roof: RoofGeometry): StructurePart[] {
  const colours = shed.colors;
  const z = shed.length / 2;

  if (!hasRidge(shed)) {
    // One plane falling across the span: low wall at x = 0, high wall at x = span.
    const rise = skillionRiseMm(shed);
    const angle = (shed.roofPitchDeg * Math.PI) / 180;
    return [
      {
        kind: 'roof-single',
        shape: 'box',
        position: [shed.span / 2, shed.height + rise / 2, z],
        size: [(shed.span + EAVE * 2) / Math.cos(angle), ROOF_SHEET, roof.depth],
        rotation: [0, 0, angle],
        color: colours.roof,
        finish: 'sheet',
      },
    ];
  }

  const parts: StructurePart[] = [
    {
      kind: 'roof-left',
      shape: 'box',
      position: [roof.leftX, roof.midY, z],
      size: [roof.slope, ROOF_SHEET, roof.depth],
      rotation: [0, 0, roof.slopeAngle],
      color: colours.roof,
      finish: 'sheet',
    },
    {
      kind: 'roof-right',
      shape: 'box',
      position: [roof.rightX, roof.midY, z],
      size: [roof.slope, ROOF_SHEET, roof.depth],
      rotation: [0, 0, -roof.slopeAngle],
      color: colours.roof,
      finish: 'sheet',
    },
    ...ridgeCapParts(shed, roof),
  ];

  return parts;
}

/**
 * The ridge cap: two wings meeting over the ridge, each `RIDGE_CAP_WING` wide.
 *
 * ## Why two wings and not one box
 *
 * The cap used to be a single 280 × 80 box lying flat over the apex — a bar, not a capping. A roll-top
 * ridge cap is a V: one leg down each slope, tucked under the sheet edge. Two rotated wings put the
 * cap's own faces on the two roof planes, which is the line a person reads as a ridge.
 *
 * ## Why the wings meet without overlapping
 *
 * Each wing runs from the ridge down its slope, so their inner ends are both at the ridge point and
 * both rotated. They touch along an edge rather than sharing a face, so no two coplanar front faces
 * flicker. The tiny lift by `FLASHING_THICK` keeps the cap above the sheet instead of inside it.
 */
function ridgeCapParts(shed: DimensionedShed, roof: RoofGeometry): StructurePart[] {
  const z = shed.length / 2;
  // Centre of the cap's cross-section plane: on top of the 40 mm sheet, then half its own thickness.
  const lift = ROOF_SHEET / 2 + FLASHING_THICK / 2;
  const half = RIDGE_CAP_WING / 2;
  const angle = roof.slopeAngle;
  const apexX = shed.span / 2;
  const apexY = roof.ridgeY;

  /*
   * One wing down each slope. `side` is −1 for the left slope, +1 for the right:
   *
   *   down = (side·cos a, −sin a)   the direction away from the ridge, along the roof
   *
   * Both wings start at the **same lifted apex point**, so their inner ends meet exactly. Lifting each
   * wing along its own slope normal instead pushed the two inner ends 5 mm apart each, leaving a 10 mm
   * slot at the ridge. A constant vertical lift is what a cap sitting on a sheet actually is.
   */
  const wing = (side: 1 | -1): StructurePart => {
    const dX = side * Math.cos(angle);
    const dY = -Math.sin(angle);
    return {
      kind: 'ridge-cap',
      shape: 'box',
      position: [apexX + half * dX, apexY + lift + half * dY, z],
      size: [RIDGE_CAP_WING, FLASHING_THICK, roof.depth],
      rotation: [0, 0, side === -1 ? angle : -angle],
      color: shed.colors.barge,
      finish: 'trim',
    };
  };

  return [wing(-1), wing(1)];
}

/**
 * A closed gable triangle for one end, or `null` when the end is open.
 *
 * `end` names which end in the shed's own frame: `front` is `z = 0`, `back` is `z = length`. A
 * building without end walls (`gable_carport`) gets `null`: there is no wall for the triangle to sit
 * on, and the roof above it is carried by the frame alone.
 *
 * An end that carries a `gable_infill` **option** also gets nothing here: the option is the
 * customer's own triangle, already drawn by the options layer, and drawing both would put two
 * surfaces in the same place.
 */
export function gableEndParts(
  shed: DimensionedShed,
  roof: RoofGeometry,
  end: 'front' | 'back',
  thickness = 100,
): StructurePart[] {
  if (!hasEndWalls(shed)) return [];
  const alreadyBuilt = shed.options.some(
    (option) => option.kind === 'gable_infill' && option.end === end,
  );
  if (alreadyBuilt) return [];
  const z = end === 'front' ? thickness / 2 : shed.length - thickness / 2;
  if (!hasRidge(shed)) {
    // A skillion's end is a right-angled wedge above the low wall, rising to the high side.
    const wedge = skillionRiseMm(shed);
    return [
      {
        kind: `gable-end-${end}`,
        shape: 'box',
        position: [shed.span / 2, shed.height + wedge / 2, z],
        size: [shed.span, wedge, thickness],
        triangle: { base: shed.span, rise: wedge, rightAngle: true },
        color: shed.colors.wall,
        finish: 'sheet',
      },
    ];
  }
  const rise = roof.ridgeY - shed.height;
  return [
    {
      kind: `gable-end-${end}`,
      shape: 'box',
      position: [shed.span / 2, shed.height + rise / 2, z],
      // The bounds of the triangle; `triangle` is what a renderer builds the prism from.
      size: [shed.span, rise, thickness],
      triangle: { base: shed.span, rise },
      color: shed.colors.wall,
      finish: 'sheet',
    },
  ];
}

/** How far in from each end of a gutter its downpipe drops, mm. */
export const DOWNPIPE_INSET = 500;

/* ------------------------------------------------------------------ cladding trim */

/**
 * True when a wall carries sheeting at all.
 *
 * A carport is a roof on columns, so it has no cladding on any side; and a wall left open by the
 * building's own switches has none either. Both matter for trim: a base or a corner flashing on a
 * wall that is not there is a piece of steel floating in mid-air.
 *
 * The front/back ↔ end and left/right ↔ side pairing is the one `internalPressure.ts` and
 * `elevation.ts` both use. It is restated here rather than imported because `domain` may not import
 * `lib` (A9), and duplicating four lines is cheaper than moving a wall-state helper into the wrong
 * layer.
 */
export function wallHasCladding(shed: DimensionedShed, wall: WallSide): boolean {
  if (shed.structureType === 'gable_carport' || shed.structureType === 'skillion_carport') return false;
  switch (wall) {
    case 'front':
      return !shed.endOpening.left;
    case 'back':
      return !shed.endOpening.right;
    case 'left':
      return !shed.sideOpening.front;
    case 'right':
    default:
      return !shed.sideOpening.back;
  }
}

/** Where a wall sits in the shed's own frame: its outside plane and which way is "out". */
interface WallPlane {
  /** True when the wall runs along `z` (left/right), false when it runs along `x` (front/back). */
  runsAlongZ: boolean;
  /** The outside plane's coordinate on the axis the wall faces. */
  plane: number;
  /** −1 when outside is towards the origin, +1 when outside is away from it. */
  outward: 1 | -1;
  /** The wall's length, mm. */
  length: number;
}

function wallPlane(shed: DimensionedShed, wall: WallSide): WallPlane {
  switch (wall) {
    case 'left':
      return { runsAlongZ: true, plane: 0, outward: -1, length: shed.length };
    case 'right':
      return { runsAlongZ: true, plane: shed.span, outward: 1, length: shed.length };
    case 'back':
      return { runsAlongZ: false, plane: shed.length, outward: 1, length: shed.span };
    case 'front':
    default:
      return { runsAlongZ: false, plane: 0, outward: -1, length: shed.span };
  }
}

/**
 * The base trim: one run along the foot of each sheeted wall, stopped at every door that reaches the
 * floor.
 *
 * ## Why the gaps
 *
 * A base flashing runs *behind* a door's opening, not across it. Drawn continuous, the strip crosses
 * the roller door and the PA door as a painted line 75 mm off the ground — which is what a reader would
 * call a mistake rather than a detail. Every hole whose sill is at the floor cuts the run, and the
 * segments between them are separate parts, so a renderer never draws a bar over a hole.
 *
 * ## Why it stands 3 mm proud
 *
 * It has to be visible against the sheeting, and it must not be coplanar with it: the wall's outer
 * face is `z = 0`, so a flashing lying *in* that plane flickers. 3 mm out is a lap, not a gap, and is
 * the same order as a real flashing's material thickness.
 *
 * ## Not in the bill
 *
 * The desktop's flashing list has no base profile and this build's BOM emits none. This is a drawing
 * of the bottom detail only — see `KNOWN-DEVIATIONS.md`.
 */
export function baseTrimParts(shed: DimensionedShed): StructurePart[] {
  const parts: StructurePart[] = [];
  const walls: WallSide[] = ['front', 'back', 'left', 'right'];

  for (const wall of walls) {
    if (!wallHasCladding(shed, wall)) continue;
    const { runsAlongZ, plane, outward, length } = wallPlane(shed, wall);

    /*
     * The holes that reach the floor, in wall-local `u`, sorted and merged. A door's reveal usually
     * starts and ends at its own edge, but a hole clamped into the wall face can start at 0.
     */
    const gaps = wallHolesFor(shed, wall)
      .filter((hole) => hole.sill <= 1)
      .map((hole): [number, number] => [hole.u, hole.u + hole.width])
      .sort((a, b) => a[0] - b[0]);

    interface Run {
      from: number;
      to: number;
    }
    const runs: Run[] = [];
    let cursor = 0;
    for (const [from, to] of gaps) {
      if (from > cursor) runs.push({ from: cursor, to: from });
      cursor = Math.max(cursor, to);
    }
    if (cursor < length) runs.push({ from: cursor, to: length });

    for (const run of runs) {
      const span = run.to - run.from;
      if (span <= 1) continue;
      const centre = (run.from + run.to) / 2;
      /*
       * The strip runs from `BASE_TRIM_LAP` inside the sheeting to `BASE_TRIM_PROUD` outside it, so
       * its centre sits at the midpoint of those two — a hair outside the wall line.
       */
      const reach = (outward * (BASE_TRIM_PROUD - BASE_TRIM_LAP)) / 2;
      const [alongX, alongZ] = runsAlongZ ? [plane + reach, centre] : [centre, plane + reach];
      parts.push({
        kind: `base-trim-${wall}`,
        shape: 'box',
        position: [alongX, BASE_TRIM_HEIGHT / 2, alongZ],
        size: runsAlongZ
          ? [BASE_TRIM_THICK, BASE_TRIM_HEIGHT, span]
          : [span, BASE_TRIM_HEIGHT, BASE_TRIM_THICK],
        color: shed.colors.barge,
        finish: 'trim',
      });
    }
  }

  return parts;
}

/**
 * The corner trim: an L-section post hugging the outside of every corner where two sheeted walls meet.
 *
 * ## Where the corners are
 *
 * A building whose four walls are all sheeted has four. A carport has none — there is no wall to trim
 * — and an open-sided shed has one fewer, because a corner with no wall on one side is a corner with
 * nothing to join. That is the client's rule read literally: "góc có một phía là tường mở thì không có".
 *
 * ## Why two legs of 60 mm and not a square tube
 *
 * A corner flashing is two legs at right angles covering the joint where two sheets meet. Two thin
 * boxes, each one lap proud of its own wall, read as that. A square column would read as a post.
 */
export function cornerTrimParts(shed: DimensionedShed): StructurePart[] {
  const parts: StructurePart[] = [];
  const corners: { wallA: WallSide; wallB: WallSide; x: 0 | 1; z: 0 | 1 }[] = [
    { wallA: 'left', wallB: 'front', x: 0, z: 0 },
    { wallA: 'right', wallB: 'front', x: 1, z: 0 },
    { wallA: 'left', wallB: 'back', x: 0, z: 1 },
    { wallA: 'right', wallB: 'back', x: 1, z: 1 },
  ];

  // Each wall's height, so a corner stops at the eave on both sides it touches.
  const heightOf = (wall: WallSide): number =>
    wall === 'right' ? shed.height + skillionRiseMm(shed) : shed.height;

  /** A hair outside the wall line, so the leg laps the sheeting instead of sitting on it. */
  const lap = (CORNER_TRIM_PROUD - BASE_TRIM_LAP) / 2;
  const half = CORNER_TRIM_FACE / 2;

  for (const corner of corners) {
    if (!wallHasCladding(shed, corner.wallA) || !wallHasCladding(shed, corner.wallB)) continue;
    const xEdge = corner.x === 0 ? 0 : shed.span;
    const zEdge = corner.z === 0 ? 0 : shed.length;
    const outX = corner.x === 0 ? -1 : 1;
    const outZ = corner.z === 0 ? -1 : 1;
    // Inward along each axis: the leg's face width grows away from the corner.
    const inX = -outX;
    const inZ = -outZ;
    const height = Math.min(heightOf(corner.wallA), heightOf(corner.wallB));
    const tag = `${corner.x === 0 ? 'left' : 'right'}-${corner.z === 0 ? 'front' : 'back'}`;

    /*
     * Leg A hugs the left/right wall: it is thin in `x` and `CORNER_TRIM_FACE` wide along `z`.
     * Leg B hugs the front/back wall: thin in `z`, wide along `x`. They cross at the fold, which is
     * what two legs of one corner flashing do — and neither pair of faces is coplanar.
     */
    parts.push(
      {
        kind: `corner-trim-${tag}-x`,
        shape: 'box',
        position: [xEdge + outX * lap, height / 2, zEdge + inZ * half],
        size: [CORNER_TRIM_THICK, height, CORNER_TRIM_FACE],
        color: shed.colors.barge,
        finish: 'trim',
      },
      {
        kind: `corner-trim-${tag}-z`,
        shape: 'box',
        position: [xEdge + inX * half, height / 2, zEdge + outZ * lap],
        size: [CORNER_TRIM_FACE, height, CORNER_TRIM_THICK],
        color: shed.colors.barge,
        finish: 'trim',
      },
    );
  }

  return parts;
}

/**
 * Where each downpipe drops: the long wall it stands on (`left` is x = 0, `right` is x = span) and
 * its distance along the length. One at each end of each gutter, and a skillion has one gutter, on
 * its low side. The 3D model and the drawing sheets both read this, so they cannot disagree.
 */
export function downpipeStations(shed: DimensionedShed): { wall: 'left' | 'right'; y: number }[] {
  const walls: ('left' | 'right')[] = hasRidge(shed) ? ['left', 'right'] : ['left'];
  return walls.flatMap((wall) => [DOWNPIPE_INSET, shed.length - DOWNPIPE_INSET].map((y) => ({ wall, y })));
}

/**
 * Gutter along each eave, with a downpipe at each end of each side.
 *
 * Always present: `gutter.ts` emits both for every building, including carports (a carport's quote
 * carries a gutter even though the sheeting note says it should not — see `KNOWN-DEVIATIONS.md`).
 */
export function gutterParts(shed: DimensionedShed, roof: RoofGeometry): StructurePart[] {
  const parts: StructurePart[] = [];
  const y = shed.height - roof.eaveDrop - 20;
  const run = shed.length + EAVE * 2;

  /*
   * Where a downpipe stands.
   *
   * Its x used to be the **gutter's** x (−230 on the left), which left the pipe hanging 182 mm clear of
   * the wall with nothing joining the two. A downpipe is fixed to the wall, so it now stands one radius
   * plus 10 mm off the wall face — or off the **column** for a carport, which has no wall to fix to
   * (its outer face is `WALL_DEPTH` in from the wall line).
   */
  const openStructure = shed.structureType === 'gable_carport' || shed.structureType === 'skillion_carport';
  const faceLeft = openStructure ? WALL_DEPTH : 0;
  const faceRight = openStructure ? shed.span - WALL_DEPTH : shed.span;
  const standOff = DOWNPIPE_RADIUS + 10;

  // A skillion sheds water to its low side only, so it has one gutter.
  const gutterXs = hasRidge(shed) ? [-EAVE + 70, shed.span + EAVE - 70] : [-EAVE + 70];
  for (const x of gutterXs) {
    parts.push({
      kind: `gutter-${x < 0 ? 'left' : 'right'}`,
      shape: 'cylinder',
      position: [x, y, shed.length / 2],
      radius: GUTTER_RADIUS,
      height: run,
      rotation: [Math.PI / 2, 0, 0],
      color: shed.colors.gutter,
      finish: 'metal',
    });

    const side = x < 0 ? 'left' : 'right';
    const pipeX = x < 0 ? faceLeft - standOff : faceRight + standOff;
    /*
     * The body stops 200 mm under the gutter so the offset piece has room, and its foot is at y = 0:
     * the wall base, where a shoe turns the water out. Ending at the ground plane (−50) would float a
     * pipe 50 mm below the slab on a building with `in_slab`.
     */
    const top = shed.height - roof.eaveDrop - 200;
    const bottom = 0;
    const bodyHeight = Math.max(100, top - bottom);

    for (const z of downpipeStations(shed)
      .filter((s) => s.wall === side)
      .map((s) => s.y)) {
      parts.push({
        kind: `downpipe-${side}-${z}`,
        shape: 'cylinder',
        position: [pipeX, bottom + bodyHeight / 2, z],
        radius: DOWNPIPE_RADIUS,
        height: bodyHeight,
        color: shed.colors.downpipe,
        finish: 'metal',
      });
      /*
       * The offset: a short horizontal run from under the gutter to the top of the pipe. Without it the
       * pipe's mouth is in mid-air; this is the piece that makes the two read as one assembly.
       */
      const offsetX = (x + pipeX) / 2;
      parts.push({
        kind: `downpipe-offset-${side}-${z}`,
        shape: 'cylinder',
        position: [offsetX, top + 40, z],
        radius: DOWNPIPE_RADIUS * 0.9,
        height: Math.max(60, Math.abs(x - pipeX) + DOWNPIPE_RADIUS),
        rotation: [0, 0, Math.PI / 2],
        color: shed.colors.downpipe,
        finish: 'metal',
      });
      /* The shoe: 150 mm angling outwards, so the water leaves the wall instead of running down it. */
      parts.push({
        kind: `downpipe-shoe-${side}-${z}`,
        shape: 'cylinder',
        position: [pipeX + (x < 0 ? -35 : 35), 55, z],
        radius: DOWNPIPE_RADIUS,
        height: 150,
        rotation: [0, 0, x < 0 ? Math.PI / 4 : -Math.PI / 4],
        color: shed.colors.downpipe,
        finish: 'metal',
      });
    }
  }

  return parts;
}

/**
 * The barge flashing: a raking cover along each roof edge at a gable end, plus the skillion's high eave.
 *
 * ## The count is the bill's, not a guess
 *
 * `docs/KNOWN-DEVIATIONS.md` row 58 records what the desktop cuts and how this build orders it:
 * a gable has **four** raking pieces (`TopHatQuote.cs:1861`), a skillion **two** raking ends plus one
 * run along its high eave (`SkillionBuildingQuote.cs:1414`, `SubMaterial.cs:827,844-850`). The drawing
 * matches the bill piece for piece, so an estimator counting pieces on the screen gets the number the
 * quote was priced from.
 *
 * ## Why it is drawn as a narrow strip rather than an L
 *
 * At 20 m a barge reads as a painted line down the raking edge. The strip runs `BARGE_FACE` down the
 * slope, sits on top of the sheet, and stops at the gutter — it does not lap it, so the two never
 * fight for the same pixels.
 */
export function bargeParts(shed: DimensionedShed, roof: RoofGeometry): StructurePart[] {
  const parts: StructurePart[] = [];
  const lift = ROOF_SHEET / 2 + FLASHING_THICK / 2;
  const angle = roof.slopeAngle;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  /*
   * The roof sheet runs out over the end walls by `EAVE`, so the raking edges — and therefore the
   * barge — are at the roof's own ends, not at the wall line.
   */
  const frontZ = -EAVE;
  const backZ = shed.length + EAVE;
  /*
   * Where a barge **stops** on the way down: just clear of the gutter's inner face.
   *
   * The gutter hangs on the eave, its centre 70 mm in from the sheet's outer edge, so its barrel
   * reaches `GUTTER_RADIUS` further out. A flashing drawn all the way to the sheet's edge ran straight
   * through that barrel (measured: the low end at x = −304, y = 2 968, inside a barrel spanning
   * x −315…−145, y 2 842…3 012). It now stops 5 mm short of the barrel's tangent, so the two read as
   * meeting without one drawing over the other.
   */
  const gutterInner = EAVE - 70 - GUTTER_RADIUS + 5;

  if (hasRidge(shed)) {
    /*
     * Four raking pieces: two slopes at each gable end. Each starts where the **ridge cap** stops
     * (`RIDGE_CAP_WING` down the slope) rather than at the apex: a barge drawn from the apex would lie
     * in exactly the cap's own plane, and two coplanar faces flicker.
     */
    const apexX = shed.span / 2;
    const t0 = RIDGE_CAP_WING;
    const t1 = (apexX + gutterInner) / cos;
    const length = t1 - t0;
    const tMid = (t0 + t1) / 2;
    for (const side of [-1, 1] as const) {
      for (const [z, end] of [
        [frontZ, 'front'],
        [backZ, 'back'],
      ] as const) {
        parts.push({
          kind: `barge-${side === -1 ? 'left' : 'right'}-${end}`,
          shape: 'box',
          position: [apexX + side * tMid * cos, roof.ridgeY - tMid * sin + lift, z],
          size: [length, FLASHING_THICK, BARGE_FACE],
          rotation: [0, 0, side === -1 ? angle : -angle],
          color: shed.colors.barge,
          finish: 'trim',
        });
      }
    }
    return parts;
  }

  /*
   * A skillion: two raking ends plus one run along the high eave (`KNOWN-DEVIATIONS` row 58 —
   * `SkillionBuildingQuote.cs:1414` and `SubMaterial.cs:844-850`).
   *
   * Its single plane passes through wall height at x = 0 and rises with the pitch, so a point's height
   * is `height + x·tan(pitch)` — the same plane `roof-single` is drawn on.
   */
  const tan = Math.tan(angle);
  const planeY = (x: number): number => shed.height + x * tan;
  const lowX = -gutterInner;
  const highX = shed.span + EAVE;
  // The raking pieces stop one face width short of the high edge, where the high-eave run takes over.
  const highStripX = highX - BARGE_FACE * cos;
  const dx = highStripX - lowX;
  const length = dx / cos;
  const midX = (lowX + highStripX) / 2;
  for (const [z, end] of [
    [frontZ, 'front'],
    [backZ, 'back'],
  ] as const) {
    parts.push({
      kind: `barge-raking-${end}`,
      shape: 'box',
      position: [midX, planeY(midX) + lift, z],
      size: [length, FLASHING_THICK, BARGE_FACE],
      rotation: [0, 0, angle],
      color: shed.colors.barge,
      finish: 'trim',
    });
  }
  /*
   * The high eave's run lies **on the same plane**, rotated with it, so it reads as a continuation of
   * the raking pieces rather than a horizontal apron floating over a sloping sheet.
   */
  const capX = highX - (BARGE_FACE / 2) * cos;
  parts.push({
    kind: 'barge-high-eave',
    shape: 'box',
    position: [capX, planeY(capX) + lift, shed.length / 2],
    size: [BARGE_FACE, FLASHING_THICK, roof.depth],
    rotation: [0, 0, angle],
    color: shed.colors.barge,
    finish: 'trim',
  });

  return parts;
}

/**
 * Where the purlins and girts sit, as the price book chose them.
 *
 * The **counts and spacings** are the book's own: `optimise.ts` picks a span row from the wind
 * region, the bay standard and the sheet's structural span, then `purlinRows`/`girtRows` turn that
 * into a row count. None of it is visible to the client until an evaluation has run, which is why
 * this arrives as data rather than being computed here.
 *
 * The distribution between the end clearances is the same even spacing the row arithmetic implies
 * (`rowsFor` divides the span minus two end spans by the internal span). It is a drawing rule, not a
 * second pricing rule: nothing below changes a quantity.
 */
export interface FrameRowLayout {
  /** Roof purlin rows per slope (a gable has two slopes, a skillion one). */
  purlinRows: number;
  /** Spacing the book allows for a purlin, mm. */
  purlinSpanMm: number;
  /** Wall girt rows per wall face. */
  girtRows: number;
  /** Spacing the book allows for a girt, mm. */
  girtSpanMm: number;
}

/** Evenly spaced positions from `start` to `end`, `count` of them. */
function evenPositions(count: number, start: number, end: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(start + end) / 2];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_unused, index) => start + index * step);
}

/** Clamp `value` into `[min, max]`; a reversed range collapses to `min`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Columns and rafters: the portal frame, at every bay grid line.
 *
 * Always present in the BOM (`frame.ts` counts `(bays − 1) × 2` side columns plus the end pairs),
 * so it is always drawn. It is also what makes the "no roof" view readable.
 */
export function frameParts(shed: DimensionedShed, roof: RoofGeometry): StructurePart[] {
  const parts: StructurePart[] = [];
  const bayPositions = positionsFromWidths(bayWidthsFor(shed));
  /*
   * Columns stand **inside** the cladding, never on its plane.
   *
   * `WALL_DEPTH + FRAME_SECTION / 2` puts the column's outer face at x = 50, one cladding thickness
   * behind the sheet. A column centred on `FRAME_SECTION / 2` (75 mm) would have its face at x = 0 —
   * exactly coplanar with the sheeting's outer face, which z-fights and flickers. Same for the base
   * plate, which is wider than the column and would otherwise poke through the wall.
   */
  const columnX = [WALL_DEPTH + FRAME_SECTION / 2, shed.span - WALL_DEPTH - FRAME_SECTION / 2];
  /*
   * The same inset along the length, for the end-wall columns.
   *
   * `bayWidthsFor` returns grid lines from 0 to `length`, and a column sitting *on* 0 stands half
   * outside the end cladding. Clamping into `[WALL_DEPTH + half, length − WALL_DEPTH − half]` puts the
   * corner column where the factory puts it: hard against the inside of the end wall.
   */
  const inset = WALL_DEPTH + FRAME_SECTION / 2;
  const plateHalf = FRAME_SECTION * 0.8;
  // The right-hand column of a skillion stands to the high side of the roof.
  const colHeight = (x: number) => (x > shed.span / 2 ? shed.height + skillionRiseMm(shed) : shed.height);

  for (const bayZ of bayPositions) {
    const z = clamp(bayZ, inset, shed.length - inset);
    for (const x of columnX) {
      parts.push({
        kind: 'column',
        shape: 'box',
        position: [x, colHeight(x) / 2, z],
        size: [FRAME_SECTION, colHeight(x), FRAME_SECTION],
        color: '#8d9499',
        finish: 'metal',
      });
      /*
       * Base plate. Narrower than twice the section (`1.6 ×`) and clamped, so its outer edge stays
       * behind the sheeting: a 300 mm plate under a 150 mm column poked 75 mm out through the wall,
       * which read as a bracket floating on the cladding.
       */
      const plateX = clamp(x, plateHalf + WALL_DEPTH / 2, shed.span - plateHalf - WALL_DEPTH / 2);
      parts.push({
        kind: 'base-plate',
        shape: 'box',
        position: [plateX, 12, z],
        size: [plateHalf * 2, 24, plateHalf * 2],
        color: '#8d9499',
        finish: 'metal',
      });
    }
    /*
     * The portal rafter spans **wall to ridge**, not eave to eaves.
     *
     * It used to be drawn with `roof.slope` and centred on `roof.leftX`, both of which belong to the
     * *roof sheet* — and the sheet runs out over the eave (`EAVE`, 300 mm each side). The result was a
     * rafter end 315 mm outside the wall face: the grey tab a visitor sees under the gutter, and, once
     * the roof was hidden, the most obviously wrong piece of steel in the model (measured 2026-11-24).
     *
     * So each half is drawn from the outside face of its column at wall height to the ridge:
     * the same two points the roof planes meet at, with no overhang. The roof sheet keeps its own
     * eave, which is what `roofParts` draws.
     */
    if (hasRidge(shed)) {
      const apexX = shed.span / 2;
      const apexY = roof.ridgeY;
      const leftDx = apexX - WALL_DEPTH;
      const rise = apexY - shed.height;
      const half = Math.hypot(leftDx, rise);
      const angle = Math.atan2(rise, leftDx);
      parts.push(
        {
          kind: 'rafter-left',
          shape: 'box',
          position: [(WALL_DEPTH + apexX) / 2, (shed.height + apexY) / 2 - 90, z],
          size: [half, 180, 90],
          rotation: [0, 0, angle],
          color: '#8d9499',
          finish: 'metal',
        },
        {
          kind: 'rafter-right',
          shape: 'box',
          position: [(shed.span - WALL_DEPTH + apexX) / 2, (shed.height + apexY) / 2 - 90, z],
          size: [half, 180, 90],
          rotation: [0, 0, -angle],
          color: '#8d9499',
          finish: 'metal',
        },
      );
    } else {
      /*
       * A skillion has one rafter from the low wall to the high wall, again between the cladding
       * faces. Its height follows the slope, so both ends land on the roof line rather than on the
       * wall line.
       */
      const riseTotal = skillionRiseMm(shed);
      const lowY = shed.height + (riseTotal * WALL_DEPTH) / shed.span;
      const highY = shed.height + (riseTotal * (shed.span - WALL_DEPTH)) / shed.span;
      const run = shed.span - WALL_DEPTH * 2;
      parts.push({
        kind: 'rafter-single',
        shape: 'box',
        position: [shed.span / 2, (lowY + highY) / 2 - 90, z],
        size: [Math.hypot(run, highY - lowY), 180, 90],
        rotation: [0, 0, Math.atan2(highY - lowY, run)],
        color: '#8d9499',
        finish: 'metal',
      });
    }
  }

  return parts;
}

/**
 * Roof purlins and wall girts, from the rows the price book chose.
 *
 * `layout` is `null` before the first evaluation: purlin spacing comes from the book's span table,
 * which the client does not have, so there is nothing honest to draw yet. Columns and rafters are
 * unaffected — they are at the bay lines either way.
 */
export function purlinAndGirtParts(
  shed: DimensionedShed,
  layout: FrameRowLayout | null,
): StructurePart[] {
  if (layout === null) return [];
  const parts: StructurePart[] = [];
  const roof = roofGeometry(shed);
  const run = shed.length + EAVE * 2;

  /*
   * A purlin runs **along the length**, parallel to the ridge, and is carried by the rafters at
   * each bay — so there is one continuous member per row position, not one per bay. Its height
   * follows the pitch: a row part-way up a slope rises with it, or the purlins would draw a flat
   * ceiling under a pitched roof.
   */
  if (layout.purlinRows > 0) {
    const eaveY = shed.height - roof.eaveDrop;
    /*
     * Purlins sit **under** the roof sheet, not in its plane. The roof is a 40 mm slab whose underside
     * is the reference; a purlin centred exactly on it would be half-buried and its top face coplanar
     * with the sheet, which flickers. `ROOF_SHEET` is subtracted so the member hangs below.
     */
    const belowRoof = ROOF_SHEET / 2 + PURLIN_SECTION / 2;
    if (hasRidge(shed)) {
      // Each slope carries its rows from the eave to the ridge, and the ridge row is shared.
      const across = evenPositions(layout.purlinRows, WALL_DEPTH, shed.span / 2);
      for (const [index, dx] of across.entries()) {
        const t = (dx - WALL_DEPTH) / (shed.span / 2 - WALL_DEPTH);
        const y = eaveY + ((roof.ridgeY - eaveY) * Math.max(0, t));
        for (const x of index === across.length - 1 ? [shed.span / 2] : [dx, shed.span - dx]) {
          parts.push({
            kind: 'purlin',
            shape: 'box',
            position: [x, y - belowRoof, shed.length / 2],
            size: [PURLIN_SECTION, PURLIN_SECTION, run],
            color: '#a3aaae',
            finish: 'metal',
          });
        }
      }
    } else {
      // A skillion falls along the length, so its rows step down `z` at one x each… except a
      // purlin still runs along z, so its rows step in *x*. Sitting them at the wall height is the
      // honest approximation: the slope is under 15° and the row positions are the book's count.
      for (const x of evenPositions(
        layout.purlinRows,
        WALL_DEPTH + PURLIN_SECTION / 2,
        shed.span - WALL_DEPTH - PURLIN_SECTION / 2,
      )) {
        // Rows follow the roof plane up from the low wall to the high wall.
        const y = shed.height + skillionRiseMm(shed) * (x / shed.span);
        parts.push({
          kind: 'purlin',
          shape: 'box',
          position: [x, y - belowRoof, shed.length / 2],
          size: [PURLIN_SECTION, PURLIN_SECTION, run],
          color: '#a3aaae',
          finish: 'metal',
        });
      }
    }
  }

  /*
   * Girts run horizontally: along each long wall and across each end wall, at the same heights on
   * all four faces. Like the columns they stand **behind** the cladding, never on its plane.
   */
  for (const y of evenPositions(layout.girtRows, PURLIN_SECTION, shed.height - PURLIN_SECTION)) {
    for (const x of [WALL_DEPTH + PURLIN_SECTION / 2, shed.span - WALL_DEPTH - PURLIN_SECTION / 2]) {
      // The high wall of a skillion is taller, so its rows are spread over the extra height.
      const girtY = x > shed.span / 2 ? y * ((shed.height + skillionRiseMm(shed)) / shed.height) : y;
      parts.push({
        kind: 'girt-side',
        shape: 'box',
        // Runs between the end walls, so its ends are not coplanar with their outside faces.
        position: [x, girtY, shed.length / 2],
        size: [PURLIN_SECTION, PURLIN_SECTION, shed.length - WALL_DEPTH * 2],
        color: '#a3aaae',
        finish: 'metal',
      });
    }
    if (hasEndWalls(shed)) {
      // The end wall's cladding occupies z ∈ [0, WALL_DEPTH] and [length − WALL_DEPTH, length].
      for (const z of [WALL_DEPTH + PURLIN_SECTION / 2, shed.length - WALL_DEPTH - PURLIN_SECTION / 2]) {
        parts.push({
          kind: 'girt-end',
          shape: 'box',
          position: [shed.span / 2, y, z],
          size: [shed.span - WALL_DEPTH * 2, PURLIN_SECTION, PURLIN_SECTION],
          color: '#a3aaae',
          finish: 'metal',
        });
      }
    }
  }

  return parts;
}

/**
 * The whole shell in one call: roof, trim, gutters, gable ends and frame.
 *
 * `showRoof` is the one visibility switch the editor offers. When it is off the slopes and their
 * trim are omitted, and everything underneath — frame, openings, interior — is what remains.
 *
 * The **cladding trim** (base, corners) is wall trim, not roof trim: it stays when the roof is lifted
 * off, the same way the gable ends do. `bargeParts` is roof-edge trim and goes with the roof.
 */
export function structureParts(
  shed: DimensionedShed,
  options: { showRoof: boolean; frameRows: FrameRowLayout | null },
): StructurePart[] {
  const roof = roofGeometry(shed);
  const parts: StructurePart[] = [
    ...frameParts(shed, roof),
    ...purlinAndGirtParts(shed, options.frameRows),
    // Gable ends are walls, not roof: they stay when the roof is hidden, the way a real building
    // reads from underneath.
    ...gableEndParts(shed, roof, 'front'),
    ...gableEndParts(shed, roof, 'back'),
    ...baseTrimParts(shed),
    ...cornerTrimParts(shed),
  ];

  if (options.showRoof) {
    parts.push(...roofParts(shed, roof), ...bargeParts(shed, roof), ...gutterParts(shed, roof));
  }

  return parts;
}
