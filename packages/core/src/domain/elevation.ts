/**
 * The four elevations, as the desktop prints them (`ElevationDocument.cs` `PrintPlanNewDesign`).
 *
 * ## Which wall is which
 *
 * The desktop calls the **long** walls Front and Back and the **end** walls Left and Right. v2's editor
 * names walls by plan edge instead (`placement.ts` `wallLength`: `front`/`back` are the ends at
 * `y = 0`/`y = length`, `left`/`right` the long walls at `x = 0`/`x = span`). A sheet labelled the v2
 * way would put "Front" on an end wall, which is not what a customer who has seen a desktop drawing
 * reads. So each view carries the desktop's name, and the editor wall it shows:
 *
 * | Desktop view | v2 wall | Why |
 * |---|---|---|
 * | Front | `left` (x = 0) | the long low wall; a skillion's low side (`skillionRiseMm`) |
 * | Right | `front` (y = 0) | the end the open-end flag `endOpening.left` opens (`bom/infill.ts`) |
 * | Back | `right` (x = span) | the long high wall |
 * | Left | `back` (y = length) | the other end |
 *
 * ## Coordinates
 *
 * Each view is the wall seen from outside, as an orthographic projection with no mirroring: `x` runs
 * from the wall's left corner as the viewer sees it, `z` is height above the floor. That is the same
 * `u` that `walls.ts` gives every opening, so a hole's `u` is its `x` here.
 *
 * Pure geometry, in millimetres. Prices and labels for money live elsewhere (A13).
 */

import type { DimensionedShed, OpeningType, OptionKind, ShedOption, WallSide } from './types';
import { fallsToBothSides } from './types';
import { buildWallGeometries } from './walls';
import { resolveOptions, type ResolvedOption } from './options';
import { skillionRiseMm } from './roof';
import { downpipeStations } from './structure3d';

/** Cover width of one wall sheet, mm (`BuildingPlan.cs:45` `WallSheetingSize`). */
export const WALL_SHEET_MM = 762;
/** Cover width of one roof sheet, mm (`BuildingPlan.cs:50` `RoofSheetingSize`). */
export const ROOF_SHEET_MM = 762;
/** How deep the gutter box reads on an elevation, mm. */
export const GUTTER_MM = 150;
/** Width a downpipe reads at, mm. */
export const DOWNPIPE_MM = 100;

/** The desktop's names for the four views. */
export type ElevationFace = 'front' | 'right' | 'back' | 'left';

/** The desktop's grid order (top-left, top-right, bottom-left, bottom-right) and each view's v2 wall. */
export const ELEVATION_ORDER: readonly { face: ElevationFace; wall: WallSide }[] = [
  { face: 'front', wall: 'left' },
  { face: 'right', wall: 'front' },
  { face: 'back', wall: 'right' },
  { face: 'left', wall: 'back' },
];

/** The desktop view that shows each v2 wall. */
export const FACE_FOR_WALL: Record<WallSide, ElevationFace> = {
  left: 'front',
  front: 'right',
  right: 'back',
  back: 'left',
};

const OPPOSITE: Record<WallSide, WallSide> = { front: 'back', back: 'front', left: 'right', right: 'left' };

export interface ElevationPoint {
  x: number;
  z: number;
}

