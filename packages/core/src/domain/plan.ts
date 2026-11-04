/**
 * 2D plan geometry.
 *
 * Turns a `ShedConfig` into the plain data structures the 2D plan renderer
 * draws: the shed outline, interior bay grid lines, dimension strings, a roof
 * orientation arrow, and each opening placed in global plan coordinates.
 *
 * Plan convention (all millimetres, origin at the front-left corner):
 *   - `x` runs along the span (0 .. shed.span);
 *   - `y` runs along the length (0 .. shed.length), front edge at `y = 0`.
 *
 * Geometry keeps exact values; only dimension *labels* are rounded, via
 * `roundUpTo50`, and that rounding never feeds back into a coordinate.
 *
 * Pure TypeScript: no React, Next.js, Zustand, Konva, or three.
 */

import type { Opening, OpeningType, OptionKind, ShedConfig, SwingDirection, WallSide } from './types';
import { computeBayPositions, computeBayWidths } from './bays';
import { resolveOptions, type ResolvedOption } from './options';
import { placementToPlanRect, resolveOpeningPlacement } from './placement';
import { roundUpTo50 } from './units';

/**
 * The technical-drawing primitives that draw one opening, in plan millimetres.
 *
 * This is the desktop app's symbol vocabulary (`PADoor2D.cs`, `Window2D.cs`,
 * `RDoor2D.cs`): a swinging door is jamb blocks + a 45° leaf line + a
 * quarter-circle swing arc; a roller door is a curtain rectangle between two
 * side tracks; a window is a rectangle with three inset lines. Every primitive
 * is computed here so `PlanCanvas` only maps data to Konva nodes.
 */
export interface OpeningSymbol {
  /** Straight lines, each as [x1, y1, x2, y2] in plan mm. */
  lines: [number, number, number, number][];
  /** Filled/stroked rectangles in plan mm. */
  rects: {
    x: number;
    y: number;
    width: number;
    height: number;
    filled: boolean;
    /** Presentation role: a roller door's side tracks draw in the track colour. */
    role?: 'track';
  }[];
  /** Quarter-circle leaf swing, when the door has one. */
  arc?: { x: number; y: number; radius: number; rotation: number; sweep: number };
}

/** An opening resolved into the shed's plan space. */
export interface PlacedOpening {
  id: string;
  type: OpeningType;
  wall: WallSide;
  /** Wall-local offset from the wall's left corner, mm. */
  u: number;
  swing: SwingDirection;
  /** Vertical extent of the opening, mm. */
  height: number;
  /** Technical-drawing primitives, in plan millimetres. */
  symbol: OpeningSymbol;
}

/** A dimension string: exact `value`, display-only rounded `label`. */
export interface PlanDimension {
  label: string;
  value: number;
  /** Which axis the dimension measures along. */
  axis: 'x' | 'y';
  /** The dimension line's two ends (the line the arrows sit on). */
  dimStart: { x: number; y: number };
  dimEnd: { x: number; y: number };
  /** Extension line from the measured edge out to `dimStart`. */
  witnessStart: [{ x: number; y: number }, { x: number; y: number }];
  /** Extension line from the measured edge out to `dimEnd`. */
  witnessEnd: [{ x: number; y: number }, { x: number; y: number }];
  /** Where the label is centred. */
  textAt: { x: number; y: number };
}

/**
 * Which family an option's drawing belongs to. The three roles are drawn with
 * distinct strokes so a reader can tell a roof fixture from concealed structure
 * from something projecting outside the building.
 */
export type OptionRole = 'roof' | 'structure' | 'exterior';

/**
 * An option resolved for the plan: its footprint plus the primitives that draw
 * it. `PlanCanvas` maps these to Konva nodes and derives nothing.
 */
export interface PlacedOption {
  id: string;
  kind: OptionKind;
  role: OptionRole;
  /** Structural and roof fixtures are dashed; exterior projections are solid. */
  dashed: boolean;
  rect: { x: number; y: number; width: number; height: number };
  /** Straight lines, each as [x1, y1, x2, y2] in plan mm. */
  lines: [number, number, number, number][];
  /** A closed triangle, for a gable infill. */
  triangle?: { points: { x: number; y: number }[] };
}

