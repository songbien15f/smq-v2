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

import type { DimensionedShed } from './types';
import { fallsToBothSides } from './types';
import { skillionRiseMm } from './roof';
import { bayWidthsFor, positionsFromWidths } from './bays';
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
    {
      kind: 'ridge-cap',
      shape: 'box',
      position: [shed.span / 2, roof.ridgeY + 50, z],
      size: [280, 80, roof.depth],
      color: colours.barge,
      finish: 'trim',
    },
  ];

  return parts;
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
    for (const z of downpipeStations(shed).filter((s) => s.wall === side).map((s) => s.y)) {
      parts.push({
        kind: `downpipe-${x < 0 ? 'left' : 'right'}-${z}`,
        shape: 'cylinder',
        position: [x, (shed.height - roof.eaveDrop) / 2 - 40, z],
        radius: DOWNPIPE_RADIUS,
        height: shed.height - roof.eaveDrop - 80,
        color: shed.colors.downpipe,
        finish: 'metal',
      });
    }
  }

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
    if (hasRidge(shed)) {
      parts.push(
        {
          kind: 'rafter-left',
          shape: 'box',
          position: [roof.leftX, roof.midY - 90, z],
          size: [roof.slope, 180, 90],
          rotation: [0, 0, roof.slopeAngle],
          color: '#8d9499',
          finish: 'metal',
        },
        {
          kind: 'rafter-right',
          shape: 'box',
          position: [roof.rightX, roof.midY - 90, z],
          size: [roof.slope, 180, 90],
          rotation: [0, 0, -roof.slopeAngle],
          color: '#8d9499',
          finish: 'metal',
        },
      );
    } else {
      parts.push({
        kind: 'rafter-single',
        shape: 'box',
        position: [shed.span / 2, shed.height + skillionRiseMm(shed) / 2 - 90, z],
        size: [Math.hypot(shed.span, skillionRiseMm(shed)), 180, 90],
        rotation: [0, 0, Math.atan2(skillionRiseMm(shed), shed.span)],
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
  ];

  if (options.showRoof) {
    parts.push(...roofParts(shed, roof), ...gutterParts(shed, roof));
  }

  return parts;
}
