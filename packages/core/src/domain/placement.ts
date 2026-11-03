/**
 * Opening placement on walls.
 *
 * Wall-local offset `u` is measured in millimetres from the wall's left corner
 * *as seen from outside the building* (spec §4.3). `placementToPlanRect` maps
 * that offset into the shed's global plan coordinates.
 *
 * Plan convention used here (all millimetres, origin at the front-left corner):
 *   - `x` runs along the span (0 .. shed.span), left to right when looking at
 *     the front of the shed;
 *   - `y` runs along the length (0 .. shed.length), front edge at `y = 0`.
 * The outside of the front wall is therefore `−y`, the back wall `+y`, the left
 * wall `−x`, and the right wall `+x`.
 *
 * Pure TypeScript: no React, Next.js, Zustand, Konva, or three.
 */

import type { Opening, ShedConfig, ShedOption, WallSide } from './types';
import type { PlanGeometry, PlacedOpening, PlacedOption } from './plan';
import { normaliseOption } from './options';
import { computeBayPositions } from './bays';

/** Result of resolving an opening's horizontal position along its wall. */
export interface Placement {
  /** Wall-local offset in mm from the wall's left corner (as seen from outside). */
  u: number;
  /** Whether the opening fits within its wall and the wall's height. */
  valid: boolean;
  /** Human-readable explanation, present only when `valid` is false. */
  reason?: string;
}

/**
 * The overlay shown while an opening is dragged along its wall: a guide line
 * from the wall's `u = 0` corner to the opening's near edge, and the live
 * offset readout (spec: "cách lề trái 1200 mm" — 1200 mm from the left edge).
 */
export interface DragGuide {
  /** The guide line along the wall, from its u = 0 corner to the door's near edge. */
  line: [number, number, number, number];
  /** Where the millimetre readout sits. */
  textAt: { x: number; y: number };
  /** The door's live wall offset, rounded to whole mm. */
  offsetMm: number;
  /** The label to render, e.g. "1200 mm". */
  label: string;
}

/**
 * The overall run of `wall` in millimetres. Front/back walls run along the span;
 * left/right walls run along the length.
 */
export function wallLength(shed: ShedConfig, wall: WallSide): number {
  return wall === 'front' || wall === 'back' ? shed.span : shed.length;
}

/**
 * Resolve an opening's wall-local offset `u` and whether it fits its wall.
 *
 * An opening that does not fit is still returned with its computed `u`, flagged
 * `valid: false` with a `reason`, so the UI can show it rather than silently
 * dropping it.
 */
export function resolveOpeningPlacement(opening: Opening, shed: ShedConfig): Placement {
  const run = wallLength(shed, opening.wall);

  let u: number;
  switch (opening.align) {
    case 'left':
      u = 0;
      break;
    case 'right':
      u = run - opening.width;
      break;
    case 'custom':
      u = opening.offset ?? 0;
      break;
    case 'center':
    default:
      u = (run - opening.width) / 2;
      break;
  }

  const reason = invalidReason(opening, shed, run, u);
  return reason === undefined ? { u, valid: true } : { u, valid: false, reason };
}

/** Returns a human-readable reason when the opening does not fit, else undefined. */
function invalidReason(
  opening: Opening,
  shed: ShedConfig,
  run: number,
  u: number,
): string | undefined {
  if (u < 0) {
    return `Opening starts ${Math.abs(u)} mm before the left edge of the ${opening.wall} wall.`;
  }
  if (u + opening.width > run) {
    const over = u + opening.width - run;
    return `Opening extends ${over} mm past the right edge of the ${opening.wall} wall.`;
  }
  if (opening.height <= 0) {
    return 'Opening height must be greater than zero.';
  }
  if (opening.height > shed.height) {
    return `Opening height ${opening.height} mm exceeds the wall height ${shed.height} mm.`;
  }
  if (opening.sill < 0) {
    return 'Opening sill cannot be below the floor.';
  }
  if (opening.sill + opening.height > shed.height) {
    return `Opening top (sill ${opening.sill} mm + height ${opening.height} mm) exceeds the wall height ${shed.height} mm.`;
  }
  return undefined;
}

/**
 * The opening's footprint in plan coordinates (mm), in the shed's global plan
 * space rather than wall-local.
 *
 * The opening's extent always lies on its own wall's axis, so exactly one of
 * `width` / `height` is non-zero: front/back walls run along x, so the extent
 * goes in `width`; left/right walls run along y, so it goes in `height`. A wall
 * opening is a line segment in plan view, so the other field is 0; the 3D layer
 * uses `opening.height` directly for the vertical dimension.
 */