/** Everything the 2D plan renderer needs, in millimetres. */
export interface PlanGeometry {
  outline: { x: number; y: number; width: number; height: number };
  bayLines: { x1: number; y1: number; x2: number; y2: number }[];
  dims: PlanDimension[];
  roofArrow: { x1: number; y1: number; x2: number; y2: number };
  openings: (PlacedOpening & { rect: { x: number; y: number; width: number; height: number } })[];
  options: PlacedOption[];
  warnings: string[];
}

/** Distance from the building edge to the dimension line, mm. */
const SPAN_OFFSET = 900;      // span dim, above the building (negative y)
const LENGTH_OFFSET = 1800;   // overall length dim, left of the building (negative x)
const BAY_OFFSET = 900;       // per-bay dims, left of the building, inside the length dim
const WITNESS_GAP = 120;      // gap between the measured edge and where its witness starts

/** The midpoint of a dimension line — where its label sits. */
function midpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Roof types whose fall runs along the length rather than across the span. */
function fallsAlongLength(shed: ShedConfig): boolean {
  return shed.structureType === 'skillion' || shed.structureType === 'skillion_carport';
}

/** Jamb block size, mm — matches the canvas's former `JAMB_TICK`. */
const JAMB = 90;
/** Depth of a window's plan rectangle into the wall, mm. */
const WINDOW_DEPTH = JAMB;
/** Inset of a window's three interior lines from the rectangle edges, mm. */
const WINDOW_INSET = JAMB / 2;
/** Plan depth of a plain hole's rectangle into the wall, mm. */
const OPENING_HOLE_DEPTH = JAMB;
/** Depth of a roller door's curtain and tracks into the building, mm. */
const ROLLER_DEPTH = 2 * JAMB;
/** Inset of a roller door's curtain from each jamb, mm. */
const ROLLER_INSET = JAMB / 2;
/** How far inside the wall a sliding door's track line sits, mm. */
const TRACK_INSET = 60;
/** Width of a roller door's side track, mm. */
const ROLLER_TRACK_WIDTH = JAMB / 2;

/** A rectangle primitive of an opening symbol. */
type SymbolRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  filled: boolean;
  /** Presentation role; roller-door tracks draw in the track colour. */
  role?: 'track';
};

/**
 * The wall's local frame: `axis` is the unit vector along the wall (the
 * direction of the opening's plan rect), `normal` the unit vector pointing into
 * the building. Exactly the orientation `placementToPlanRect` uses, so a symbol
 * built in this frame is never drawn sideways on a side wall.
 */
function wallFrame(wall: WallSide): { axis: { x: number; y: number }; normal: { x: number; y: number } } {
  switch (wall) {
    case 'back':
      // Back wall runs along x; the building interior is at smaller y.
      return { axis: { x: 1, y: 0 }, normal: { x: 0, y: -1 } };
    case 'left':
      // Left wall runs along y; the building interior is at larger x.
      return { axis: { x: 0, y: 1 }, normal: { x: 1, y: 0 } };
    case 'right':
      // Right wall runs along y; the building interior is at smaller x.
      return { axis: { x: 0, y: 1 }, normal: { x: -1, y: 0 } };
    case 'front':
    default:
      // Front wall runs along x; the building interior is at larger y.
      return { axis: { x: 1, y: 0 }, normal: { x: 0, y: 1 } };
  }
}

/** `deg` reduced into `[0, 360)`. */
function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * The technical-drawing primitives for one opening, in plan millimetres.
 *
 * `rect` is the opening's plan footprint (a segment on its wall, so exactly one
 * of `width`/`height` is non-zero). Everything is built in the wall's local
 * frame (`axis` along the wall, `normal` into the building) so the symbol follows
 * the wall rather than being drawn sideways on a left/right wall.
 */