export interface ElevationLine {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/**
 * A dimension on an elevation.
 *
 * `h`: measures `from..to` along x, its line drawn at height `at`; witness lines rise from `base`.
 * `v`: measures `from..to` up z, its line drawn at `x = at`; witness lines run from `x = base`.
 */
export interface ElevationDim {
  orient: 'h' | 'v';
  from: number;
  to: number;
  at: number;
  base: number;
  label: string;
}

export interface ElevationOpening {
  id: string;
  type: OpeningType;
  x: number;
  sill: number;
  width: number;
  height: number;
}

export interface ElevationOption {
  id: string;
  kind: OptionKind;
  /** Concealed structure seen through the sheeting, drawn as a hidden (dashed) line. */
  dashed: boolean;
  /** Closed outlines. */
  polygons: ElevationPoint[][];
  /** Open lines (awning posts and the like). */
  lines: ElevationLine[];
}

export interface ElevationView {
  face: ElevationFace;
  wall: WallSide;
  /** "Front elevation". */
  title: string;
  /** Which editor wall this is, for a reader who knows the v2 names. */
  editorWall: string;
  /** The wall's own width, mm. */
  width: number;
  /** Drawing extents including projecting options and dimensions, mm. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** The wall face (a rectangle on a long wall, a gable or skillion pentagon on an end). */
  outline: ElevationPoint[];
  /** The roof seen beyond the eave, on a long wall that has one. */
  roofBand: ElevationPoint[] | null;
  /** Gutter boxes at each low eave. */
  gutters: ElevationPoint[][];
  /** Downpipes in view, each a thin box from the gutter to the ground. */
  downpipes: ElevationPoint[][];
  /** Vertical sheet joints, split around openings and cladding. */
  sheeting: ElevationLine[];
  /** Roof sheet joints within the roof band. */
  roofSheeting: ElevationLine[];
  /** Horizontal cladding joints. */
  cladding: ElevationLine[];
  /** The wall is left open (no sheeting). */
  open: boolean;
  openings: ElevationOpening[];
  options: ElevationOption[];
  /** The gable triangle that a gable infill closes, when this end has one. */
  gableInfill: ElevationPoint[] | null;
  dims: ElevationDim[];
}

const TITLE: Record<ElevationFace, string> = {
  front: 'Front elevation',
  right: 'Right elevation',
  back: 'Back elevation',
  left: 'Left elevation',
};

/** Distance below the floor of the opening chain and the overall width, mm. */
const CHAIN_AT = -500;
const OVERALL_AT = -1200;
/** An awning's own width, seen face-on, sits one row below the overall width. */
const AWNING_AT = -1900;
/** Distance outside the wall of a height dimension, mm. */
const HEIGHT_OFFSET = 700;
/** Thickness an awning's sheet reads at, mm. */
const AWNING_SHEET = 100;
/** Thickness an outrigger's beam reads at, mm. */
const BEAM_MM = 150;

function mmLabel(value: number): string {
  return Math.round(value).toLocaleString('en-AU');
}

/** Plan point → the view's x. */
function faceX(shed: DimensionedShed, wall: WallSide, x: number, y: number): number {
  switch (wall) {
    case 'front':
      return x;
    case 'back':
      return shed.span - x;
    case 'left':
      return shed.length - y;
    case 'right':
    default:
      return y;
  }
}

/** A plan rectangle's x range in the view. */
function faceRange(
  shed: DimensionedShed,
  wall: WallSide,
  rect: { x: number; y: number; width: number; height: number },
): [number, number] {
  const a = faceX(shed, wall, rect.x, rect.y);
  const b = faceX(shed, wall, rect.x + rect.width, rect.y + rect.height);
  return [Math.min(a, b), Math.max(a, b)];
}

/** Whether the wall is left open by the building's open-end / open-side flags. */
function wallIsOpen(shed: DimensionedShed, wall: WallSide): boolean {
  switch (wall) {
    case 'front':
      return shed.endOpening.left;
    case 'back':
      return shed.endOpening.right;
    case 'left':
      return shed.sideOpening.front;
    case 'right':
    default:
      return shed.sideOpening.back;
  }
}

/** `[0, top]` less every excluded `[lo, hi]`, as segments. */
function subtract(lo: number, hi: number, cuts: [number, number][]): [number, number][] {
  let pieces: [number, number][] = [[lo, hi]];
  for (const [a, b] of cuts) {
    const next: [number, number][] = [];
    for (const [p, q] of pieces) {
      if (b <= p || a >= q) {
        next.push([p, q]);
        continue;
      }
      if (a > p) next.push([p, a]);
      if (b < q) next.push([b, q]);
    }
    pieces = next;
  }
  return pieces.filter(([p, q]) => q - p > 1);
}

function rectPoints(x0: number, x1: number, z0: number, z1: number): ElevationPoint[] {
  return [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ];
}

/** Build one view. */
function buildView(
  shed: DimensionedShed,
  face: ElevationFace,
  wall: WallSide,
  resolved: ResolvedOption[],
): ElevationView {
  const gable = fallsToBothSides(shed.structureType);
  const rise = skillionRiseMm(shed);
  const tan = Math.tan((shed.roofPitchDeg * Math.PI) / 180);
  const h = shed.height;
  const ridge = gable ? h + (shed.span / 2) * tan : h + rise;
  const isEnd = wall === 'front' || wall === 'back';
  const width = isEnd ? shed.span : shed.length;
  const walls = buildWallGeometries(shed);
  const geometry = walls.find((w) => w.side === wall)!;

  /** Top of the wall face at view x. */
  const top = (x: number): number => {
    if (!isEnd) return wall === 'right' ? h + rise : h;
    if (gable) return h + (shed.span / 2 - Math.abs(x - shed.span / 2)) * tan;
    // Skillion: low at v2 x = 0. On the front end view x = plan x; on the back end it is mirrored.
    const planX = wall === 'front' ? x : shed.span - x;
    return h + planX * tan;
  };

  // --- Wall face -------------------------------------------------------------------------------
  const outline: ElevationPoint[] = isEnd
    ? gable
      ? [
          { x: 0, z: 0 },
          { x: width, z: 0 },
          { x: width, z: h },
          { x: width / 2, z: ridge },
          { x: 0, z: h },
        ]
      : [
          { x: 0, z: 0 },
          { x: width, z: 0 },
          { x: width, z: top(width) },
          { x: 0, z: top(0) },
        ]
    : rectPoints(0, width, 0, top(0));

  // --- Roof beyond the eave, from a long wall ---------------------------------------------------
  let roofBand: ElevationPoint[] | null = null;
  const roofSheeting: ElevationLine[] = [];
  const bandTop = gable ? ridge : wall === 'left' ? h + rise : null;
  if (!isEnd && bandTop !== null && bandTop > h) {
    roofBand = rectPoints(0, width, h, bandTop);
    for (let x = ROOF_SHEET_MM; x < width - 1; x += ROOF_SHEET_MM) {
      roofSheeting.push({ x1: x, z1: h, x2: x, z2: bandTop });
    }
  }

  // --- Gutters at each low eave ----------------------------------------------------------------
  const gutters: ElevationPoint[][] = [];
  if (!isEnd) {
    if (gable || wall === 'left') gutters.push(rectPoints(0, width, h - GUTTER_MM, h));
  } else {
    const lowAtStart = gable || wall === 'front';
    const lowAtEnd = gable || wall === 'back';
    if (lowAtStart) gutters.push(rectPoints(-GUTTER_MM, 0, h - GUTTER_MM, h));
    if (lowAtEnd) gutters.push(rectPoints(width, width + GUTTER_MM, h - GUTTER_MM, h));
  }

  // --- Downpipes (`downpipeStations`, the ones the 3D model draws) -------------------------------
  const downpipes: ElevationPoint[][] = [];
  const pipeTop = h - GUTTER_MM;
  for (const station of downpipeStations(shed)) {
    if (isEnd) {
      // An end sees the pipe at its own end of each gutter, standing just outside the corner.
      const nearEnd = wall === 'front' ? station.y < shed.length / 2 : station.y > shed.length / 2;
      if (!nearEnd) continue;
      const x = faceX(shed, wall, station.wall === 'left' ? -GUTTER_MM / 2 : shed.span + GUTTER_MM / 2, station.y);
      downpipes.push(rectPoints(x - DOWNPIPE_MM / 2, x + DOWNPIPE_MM / 2, 0, pipeTop));
    } else if (station.wall === wall) {
      const x = faceX(shed, wall, 0, station.y);
      downpipes.push(rectPoints(x - DOWNPIPE_MM / 2, x + DOWNPIPE_MM / 2, 0, pipeTop));
    }
  }

  // --- Openings ---------------------------------------------------------------------------------
  const onWall = shed.openings.filter((o) => o.wall === wall);
  const openings: ElevationOpening[] = geometry.holes.map((hole, i) => ({
    id: onWall[i]!.id,
    type: onWall[i]!.type,
    x: hole.u,
    sill: hole.sill,
    width: hole.width,
    height: hole.height,
  }));

  // --- Sheeting and cladding --------------------------------------------------------------------
  const open = wallIsOpen(shed, wall);
  const claddingBands = shed.options
    .filter((o): o is Extract<ShedOption, { kind: 'horizontal_cladding' }> =>
      o.kind === 'horizontal_cladding' && o.wall === wall,
    )
    .map((o): [number, number] => [Math.max(0, Math.min(o.from, o.to)), Math.min(top(0), top(width), Math.max(o.from, o.to))])
    .filter(([a, b]) => b > a);
  const sheeting: ElevationLine[] = [];
  const cladding: ElevationLine[] = [];
  if (!open) {
    for (let x = WALL_SHEET_MM; x < width - 1; x += WALL_SHEET_MM) {
      const cuts: [number, number][] = [
        ...openings.filter((o) => x > o.x && x < o.x + o.width).map((o): [number, number] => [o.sill, o.sill + o.height]),
        ...claddingBands,
      ];
      for (const [z1, z2] of subtract(0, top(x), cuts)) sheeting.push({ x1: x, z1, x2: x, z2 });
    }
    for (const [from, to] of claddingBands) {
      const levels: number[] = [];
      for (let z = from; z < to; z += WALL_SHEET_MM) levels.push(z);
      levels.push(to);
      for (const z of levels) {
        const cuts = openings
          .filter((o) => z > o.sill && z < o.sill + o.height)
          .map((o): [number, number] => [o.x, o.x + o.width]);
        for (const [x1, x2] of subtract(0, width, cuts)) cladding.push({ x1, z1: z, x2, z2: z });
      }
    }
  }

  // --- Options ----------------------------------------------------------------------------------
  const options: ElevationOption[] = [];
  const dims: ElevationDim[] = [];
  const raw = new Map(shed.options.map((o) => [o.id, o] as const));
  for (const option of resolved) {
    const source = raw.get(option.id);
    if (!source) continue;
    const ownWall = 'wall' in source ? (source as { wall: WallSide }).wall : null;
    const hidden = ownWall !== null && OPPOSITE[ownWall] === wall;
    const [x0, x1] = faceRange(shed, wall, option.rect);
    const push = (dashed: boolean, polygons: ElevationPoint[][], lines: ElevationLine[] = []): void => {
      options.push({ id: option.id, kind: option.kind, dashed, polygons, lines });
    };

    switch (option.kind) {
      case 'awning':
      case 'overhang': {
        if (hidden) break;
        const posts = option.kind === 'awning';
        if (ownWall === wall) {
          const z0 = Math.min(option.zLow, option.zHigh) - (option.zLow === option.zHigh ? AWNING_SHEET : 0);
          const lines: ElevationLine[] = posts
            ? [
                { x1: x0, z1: 0, x2: x0, z2: z0 },
                { x1: x1, z1: 0, x2: x1, z2: z0 },
              ]
            : [];
          push(false, [rectPoints(x0, x1, z0, option.zHigh)], lines);
          if (posts) {
            dims.push({ orient: 'h', from: x0, to: x1, at: AWNING_AT, base: 0, label: mmLabel(x1 - x0) });
          }
        } else {
          // Seen side-on: the sheet falls from the wall to its outer edge.
          const inside = (x: number) => x >= -1 && x <= width + 1;
          const wallX = inside(x0) && !inside(x1) ? x0 : inside(x1) && !inside(x0) ? x1 : x0;
          const outerX = wallX === x0 ? x1 : x0;
          push(
            false,
            [
              [
                { x: wallX, z: option.zHigh },
                { x: outerX, z: option.zLow },
                { x: outerX, z: option.zLow - AWNING_SHEET },
                { x: wallX, z: option.zHigh - AWNING_SHEET },
              ],
            ],
            posts ? [{ x1: outerX, z1: 0, x2: outerX, z2: option.zLow - AWNING_SHEET }] : [],
          );
          dims.push({
            orient: 'h',
            from: Math.min(wallX, outerX),
            to: Math.max(wallX, outerX),
            at: CHAIN_AT,
            base: 0,
            label: mmLabel(Math.abs(outerX - wallX)),
          });
          if (posts) {
            const side = outerX > wallX ? 1 : -1;
            dims.push({
              orient: 'v',
              from: 0,
              to: option.zLow,
              at: outerX + side * HEIGHT_OFFSET,
              base: outerX,
              label: mmLabel(option.zLow),
            });
          }
        }
        break;
      }
      case 'stable':
        if (!hidden) push(false, [rectPoints(x0, x1, 0, option.zHigh)]);
        break;
      case 'outrigger':
        if (!hidden) push(false, [rectPoints(x0, x1, option.zHigh - BEAM_MM, option.zHigh)]);
        break;
      case 'cantilever':
        if (!hidden) push(false, [rectPoints(x0, x1, option.zLow, option.zHigh)]);
        break;
      case 'carry_beam':
        if (ownWall === wall) push(true, [rectPoints(x0, x1, option.zLow, option.zHigh)]);
        break;
      case 'mezzanine':
        push(true, [rectPoints(x0, x1, option.zLow, option.zHigh)]);
        break;
      case 'dividing_wall':
        push(true, [rectPoints(x0, x1, 0, Math.min(option.zHigh, ridge))]);
        break;
      case 'skylight': {
        // A roof light reads only from a long wall that sees its slope.
        if (isEnd || !roofBand) break;
        const px0 = option.rect.x;
        const px1 = option.rect.x + option.rect.width;
        const facing = gable ? (wall === 'left' ? px1 <= shed.span / 2 + 1 : px0 >= shed.span / 2 - 1) : wall === 'left';
        if (!facing) break;
        const roofZ = (px: number): number =>
          gable ? h + (shed.span / 2 - Math.abs(px - shed.span / 2)) * tan : h + px * tan;
        const za = roofZ(px0);
        const zb = roofZ(px1);
        push(false, [rectPoints(x0, x1, Math.min(za, zb), Math.max(za, zb))]);
        break;
      }
      default:
        break;
    }
  }

  // --- Gable infill -----------------------------------------------------------------------------
  let gableInfill: ElevationPoint[] | null = null;
  if (isEnd) {
    const has = shed.options.some((o) => o.kind === 'gable_infill' && o.end === wall);
    if (has) {
      gableInfill = gable
        ? [
            { x: 0, z: h },
            { x: width, z: h },
            { x: width / 2, z: ridge },
          ]
        : [
            { x: 0, z: h },
            { x: width, z: h },
            { x: top(0) > top(width) ? 0 : width, z: h + rise },
          ];
    }
  }

  // --- Dimensions -------------------------------------------------------------------------------
  const stops = new Set<number>([0, Math.round(width)]);
  for (const o of openings) {
    stops.add(Math.round(o.x));
    stops.add(Math.round(o.x + o.width));
  }
  const sorted = [...stops].filter((s) => s >= 0 && s <= width).sort((a, b) => a - b);
  if (sorted.length > 2) {
    for (let i = 0; i + 1 < sorted.length; i += 1) {
      const from = sorted[i]!;
      const to = sorted[i + 1]!;
      if (to - from < 1) continue;
      dims.push({ orient: 'h', from, to, at: CHAIN_AT, base: 0, label: mmLabel(to - from) });
    }
  }
  dims.push({
    orient: 'h',
    from: 0,
    to: width,
    at: sorted.length > 2 ? OVERALL_AT : CHAIN_AT,
    base: 0,
    label: mmLabel(width),
  });
  if (isEnd) {
    // The desktop dimensions an end with its wall height, and its ridge or high side. The columns
    // stand clear of anything drawn beside the wall (an awning seen side-on and its own height).
    let leftEdge = -GUTTER_MM;
    let rightEdge = width + GUTTER_MM;
    for (const o of options) {
      for (const poly of o.polygons) {
        for (const p of poly) {
          leftEdge = Math.min(leftEdge, p.x);
          rightEdge = Math.max(rightEdge, p.x);
        }
      }
    }
    for (const d of dims) {
      if (d.orient !== 'v') continue;
      leftEdge = Math.min(leftEdge, d.at);
      rightEdge = Math.max(rightEdge, d.at);
    }
    dims.push({ orient: 'v', from: 0, to: top(0), at: leftEdge - HEIGHT_OFFSET, base: 0, label: mmLabel(top(0)) });
    if (gable) {
      dims.push({ orient: 'v', from: 0, to: h, at: rightEdge + HEIGHT_OFFSET, base: width, label: mmLabel(h) });
      dims.push({
        orient: 'v',
        from: 0,
        to: ridge,
        at: rightEdge + 2 * HEIGHT_OFFSET,
        base: width / 2,
        label: mmLabel(ridge),
      });
    } else {
      dims.push({
        orient: 'v',
        from: 0,
        to: top(width),
        at: rightEdge + HEIGHT_OFFSET,
        base: width,
        label: mmLabel(top(width)),
      });
    }
  }

  // --- Extents ----------------------------------------------------------------------------------
  const xs: number[] = [0, width];
  const zs: number[] = [0, ridge];
  for (const o of options) for (const poly of o.polygons) for (const p of poly) xs.push(p.x), zs.push(p.z);
  for (const g of gutters) for (const p of g) xs.push(p.x);
  for (const d of dims) {
    if (d.orient === 'h') {
      xs.push(d.from, d.to);
      zs.push(d.at);
    } else {
      xs.push(d.at);
      zs.push(d.to);
    }
  }

  return {
    face,
    wall,
    title: TITLE[face],
    editorWall: `editor: ${wall} wall`,
    width,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
    outline,
    roofBand,
    gutters,
    downpipes,
    sheeting,
    roofSheeting,
    cladding,
    open,
    openings,
    options,
    gableInfill,
    dims,
  };
}

/** The four views, in the desktop's grid order: Front, Right, Back, Left. */
export function buildElevations(shed: DimensionedShed): ElevationView[] {
  const resolved = resolveOptions(shed);
  return ELEVATION_ORDER.map(({ face, wall }) => buildView(shed, face, wall, resolved));
}