export function placementToPlanRect(
  opening: Opening,
  shed: ShedConfig,
): { x: number; y: number; width: number; height: number } {
  const { u } = resolveOpeningPlacement(opening, shed);
  const { width } = opening;

  switch (opening.wall) {
    case 'back':
      // Viewed from outside (+y) the wall's left corner is at x = span.
      return { x: shed.span - u - width, y: shed.length, width, height: 0 };
    case 'left':
      // Viewed from outside (−x) the wall's left corner is at y = length.
      // The wall runs along y, so the opening's extent goes in `height`.
      return { x: 0, y: shed.length - u - width, width: 0, height: width };
    case 'right':
      // Viewed from outside (+x) the wall's left corner is at y = 0.
      // The wall runs along y, so the opening's extent goes in `height`.
      return { x: shed.span, y: u, width: 0, height: width };
    case 'front':
    default:
      // Viewed from outside (−y) the wall's left corner is at x = 0.
      return { x: u, y: 0, width, height: 0 };
  }
}

/** Clamp `value` into `[min, max]`; `min` wins if the range is inverted. */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * The wall-local offset `u` of a plan point, the inverse of
 * `placementToPlanRect` for that wall's own axis.
 *
 * Each wall projects onto a different plan edge and measures from the corner
 * where its `u = 0` begins as seen from outside the building (spec §4.3):
 *
 * | Wall    | `u`                     |
 * |---------|-------------------------|
 * | `front` | `point.x`               |
 * | `back`  | `shed.span − point.x`   |
 * | `left`  | `shed.length − point.y` |
 * | `right` | `point.y`               |
 *
 * `back` and `left` are measured from the far edge of their rect (`x + width` /
 * `y + height`), not the rect origin. The raw value is returned unclamped;
 * `constrainOpeningU` is what keeps an opening inside its wall.
 */
export function planPointToWallU(
  shed: ShedConfig,
  wall: WallSide,
  point: { x: number; y: number },
): number {
  switch (wall) {
    case 'back':
      return shed.span - point.x;
    case 'left':
      return shed.length - point.y;
    case 'right':
      return point.y;
    case 'front':
    default:
      return point.x;
  }
}

/**
 * The wall whose line is closest to a plan point.
 *
 * A plan point's distance to each wall's own line is measured perpendicular to
 * that line: the front wall sits at `y = 0`, the back at `y = shed.length`, the
 * left at `x = 0`, and the right at `x = shed.span`. The nearest of the four
 * wins, so a right-click anywhere on the plan resolves to the wall the user was
 * aiming at. The point need not be inside the shed — the distances are absolute,
 * so a point outside still resolves to the nearest edge.
 *
 * Ties are broken in the fixed order front, back, left, right, so the result is
 * deterministic.
 */
export function nearestWall(shed: ShedConfig, point: { x: number; y: number }): WallSide {
  const distances: { wall: WallSide; distance: number }[] = [
    { wall: 'front', distance: Math.abs(point.y) },
    { wall: 'back', distance: Math.abs(shed.length - point.y) },
    { wall: 'left', distance: Math.abs(point.x) },
    { wall: 'right', distance: Math.abs(shed.span - point.x) },
  ];

  let nearest = distances[0];
  for (const candidate of distances) {
    if (candidate.distance < nearest.distance) nearest = candidate;
  }
  return nearest.wall;
}

/**
 * The plan point at wall-local coordinates `(u, n)`: `u` millimetres along the
 * wall from its `u = 0` corner, and `n` millimetres perpendicular to it with
 * `n > 0` pointing *outward*, away from the building interior.
 *
 * The corner and the increasing-`u` direction match `planPointToWallU` and
 * `placementToPlanRect` (the direction is read from `wallDisplacement`, so there
 * is one sign table), so a guide built in this frame runs along its own wall
 * rather than across the plan — a side-wall guide is not drawn sideways.
 */
function wallLocalPoint(
  shed: ShedConfig,
  wall: WallSide,
  u: number,
  n: number,
): { x: number; y: number } {
  // The wall's `u = 0` corner, in global plan coordinates.
  const corner =
    wall === 'back' ? { x: shed.span, y: shed.length } :
    wall === 'left' ? { x: 0, y: shed.length } :
    wall === 'right' ? { x: shed.span, y: 0 } :
    { x: 0, y: 0 };
  // The unit vector along +u (front +x, back −x, left −y, right +y).
  const along = wallDisplacement(shed, wall, 1);
  // The outward unit normal (front −y, back +y, left −x, right +x).
  const outward =
    wall === 'front' ? { x: 0, y: -1 } :
    wall === 'back' ? { x: 0, y: 1 } :
    wall === 'left' ? { x: -1, y: 0 } :
    { x: 1, y: 0 };
  return {
    x: corner.x + along.x * u + outward.x * n,
    y: corner.y + along.y * u + outward.y * n,
  };
}