function buildOpeningSymbol(
  opening: Opening,
  rect: { x: number; y: number; width: number; height: number },
): OpeningSymbol {
  const { type, wall, swing } = opening;
  const { axis, normal } = wallFrame(wall);
  const origin = { x: rect.x, y: rect.y };
  const horizontal = wall === 'front' || wall === 'back';
  /** The opening's extent along its wall: its `width` in wall-local terms. */
  const extent = horizontal ? rect.width : rect.height;

  /** A point at wall-local `t` (along the wall) and `n` (into the building). */
  const at = (t: number, n: number): { x: number; y: number } => ({
    x: origin.x + t * axis.x + n * normal.x,
    y: origin.y + t * axis.y + n * normal.y,
  });

  /** The axis-aligned plan rect spanned by wall-local `[t0,t1] x [n0,n1]`. */
  const box = (t0: number, t1: number, n0: number, n1: number, filled: boolean, role?: SymbolRect['role']): SymbolRect => {
    const corners = [at(t0, n0), at(t1, n0), at(t0, n1), at(t1, n1)];
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, filled, ...(role === undefined ? {} : { role }) };
  };

  const lines: [number, number, number, number][] = [];
  const rects: SymbolRect[] = [];
  const line = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    lines.push([a.x, a.y, b.x, b.y]);

  if (type === 'opening') {
    // A plain hole: the wall is cut and nothing is fitted into it. In plan it is
    // a dashed rectangle across the wall thickness, with no leaf, no swing arc
    // and no track — drawing the PA-door fallback here would show a swinging
    // door in plan while the 3D view shows an empty hole.
    return { lines, rects: [box(0, extent, 0, OPENING_HOLE_DEPTH, false)] };
  }

  if (type === 'window') {
    // A rectangle the full opening depth, plus two inset verticals and one inset
    // horizontal (Window2D.cs:75-82).
    rects.push(box(0, extent, 0, WINDOW_DEPTH, false));
    line(at(WINDOW_INSET, 0), at(WINDOW_INSET, WINDOW_DEPTH));
    line(at(extent - WINDOW_INSET, 0), at(extent - WINDOW_INSET, WINDOW_DEPTH));
    line(at(WINDOW_INSET, WINDOW_INSET), at(extent - WINDOW_INSET, WINDOW_INSET));
    return { lines, rects };
  }

  if (type === 'roller_door') {
    // A curtain rectangle spanning the opening, a side track at each end, and an
    // inner stack mark — no swing, so no arc (RDoor2D.cs:169-182).
    rects.push(box(ROLLER_INSET, extent - ROLLER_INSET, 0, ROLLER_DEPTH, true));
    rects.push(box(0, ROLLER_TRACK_WIDTH, 0, ROLLER_DEPTH - JAMB, false, 'track'));
    rects.push(box(extent - ROLLER_TRACK_WIDTH, extent, 0, ROLLER_DEPTH - JAMB, false, 'track'));
    rects.push(box(ROLLER_INSET, extent - ROLLER_INSET, JAMB, ROLLER_DEPTH, false));
    return { lines, rects };
  }

  // pa_door / sliding_door: a jamb block at each end and the opening line. With
  // a swing, a 45° leaf from the near jamb and a quarter arc of radius = the
  // opening width centred on that same (hinge) jamb, so the tip lands on the arc
  // (PADoor2D.cs:82-97; the desktop's GDI+ print arc at PADoor2D.Print.cs:154 is
  // also centred on the near jamb). A sliding door has no swing in reality, but
  // the brief lumps it with `pa_door`, so it gets the same treatment here.
  rects.push(box(-JAMB, 0, 0, JAMB, false));
  rects.push(box(extent, extent + JAMB, 0, JAMB, false));
  line(at(0, 0), at(extent, 0));


  // A sliding door's track: one line just inside the wall, and a second one
  // further in for a double track. Drawn only for a sliding door, because a
  // PA door hangs on hinges and a window has no leaf at all.
  if (type === 'sliding_door' && opening.track !== null && opening.track !== 'none') {
    line(at(0, TRACK_INSET), at(extent, TRACK_INSET));
    if (opening.track === 'double') {
      line(at(0, TRACK_INSET * 2), at(extent, TRACK_INSET * 2));
    }
  }

  if (swing !== null) {
    const side = swing === 'inward' ? 1 : -1;
    const inv = 1 / Math.SQRT2;
    // The leaf, half-open at 45°, hinged on the near jamb and swung to the
    // swing side; its tip sits on the arc below.
    line(at(0, 0), at(extent * inv, side * extent * inv));

    const centre = at(0, 0);
    // A 90° sweep on the swing side, from the closed position along the wall to
    // the fully-open perpendicular. Konva's `Arc` starts at `rotation` and
    // sweeps clockwise (increasing angle, y down), so start at whichever of the
    // two bounding directions reaches the other by +90°.
    const toDeg = (x: number, y: number) => (Math.atan2(y, x) * 180) / Math.PI;
    const closed = toDeg(axis.x, axis.y);
    const open = toDeg(side * normal.x, side * normal.y);
    const delta = normalizeDegrees(open - closed);
    const rotation = Math.abs(delta - 90) < 1e-6 ? closed : open;
    return { lines, rects, arc: { x: centre.x, y: centre.y, radius: extent, rotation, sweep: 90 } };
  }

  return { lines, rects };
}

