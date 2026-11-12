/**
 * 3D wall geometry with openings.
 *
 * Turns a `ShedConfig` into one rectangular wall face per side, each with the
 * openings on that wall expressed as holes in wall-local coordinates. This is
 * plain data: the 3D layer builds a `THREE.Shape` per wall and subtracts the
 * holes (spec §4.3). All values are millimetres; the component scales by 1/1000.
 *
 * Wall-local coordinates: `u` runs from the wall's left corner *as seen from
 * outside the building*, `sill` is height above the floor, and `width`/`height`
 * are the hole's own extent. Holes are always clamped into the wall face so the
 * geometry stays legal even when the opening does not fit; the user-facing
 * warning for a non-fitting opening is raised by `plan.ts`.
 *
 * Pure TypeScript: no React, Next.js, Zustand, Konva, or three.
 */

import type { ShedConfig, WallSide, DimensionedShed } from './types';
import { resolveOpeningPlacement, wallLength } from './placement';

/** A rectangular hole cut into a wall, in wall-local millimetres. */
export interface WallHole {
  /** Offset from the wall's left corner (as seen from outside), mm. */
  u: number;
  /** Height above the floor, mm. */
  sill: number;
  /** Hole width along the wall, mm. */
  width: number;
  /** Hole height up the wall, mm. */
  height: number;
}

/** One wall face, ready to be extruded by the 3D layer. */
export interface WallGeometry {
  side: WallSide;
  /** Wall length in mm. */
  width: number;
  /** Shed wall height in mm. */
  height: number;
  /** Openings on this wall, in wall-local coordinates. */
  holes: WallHole[];
  /** Placement of the wall's origin, mm; `rotationY` faces the wall inward. */
  transform: { position: [number, number, number]; rotationY: number };
}

/** All four sides, in a stable order. */
const SIDES: WallSide[] = ['front', 'back', 'left', 'right'];

/**
 * Where each wall's origin sits on the shed footprint, and how it faces inward.
 *
 * The 3D layer builds each wall as a shape spanning local `x ∈ [0, width]` with
 * every hole at local `x = u`, so the origin must be the corner that `u` is
 * measured from — the wall's left corner *as seen from outside*. Because
 * `rotationY` maps local `+x` to world `−x` for `back` (rotation `PI`) and to
 * world `−z` for `left` (rotation `PI/2`), those origins sit at the far corner
 * of their edge, not the near one, so the wall lands on the footprint rather
 * than outside it and its openings line up with the 2D plan.
 */
function wallTransform(
  shed: DimensionedShed,
  side: WallSide,
): { position: [number, number, number]; rotationY: number } {
  const { span, length } = shed;
  switch (side) {
    case 'back':
      return { position: [span, 0, length], rotationY: Math.PI };
    case 'left':
      return { position: [0, 0, length], rotationY: Math.PI / 2 };
    case 'right':
      return { position: [span, 0, 0], rotationY: -Math.PI / 2 };
    case 'front':
    default:
      return { position: [0, 0, 0], rotationY: 0 };
  }
}

/** Clamp `value` into `[min, max]`; a reversed range collapses to `min`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Build the four wall faces for `shed`.
 *
 * Each opening is attached to its own wall only. A hole is clamped into the wall
 * face in both axes: its width is clamped down to the wall length when the
 * opening is wider, then its offset is clamped into the remaining span, so
 * `0 <= u` and `u + width <= wall.width` always hold; and its `sill` is clamped
 * to `[0, wall.height]` with `height` then clamped to the space above it, so
 * `sill + height <= wall.height` always holds. A hole that leaves the outline
 * would give `ExtrudeGeometry` no defined result, so this keeps the geometry
 * legal even when the opening does not fit; the user-facing warning for a
 * non-fitting opening is raised by `plan.ts`.
 */
export function buildWallGeometries(shed: DimensionedShed): WallGeometry[] {
  return SIDES.map((side) => {
    const width = wallLength(shed, side);
    const holes: WallHole[] = [];

    for (const opening of shed.openings) {
      if (opening.wall !== side) continue;
      const { u } = resolveOpeningPlacement(opening, shed);
      const holeWidth = clamp(opening.width, 0, width);
      // Clamp vertically too. A hole that leaves the counter-clockwise outline
      // has no defined result in `ExtrudeGeometry` (it silently renders as a
      // malformed or solid wall), so `sill` and `height` are bounded to the wall
      // face in the same pass as the horizontal clamp. Clamp `sill` first, then
      // `height` against the space that remains above it.
      const sill = clamp(opening.sill, 0, shed.height);
      const holeHeight = clamp(opening.height, 0, shed.height - sill);
      holes.push({
        u: clamp(u, 0, width - holeWidth),
        sill,
        width: holeWidth,
        height: holeHeight,
      });
    }

    return { side, width, height: shed.height, holes, transform: wallTransform(shed, side) };
  });
}