/**
 * How far off the wall the readout sits, mm. Comfortably clear of the outline
 * and the opening symbol, while staying inside the dimension strings (which sit
 * at 900 mm and beyond), so the label is readable at the fitted zoom.
 */
const GUIDE_OFFSET_MM = 450;

/**
 * The drag overlay for an opening dragged to wall offset `u`.
 *
 * The line runs along the wall from its `u = 0` corner to the opening's near
 * edge (both at the wall's own line), and the readout is the line's midpoint
 * pushed `GUIDE_OFFSET_MM` outward, so the label does not sit on the outline.
 * The offset is reported in whole millimetres — the canonical unit — even though
 * `u` itself stays exact during the drag.
 */
export function dragGuide(shed: ShedConfig, opening: Opening, u: number): DragGuide {
  const start = wallLocalPoint(shed, opening.wall, 0, 0);
  const end = wallLocalPoint(shed, opening.wall, u, 0);
  const textAt = wallLocalPoint(shed, opening.wall, u / 2, GUIDE_OFFSET_MM);
  const offsetMm = Math.round(u);
  return {
    line: [start.x, start.y, end.x, end.y],
    textAt,
    offsetMm,
    label: `${offsetMm} mm`,
  };
}

/**
 * Clamp a candidate offset so the opening stays within its wall:
 * `clamp(candidateU, 0, max(0, wallLength(shed, wall) − opening.width))`.
 *
 * The `max(0, …)` pins an opening wider than its wall to `0`, rather than
 * producing a negative upper bound that would be inverted.
 */
export function constrainOpeningU(shed: ShedConfig, opening: Opening, candidateU: number): number {
  const upper = Math.max(0, wallLength(shed, opening.wall) - opening.width);
  return clamp(candidateU, 0, upper);
}

/**
 * The change in a wall's offset `u` produced by a plan-space displacement `d`
 * (mm), i.e. how far along its wall a drag moved the opening.
 *
 * Derived from `planPointToWallU` rather than a second sign table, so the drag
 * and the domain's projection cannot drift apart. `planPointToWallU` is affine,
 * so subtracting its value at the plan origin `(0, 0)` cancels the wall's
 * constant term (`0` for `front`/`right`, `span` for `back`, `length` for
 * `left`) and leaves only the displacement's contribution — the offset change.
 * It assumes the dragged group's rest local position is the plan origin, which
 * is why `d` is a *displacement* from that rest position and not an absolute
 * plan coordinate.
 *
 * The sign follows each wall's `u` direction (see `planPointToWallU`): a `+x`
 * displacement increases `u` on `front` but decreases it on `back`; a `+y`
 * displacement increases `u` on `right` but decreases it on `left`.
 */
export function displacementToDu(
  shed: ShedConfig,
  wall: WallSide,
  d: { x: number; y: number },
): number {
  return planPointToWallU(shed, wall, d) - planPointToWallU(shed, wall, { x: 0, y: 0 });
}

/**
 * The inverse of `displacementToDu`: the plan-space displacement (mm) that moves
 * an opening by `du` along its wall. Only the wall's own axis moves — the cross
 * axis is pinned to `0`, so a dragged opening never leaves its wall line — and
 * the sign is read back from `displacementToDu` so there is one source of truth
 * for the direction.
 */
export function wallDisplacement(
  shed: ShedConfig,
  wall: WallSide,
  du: number,
): { x: number; y: number } {
  const horizontal = wall === 'front' || wall === 'back';
  const sign = displacementToDu(shed, wall, horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 });
  return horizontal ? { x: sign * du, y: 0 } : { x: 0, y: sign * du };
}

/**
 * Default hit-test halo around an opening's rect, in millimetres (spec §4.3).
 * The single source of truth for the tolerance: callers that want the spec
 * value pass no argument and take this default, so the click path, the
 * context-menu path, and the domain never drift apart.
 */
const DEFAULT_HIT_TOLERANCE_MM = 150;