/**
 * Build the 2D plan geometry for `shed`.
 *
 * `bayLines` are the interior frame lines only (the outline supplies the two
 * end lines), each drawn parallel to the span. `dims` carries the overall span,
 * the overall length, and one entry per bay. `roofArrow` shows the ridge/fall
 * orientation. Any opening that does not fit its wall is still placed (at its
 * resolved offset) and contributes a warning.
 */
export function buildPlanGeometry(shed: ShedConfig): PlanGeometry {
  const { span, length } = shed;
  const bayPositions = computeBayPositions(length, shed.bays);
  const bayWidths = computeBayWidths(length, shed.bays);

  const outline = { x: 0, y: 0, width: span, height: length };

  // Interior grid lines only; the outline already draws x = 0 and x = span ends.
  const bayLines = bayPositions.slice(1, -1).map((y) => ({
    x1: 0,
    y1: y,
    x2: span,
    y2: y,
  }));

  const dims: PlanDimension[] = [];
  {
    // Overall span: measured along x at the front edge, dimension line above it.
    const dimStart = { x: 0, y: -SPAN_OFFSET };
    const dimEnd = { x: span, y: -SPAN_OFFSET };
    dims.push({
      label: String(roundUpTo50(span)),
      value: span,
      axis: 'x',
      dimStart,
      dimEnd,
      witnessStart: [{ x: 0, y: -WITNESS_GAP }, { x: 0, y: -SPAN_OFFSET }],
      witnessEnd: [{ x: span, y: -WITNESS_GAP }, { x: span, y: -SPAN_OFFSET }],
      textAt: midpoint(dimStart, dimEnd),
    });
  }
  {
    // Overall length: measured along y at the left edge, dimension line further left.
    const dimStart = { x: -LENGTH_OFFSET, y: 0 };
    const dimEnd = { x: -LENGTH_OFFSET, y: length };
    dims.push({
      label: String(roundUpTo50(length)),
      value: length,
      axis: 'y',
      dimStart,
      dimEnd,
      witnessStart: [{ x: -WITNESS_GAP, y: 0 }, { x: -LENGTH_OFFSET, y: 0 }],
      witnessEnd: [{ x: -WITNESS_GAP, y: length }, { x: -LENGTH_OFFSET, y: length }],
      textAt: midpoint(dimStart, dimEnd),
    });
  }
  for (let i = 0; i < bayWidths.length; i++) {
    // Per-bay: measured along y at the left edge, dimension line inside the length one.
    const dimStart = { x: -BAY_OFFSET, y: bayPositions[i] };
    const dimEnd = { x: -BAY_OFFSET, y: bayPositions[i + 1] };
    dims.push({
      label: String(roundUpTo50(bayWidths[i])),
      value: bayWidths[i],
      axis: 'y',
      dimStart,
      dimEnd,
      witnessStart: [{ x: -WITNESS_GAP, y: bayPositions[i] }, { x: -BAY_OFFSET, y: bayPositions[i] }],
      witnessEnd: [
        { x: -WITNESS_GAP, y: bayPositions[i + 1] },
        { x: -BAY_OFFSET, y: bayPositions[i + 1] },
      ],
      textAt: midpoint(dimStart, dimEnd),
    });
  }

  // Gable ridge runs across the span (along x); a skillion falls along the length.
  const roofArrow = fallsAlongLength(shed)
    ? { x1: span / 2, y1: 0, x2: span / 2, y2: length }
    : { x1: 0, y1: length / 2, x2: span, y2: length / 2 };

  const warnings: string[] = [];
  const openings = shed.openings.map((opening: Opening) => {
    const placement = resolveOpeningPlacement(opening, shed);
    if (!placement.valid && placement.reason !== undefined) {
      warnings.push(placement.reason);
    }
    const rect = placementToPlanRect(opening, shed);
    return {
      id: opening.id,
      type: opening.type,
      wall: opening.wall,
      u: placement.u,
      swing: opening.swing,
      height: opening.height,
      rect,
      symbol: buildOpeningSymbol(opening, rect),
    };
  });

  return { outline, bayLines, dims, roofArrow, openings, options: buildPlacedOptions(shed), warnings };
}

