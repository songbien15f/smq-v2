'use client';

import type { DimensionedShed } from '@sq/core/domain';

/** Field of view, degrees. Narrower than the default so a long shed does not fisheye. */
export const FOV = 40;
/** Breathing room around the building, as a fraction of its bounding sphere. */
const FIT_MARGIN = 1.12;
/** Ground plane extent, metres. */
export const GROUND_SIZE = 240;
/** Shadow map resolution used only on desktop, where shadows are enabled. */
export const SHADOW_MAP_SIZE = 2048;

/** The camera's frame: where to look and where to stand, in metres. */
export interface CameraFrame {
  target: [number, number, number];
  position: [number, number, number];
  /** The building's longest horizontal side, metres — used to size limits and the shadow camera. */
  extent: number;
}

/**
 * Where the camera should stand to frame `shed`, for a canvas of `aspect` (width / height).
 *
 * ## Why the aspect is an argument
 *
 * The editor's 3D pane is **taller than it is wide** (measured 535 × 608). A perspective camera's
 * horizontal half-angle is `atan(tan(fov/2) × aspect)`, so with `aspect < 1` the horizontal direction
 * is the tighter one — and a distance computed from the vertical angle alone lets a 24 m shed run off
 * both sides. It did: measured, the building touched both canvas edges.
 *
 * So the distance comes from the **bounding sphere** and the **smaller** of the two half-angles. A
 * sphere rather than a box because the camera orbits: a distance that fits an axis-aligned box at one
 * angle clips it at another, and the operator should not have to zoom out after every drag.
 *
 * The target is the building's centre at a third of its height — low enough to see the roof from the
 * side rather than from above, high enough that the eaves are not edge-on.
 */
export function cameraFrameFor(shed: DimensionedShed, aspect = 1): CameraFrame {
  const spanM = shed.span / 1000;
  const lengthM = shed.length / 1000;
  const heightM = shed.height / 1000;
  const extent = Math.max(spanM, lengthM);

  // Half the diagonal of the building's bounding box: the radius the camera has to clear.
  const radius = Math.hypot(spanM, heightM, lengthM) / 2;
  const halfV = (FOV * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * Math.max(0.2, aspect));
  const halfAngle = Math.min(halfV, halfH);
  const distance = (radius / Math.sin(halfAngle)) * FIT_MARGIN;

  return {
    target: [spanM / 2, heightM / 3, lengthM / 2],
    // A three-quarter view: equal x and z offsets, lifted so the roof is visible.
    position: [spanM / 2 + distance * 0.62, heightM + distance * 0.5, lengthM / 2 + distance * 0.62],
    extent,
  };
}