/**
 * The plan rect an opening can be **grabbed** by, expanded from its footprint by
 * `toleranceMm` on all four sides.
 *
 * A wall opening is a line segment in plan view — exactly one of `width`/`height`
 * is zero — so its drawn symbol is a set of thin strokes with a hollow middle.
 * Konva hit-tests a shape's own drawn geometry, so without a grab area only the
 * strokes themselves are draggable and a press on the door's interior falls
 * through to the (draggable) Stage and pans the camera instead. `PlanCanvas`
 * renders this rect as an invisible, filled hit area over the symbol, which
 * makes the whole opening grabbable.
 *
 * This is the *same* expansion `openingAtPlanPoint` applies for click selection,
 * so "what I can click to select" and "what I can grab to drag" are one rule.
 */
export function openingGrabRect(
  rect: { x: number; y: number; width: number; height: number },
  toleranceMm: number = DEFAULT_HIT_TOLERANCE_MM,
): { x: number; y: number; width: number; height: number } {
  return {
    x: rect.x - toleranceMm,
    y: rect.y - toleranceMm,
    width: rect.width + toleranceMm * 2,
    height: rect.height + toleranceMm * 2,
  };
}

/**
 * The topmost opening whose plan rect — expanded by `toleranceMm` on all four
 * sides — contains `point`, or `null` when none does.
 *
 * Iterates `geometry.openings` backwards so the last-drawn (topmost) opening
 * wins. Both axes are expanded regardless of a zero dimension, so a side-wall
 * opening (rect `width: 0`, `height: opening.width`) is still hittable.
 */
export function openingAtPlanPoint(
  geometry: PlanGeometry,
  point: { x: number; y: number },
  toleranceMm: number = DEFAULT_HIT_TOLERANCE_MM,
): PlacedOpening | null {
  for (let i = geometry.openings.length - 1; i >= 0; i--) {
    const opening = geometry.openings[i];
    const { rect } = opening;
    if (
      point.x >= rect.x - toleranceMm &&
      point.x <= rect.x + rect.width + toleranceMm &&
      point.y >= rect.y - toleranceMm &&
      point.y <= rect.y + rect.height + toleranceMm
    ) {
      return opening;
    }
  }
  return null;
}

/**
 * The patch that moves an opening to wall offset `u`, or `null` when `id` is
 * unknown.
 *
 * `align` is forced to `'custom'` so the new offset actually applies, and the
 * offset is clamped into the wall by `constrainOpeningU`.
 */
export function moveOpeningTo(
  shed: ShedConfig,
  id: string,
  u: number,
): { id: string; patch: Partial<Opening> } | null {
  const opening = shed.openings.find((o) => o.id === id);
  if (!opening) return null;
  return { id, patch: { align: 'custom', offset: constrainOpeningU(shed, opening, u) } };
}

/**
 * True when `point` (plan mm) lies within the shed's footprint rectangle.
 *
 * The building outline is `geometry.outline`, an axis-aligned rect in plan
 * coordinates. Edges are inclusive, so a point exactly on a wall counts as
 * inside. Unlike `openingAtPlanPoint` there is **no** tolerance halo: a click
 * just outside the building is outside, which is what lets the canvas treat it
 * as "clicked away" and clear the selection.
 */
export function pointInFootprint(
  geometry: PlanGeometry,
  point: { x: number; y: number },
): boolean {
  const { x, y, width, height } = geometry.outline;
  return (
    point.x >= x &&
    point.x <= x + width &&
    point.y >= y &&
    point.y <= y + height
  );
}

// --- Options ----------------------------------------------------------------

/**
 * The topmost option whose plan rect — expanded by `toleranceMm` on all four
 * sides — contains `point`, or `null` when none does.
 *
 * Mirrors `openingAtPlanPoint`, including its backward iteration so the
 * last-drawn option wins. Callers apply the priority rule (openings before
 * options) themselves: an option and a door can overlap, and the door is the
 * finer target.
 */
export function optionAtPlanPoint(
  geometry: PlanGeometry,
  point: { x: number; y: number },
  toleranceMm: number = DEFAULT_HIT_TOLERANCE_MM,
): PlacedOption | null {
  for (let i = geometry.options.length - 1; i >= 0; i--) {
    const option = geometry.options[i];
    const { rect } = option;
    if (
      point.x >= rect.x - toleranceMm &&
      point.x <= rect.x + rect.width + toleranceMm &&
      point.y >= rect.y - toleranceMm &&
      point.y <= rect.y + rect.height + toleranceMm
    ) {
      return option;
    }
  }
  return null;
}