/** How far a gable-infill's plan symbol points into the building, mm. */
const GABLE_SYMBOL_DEPTH = 600;

/**
 * The drawing role and stroke style each kind uses.
 *
 * Roof fixtures read as blue technical annotation (the same family as the roof
 * direction arrow), concealed structure as dashed grey, and anything projecting
 * outside the building as a thin solid line.
 */
const OPTION_ROLE: Record<OptionKind, { role: OptionRole; dashed: boolean }> = {
  skylight: { role: 'roof', dashed: false },
  gable_infill: { role: 'roof', dashed: true },
  mezzanine: { role: 'structure', dashed: true },
  dividing_wall: { role: 'structure', dashed: true },
  outrigger: { role: 'structure', dashed: true },
  awning: { role: 'exterior', dashed: false },
  // A carry beam and a cantilever are load paths the customer is being sold, so
  // they draw solid rather than dashed: dashed reads as concealed framing.
  carry_beam: { role: 'structure', dashed: false },
  cantilever: { role: 'roof', dashed: false },
  overhang: { role: 'roof', dashed: false },
  stable: { role: 'exterior', dashed: false },
  horizontal_cladding: { role: 'exterior', dashed: false },
  /*
   * A catalogue accessory has no shape, so this entry is never read: `resolveOptions`
   * filters it out before the plan is built. It exists because the map is keyed by
   * every kind, and a missing key would be a compile error — which is the right
   * pressure: a new kind has to state where it draws, or that it does not.
   */
  misc_option: { role: 'structure', dashed: true },
};

/**
 * Turn each resolved option into the primitives the canvas draws.
 *
 * A skylight and an awning are a plain rectangle. A mezzanine also gets a
 * diagonal cross, which is the drawing convention for a raised slab and makes it
 * distinguishable from a dividing wall at a glance. A gable infill carries the
 * triangle that closes the end above wall height, drawn across the full span
 * with its apex at the ridge.
 */
function buildPlacedOptions(shed: ShedConfig): PlacedOption[] {
  return resolveOptions(shed).map((option: ResolvedOption) => {
    const style = OPTION_ROLE[option.kind];
    const { rect } = option;
    const lines: [number, number, number, number][] = [];

    if (option.kind === 'mezzanine' || option.kind === 'stable') {
      // A diagonal cross marks a raised or enclosed volume. Without it a stable
      // is an unremarkable rectangle, indistinguishable from an awning.
      lines.push(
        [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
        [rect.x + rect.width, rect.y, rect.x, rect.y + rect.height],
      );
    }

    if (option.kind === 'horizontal_cladding') {
      // Battens run across the wall face. Three lines at even spacing read as a
      // batten run without turning the plan into a hatch pattern.
      // The strip is thin across the wall, so its long axis tells the direction
      // without needing the wall in the resolved value.
      const horizontal = rect.width >= rect.height;
      for (let i = 1; i <= 3; i++) {
        const t = i / 4;
        if (horizontal) {
          const y = rect.y + rect.height * t;
          lines.push([rect.x, y, rect.x + rect.width, y]);
        } else {
          const x = rect.x + rect.width * t;
          lines.push([x, rect.y, x, rect.y + rect.height]);
        }
      }
    }

    const placed: PlacedOption = {
      id: option.id,
      kind: option.kind,
      role: style.role,
      dashed: style.dashed,
      rect,
      lines,
    };

    if (option.kind === 'gable_infill' && option.triangle !== undefined) {
      // A gable end is closed, so in plan it reads as a filled end strip. The
      // triangle is the drawing symbol for "the slope closes here": its base is
      // the strip and its apex points into the building, which distinguishes it
      // from a dividing wall drawn at the same place.
      const inward = rect.y === 0 ? 1 : -1;
      const apexDepth = GABLE_SYMBOL_DEPTH * inward;
      placed.triangle = {
        points: [
          { x: rect.x, y: rect.y },
          { x: rect.x + rect.width, y: rect.y },
          { x: rect.x + rect.width / 2, y: rect.y + apexDepth },
        ],
      };
    }

    return placed;
  });
}