/** The bay whose interval contains `y`, clamped to the first/last bay. */
function bayAtY(shed: ShedConfig, y: number): { index: number; start: number; end: number } {
  const positions = computeBayPositions(shed.length, shed.bays);
  for (let index = 0; index < positions.length - 1; index++) {
    if (y <= positions[index + 1]) {
      return { index, start: positions[index], end: positions[index + 1] };
    }
  }
  const last = positions.length - 2;
  return { index: last, start: positions[last], end: positions[last + 1] };
}

/** The bay index whose centre line is nearest to `u` along a wall. */
function nearestBayIndex(shed: ShedConfig, u: number): number {
  const positions = computeBayPositions(shed.length, shed.bays);
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < positions.length - 1; index++) {
    const centre = (positions[index] + positions[index + 1]) / 2;
    const distance = Math.abs(centre - u);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

/**
 * Where an option lands when dragged to `point`, clamped by the kind's own
 * anchor rule and by the option's bounds.
 *
 * Each kind is anchored differently, so each drag means something different:
 * a skylight moves between bays, an awning slides along its wall, an outrigger
 * snaps to bay lines, a mezzanine jumps to the corner quadrant the pointer is
 * in, and a dividing wall slides along its own axis. A gable infill has no
 * position to move — its end is its identity — so it is returned unchanged.
 */
export function constrainOptionDrag(
  shed: ShedConfig,
  option: ShedOption,
  point: { x: number; y: number },
): ShedOption {
  switch (option.kind) {
    case 'skylight': {
      const bay = bayAtY(shed, Math.min(Math.max(point.y, 0), shed.length));
      const span = bay.end - bay.start;
      const alongBay = span > 0 ? (point.y - bay.start) / span : 0.5;
      return normaliseOption({ ...option, bay: bay.index, alongBay }, shed);
    }

    case 'awning': {
      // A drag moves an awning **along its own wall**; it never hops to another
      // wall. Re-picking the nearest wall from the pointer would teleport it to
      // the opposite side of the building the moment the pointer crossed the
      // mid-line, which is not a move a user can intend. Changing walls is the
      // editor's Wall field.
      const u = planPointToWallU(shed, option.wall, point);
      // The offset is the strip's leading edge, so centre the option on the
      // pointer rather than letting its left edge jump to the finger.
      const offset = u - option.width / 2;
      return normaliseOption({ ...option, align: 'custom', offset }, shed);
    }

    case 'outrigger': {
      // Same rule as an awning: along its own wall, snapped to a bay line.
      const u = planPointToWallU(shed, option.wall, point);
      return normaliseOption({ ...option, bay: nearestBayIndex(shed, u) }, shed);
    }

    case 'mezzanine': {
      const right = point.x > shed.span / 2;
      const back = point.y > shed.length / 2;
      const corner = `${back ? 'back' : 'front'}_${right ? 'right' : 'left'}` as const;
      return normaliseOption({ ...option, corner }, shed);
    }

    case 'dividing_wall': {
      const at = option.axis === 'x' ? point.y : point.x;
      return normaliseOption({ ...option, at }, shed);
    }

    case 'gable_infill':
      return option;

    case 'stable': {
      // Along its own wall, like an awning: a shelter does not hop walls.
      const u = planPointToWallU(shed, option.wall, point);
      return normaliseOption({ ...option, align: 'custom', offset: u - option.width / 2 }, shed);
    }

    case 'carry_beam': {
      const bay = bayAtY(shed, Math.min(Math.max(point.y, 0), shed.length));
      return normaliseOption({ ...option, beginBay: bay.index }, shed);
    }

    case 'cantilever': {
      // A cantilever hangs off a column line, so it snaps between bays like a
      // carry beam rather than sliding continuously along the wall.
      const bay = bayAtY(shed, Math.min(Math.max(point.y, 0), shed.length));
      return normaliseOption({ ...option, bay: bay.index }, shed);
    }

    // An overhang and a cladding band span their whole wall: their only free
    // dimension is a depth or a band height, which the editor owns, so a drag
    // has nothing to change.
    case 'overhang':
    case 'horizontal_cladding':
      return option;
  }
}

/**
 * The patch that moves option `id` to `point`, or `null` when the id is unknown.
 *
 * `kind` and `id` are never part of the patch: they are the identity the rest of
 * the option is shaped around.
 */
export function moveOptionTo(
  shed: ShedConfig,
  id: string,
  point: { x: number; y: number },
): { id: string; patch: Partial<ShedOption> } | null {
  const option = shed.options.find((entry) => entry.id === id);
  if (option === undefined) return null;
  const moved = constrainOptionDrag(shed, option, point);
  const { id: _id, kind: _kind, ...patch } = moved;
  return { id, patch: patch as Partial<ShedOption> };
}
