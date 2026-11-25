/**
 * Opening hardware as plain geometry, shared by every renderer that needs it.
 *
 * ## Why this is data and not JSX
 *
 * A door's hardware is a fixed set of boxes, cylinders and rings — guides, a drum, a frame, a
 * leaf, a track. Expressing it as numbers lets a test assert the invariants a person would check
 * by eye ("every roller door has two guides", "the drum is above the head", "nothing covers the
 * window glass") without a WebGL context, and lets the 2D symbol, the 3D view and a future export
 * read the same decisions instead of each deriving them again.
 *
 * ## The coordinate frame
 *
 * Wall-local millimetres, the same frame `buildWallGeometries` uses: `x` runs along the wall from
 * its left corner **as seen from outside**, `y` is height above the floor, and `z` points **into**
 * the shed. Hardware that stands proud of the wall therefore has `z < 0`. This is stated once here
 * because getting it backwards is invisible until somebody looks at the render: the editor's
 * window frame was written into the wall for exactly that reason.
 *
 * ## Where the numbers come from
 *
 * `JAMB`, `ROLLER_*`, `WINDOW_*` and `TRACK_INSET` are the 2D symbol's own constants
 * (`plan.ts` imports them from here), so a 2D symbol and its 3D counterpart are the same size.
 * The rest — slat pitch, frame sections, drum radius — are the desktop's values where it has them
 * (`RDOOR_ROLLER_RADIUS = 150`, `PADOOR_COLUMN_THICK = 30`) and otherwise a plausible commercial
 * dimension, noted at the constant.
 *
 * Pure TypeScript: no React, Next.js, Zustand, Konva, or three.
 */

import type { Opening, ShedColors } from './types';
/* The wall's cladding runs from z = 0 (outside face) to z = WALL_DEPTH (inside face). */
import { WALL_DEPTH } from './structure3d';

/** A point or an extent in wall-local millimetres. */
export type Vec3 = [number, number, number];

/** How a part is shaded; a renderer maps each finish to one material recipe. */
export type PartFinish = 'sheet' | 'door' | 'trim' | 'metal' | 'glass';

/** One piece of hardware. */
export interface OpeningPart {
  /** Stable name for tests and debugging, e.g. `guide-left`. */
  kind: string;
  shape: 'box' | 'cylinder' | 'torus';
  /** Centre of the part, wall-local mm. */
  position: Vec3;
  /** `box` only: full extent along each axis. */
  size?: Vec3;
  /** `cylinder` and `torus`: the outer radius. */
  radius?: number;
  /** `cylinder` only: the length along its own axis. */
  height?: number;
  /** `torus` only: the thickness of the ring. */
  tube?: number;
  /** Euler rotation in radians about the part's own centre. */
  rotation?: Vec3;
  /**
   * For a triangular face (a gable end): base and rise, so a renderer builds a prism rather than a
   * box. The box's `size` still describes the bounding volume, so a bounding-box reader works too.
   */
  triangle?: { base: number; rise: number; rightAngle?: boolean };
  /** Hex colour, from the shed's ten colour roles. */
  color: string;
  finish: PartFinish;
  /** Set below 1 for glass; the renderer treats this as transparency. */
  opacity?: number;
}

/* ------------------------------------------------------------------ shared sizes */

/** Jamb block size, mm. The 2D symbol's `JAMB` tick. */
export const JAMB = 90;
/** Depth of a window's plan rectangle into the wall, mm. */
export const WINDOW_DEPTH = JAMB;
/** Inset of a window's interior lines from the rectangle edges, mm. */
export const WINDOW_INSET = JAMB / 2;
/** Plan depth of a plain hole's rectangle into the wall, mm. */
export const OPENING_HOLE_DEPTH = JAMB;
/** Depth of a roller door's curtain and tracks into the building, mm. */
export const ROLLER_DEPTH = 2 * JAMB;
/** Inset of a roller door's curtain from each jamb, mm. */
export const ROLLER_INSET = JAMB / 2;
/** How far inside the wall a sliding door's track line sits, mm. */
export const TRACK_INSET = 60;
/** Width of a roller door's side track, mm. */
export const ROLLER_TRACK_WIDTH = JAMB / 2;
/** Roller door drum radius, mm — the desktop's `RDOOR_ROLLER_RADIUS`. */
export const ROLLER_DRUM_RADIUS = 150;
/** Roller door slat pitch, mm. 150 is a common commercial slat. */
export const ROLLER_SLAT_PITCH = 150;
/** PA door frame section, mm — the desktop's `PADOOR_COLUMN_THICK` is 30; 70 reads at 20 m. */
export const PA_FRAME = 70;
/** Window frame section, mm. Twice `WINDOW_INSET`, so a frame matches the 2D inset. */
export const WINDOW_FRAME = WINDOW_INSET * 2;
/** How far a PA door leaf stands open, radians. */
export const PA_OPEN_ANGLE = (22 * Math.PI) / 180;
/** Glass tint. Not a paint colour: the book's `window` role is the *frame*. */
export const GLASS_COLOR = '#9fc3d0';

/* ------------------------------------------------------------------ helpers */

function box(
  kind: string,
  position: Vec3,
  size: Vec3,
  color: string,
  finish: PartFinish,
  rotation?: Vec3,
): OpeningPart {
  return rotation === undefined
    ? { kind, shape: 'box', position, size, color, finish }
    : { kind, shape: 'box', position, size, color, finish, rotation };
}

/* ------------------------------------------------------------------ roller door */

/**
 * Roller door: curtain with slat ribs, two guides, head, drum, brackets, springs, bottom bar.
 *
 * The desktop's `RDoor3D` draws the same set (`RDOOR_FRAME_THICK`, `ROLLER_RADIUS`,
 * `BRACKET_HEIGHT`) against a textured sheet. Here the sheet is sliced into real ribs, which stays
 * legible from every camera angle. Curtain, guides and head sit outside the wall (`z < 0`); the
 * drum, its brackets and springs are inside (`z > WALL_DEPTH`), hidden from outside.
 */
export function rollerDoorParts(opening: Opening, u: number, colors: ShedColors): OpeningPart[] {
  const w = opening.width;
  const h = opening.height;
  const cx = u + w / 2;
  const parts: OpeningPart[] = [];

  // Curtain, hanging just outside the guides.
  parts.push(
    box('curtain', [cx, h / 2, -28], [w - ROLLER_TRACK_WIDTH * 2, h, 22], colors.rollerDoor, 'door'),
  );

  // Slat ribs; the bottom bar closes the curtain at the floor.
  const slats = Math.max(2, Math.round(h / ROLLER_SLAT_PITCH));
  const slatHeight = h / slats;
  for (let i = 1; i < slats; i += 1) {
    parts.push(
      box(
        `slat-${i}`,
        [cx, i * slatHeight, -48],
        [w - ROLLER_TRACK_WIDTH * 2, 22, 10],
        colors.barge,
        'metal',
      ),
    );
  }

  /*
   * Guide rails either side, full height, standing proud of the wall.
   *
   * Their **back face lands exactly on z = 0** — the wall's outside plane — which is coplanar with the
   * cladding and flickers. Each guide is therefore sunk 10 mm into the wall so its back face is at
   * z = +10 (inside the cladding volume, never on its surface) while its front still stands clear.
   */
  const guideSink = 10;
  parts.push(
    box(
      'guide-left',
      [u + ROLLER_TRACK_WIDTH / 2, h / 2, -ROLLER_TRACK_WIDTH + guideSink],
      [ROLLER_TRACK_WIDTH, h, ROLLER_TRACK_WIDTH * 2],
      colors.barge,
      'trim',
    ),
    box(
      'guide-right',
      [u + w - ROLLER_TRACK_WIDTH / 2, h / 2, -ROLLER_TRACK_WIDTH + guideSink],
      [ROLLER_TRACK_WIDTH, h, ROLLER_TRACK_WIDTH * 2],
      colors.barge,
      'trim',
    ),
  );

  // Head frame above the opening, covering the guides.
  parts.push(
    box('head', [cx, h + 45, -70], [w + ROLLER_TRACK_WIDTH * 3, 90, 120], colors.barge, 'trim'),
  );

  /*
   * Drum, brackets and springs — **inside** the shed, on the inner face of the wall above the
   * opening, as a roller door is actually hung: from outside only the curtain, guides and head
   * show. The drum's lowest point sits above the head's top edge, or the rolled curtain appears to
   * pass through its own frame. It clears the inner face (`z = WALL_DEPTH`) by 30 mm; each bracket
   * reaches from the wall to past the drum's axis, its back face sunk 10 mm into the wall so it is
   * never coplanar with the inner cladding surface.
   */
  const drumY = h + 250;
  const drumZ = WALL_DEPTH + 30 + ROLLER_DRUM_RADIUS;
  const bracketBack = WALL_DEPTH - 10;
  const bracketFront = drumZ + 60;
  const bracketZ = (bracketBack + bracketFront) / 2;
  const bracketDepth = bracketFront - bracketBack;
  parts.push({
    kind: 'drum',
    shape: 'cylinder',
    position: [cx, drumY, drumZ],
    radius: ROLLER_DRUM_RADIUS,
    height: w + 140,
    rotation: [0, 0, Math.PI / 2],
    color: colors.rollerDoor,
    finish: 'metal',
  });
  parts.push(
    box('bracket-left', [u + 35, h + 170, bracketZ], [70, 220, bracketDepth], colors.barge, 'trim'),
    box('bracket-right', [u + w - 35, h + 170, bracketZ], [70, 220, bracketDepth], colors.barge, 'trim'),
  );
  for (const [index, at] of [0.3, 0.7].entries()) {
    parts.push({
      kind: `spring-${index}`,
      shape: 'torus',
      position: [u + w * at, drumY, drumZ],
      radius: 78,
      tube: 11,
      rotation: [0, Math.PI / 2, 0],
      color: colors.barge,
      finish: 'metal',
    });
  }

  // Bottom bar, so the curtain reads as a door rather than a printed panel.
  parts.push(
    box('bottom-bar', [cx, 35, -44], [w - ROLLER_TRACK_WIDTH * 2, 60, 40], colors.barge, 'metal'),
  );

  return parts;
}

/* ------------------------------------------------------------------ PA door */

/**
 * Personal access door: a three-sided frame, a leaf swung open, handle and hinges.
 *
 * The leaf hangs on the jamb `hinge` names (left as seen from outside by default) and swings
 * outward, which is negative `z`. Its rotation is carried on the part rather than applied by the
 * renderer, so a right-hinged door is a different set of numbers, not a different code path.
 */
export function paDoorParts(opening: Opening, u: number, colors: ShedColors): OpeningPart[] {
  const w = opening.width;
  const h = opening.height;
  const cx = u + w / 2;
  const hingedRight = opening.hinge === 'right';
  const parts: OpeningPart[] = [];

  // Frame: two stiles, a head, a threshold. The threshold closes the bottom.
  parts.push(
    box('frame-left', [u + PA_FRAME / 2, h / 2, -PA_FRAME / 2], [PA_FRAME, h, PA_FRAME * 1.4], colors.paDoor, 'trim'),
    box('frame-right', [u + w - PA_FRAME / 2, h / 2, -PA_FRAME / 2], [PA_FRAME, h, PA_FRAME * 1.4], colors.paDoor, 'trim'),
    box('frame-head', [cx, h - PA_FRAME / 2, -PA_FRAME / 2], [w, PA_FRAME, PA_FRAME * 1.4], colors.paDoor, 'trim'),
    box('threshold', [cx, 10, -PA_FRAME], [w, 20, PA_FRAME * 1.8], colors.barge, 'metal'),
  );

  const leafWidth = w - PA_FRAME * 2;
  const leafHeight = h - PA_FRAME * 2;
  const angle = PA_OPEN_ANGLE;
  const hingeX = hingedRight ? u + w - PA_FRAME : u + PA_FRAME;
  // A leaf hinged on the right opens the other way, so its sweep is mirrored.
  const swing = hingedRight ? -1 : 1;

  const leafCentreX = hingeX + swing * (leafWidth / 2) * Math.cos(angle);
  const leafCentreZ = -(leafWidth / 2) * Math.sin(angle) - PA_FRAME;

  parts.push(
    box(
      'leaf',
      [leafCentreX, PA_FRAME + leafHeight / 2, leafCentreZ],
      [leafWidth, leafHeight, 45],
      colors.paDoor,
      'door',
      [0, swing * angle, 0],
    ),
  );

  // Handle near the free edge, at the same rotation as the leaf.
  const handleAt = 0.88;
  parts.push(
    box(
      'handle',
      [
        hingeX + swing * leafWidth * handleAt * Math.cos(angle),
        PA_FRAME + leafHeight * 0.48,
        -leafWidth * handleAt * Math.sin(angle) - PA_FRAME - 60,
      ],
      [150, 28, 28],
      colors.barge,
      'metal',
      [0, swing * angle, 0],
    ),
  );

  // Three hinges on the hinge stile.
  for (const at of [0.18, 0.5, 0.82]) {
    parts.push(
      box(
        `hinge-${at}`,
        [hingeX + swing * 10, PA_FRAME + leafHeight * at, -PA_FRAME - 20],
        [36, 90, 40],
        colors.barge,
        'metal',
      ),
    );
  }

  return parts;
}

/* ------------------------------------------------------------------ sliding door */

/** One sliding leaf: infill plus four frame bars, all at the same depth. */
function slidingLeaf(
  index: number,
  centre: [number, number],
  width: number,
  height: number,
  z: number,
  colors: ShedColors,
): OpeningPart[] {
  const [cx, cy] = centre;
  const bar = 60;
  return [
    box(`leaf-${index}-panel`, [cx, cy, z], [width - bar * 2, height - bar * 2, 28], colors.slidingDoor, 'door'),
    box(`leaf-${index}-stile-left`, [cx - width / 2 + bar / 2, cy, z], [bar, height, 44], colors.barge, 'trim'),
    box(`leaf-${index}-stile-right`, [cx + width / 2 - bar / 2, cy, z], [bar, height, 44], colors.barge, 'trim'),
    box(`leaf-${index}-rail-top`, [cx, cy + height / 2 - bar / 2, z], [width, bar, 44], colors.barge, 'trim'),
    box(`leaf-${index}-rail-bottom`, [cx, cy - height / 2 + bar / 2, z], [width, bar, 44], colors.barge, 'trim'),
  ];
}

/**
 * Sliding door: one or two leaves on one or two tracks, the first leaf slid partly open.
 *
 * The leaf count is the operator's (`opening.leaves`), not a guess from the width: a 3.6 m
 * opening is a one-leaf or a two-leaf door depending on what was sold. A "double" track hangs the
 * second leaf twice as far off the wall, which is what makes it read differently from a single.
 */
export function slidingDoorParts(opening: Opening, u: number, colors: ShedColors): OpeningPart[] {
  const w = opening.width;
  const h = opening.height;
  const parts: OpeningPart[] = [];
  const double = opening.track === 'double';
  const hasTrack = opening.track !== null && opening.track !== 'none';
  const leaves = opening.leaves === 2 ? 2 : 1;

  const leafWidth = leaves === 2 ? w / 2 + 60 : w;
  const leafHeight = h - 40;
  const centreY = 20 + leafHeight / 2;

  // The moving leaf is slid away from the fixed one, leaving a gap at one end.
  const slide = Math.min(w * 0.18, leafWidth / 2);
  const centres: number[] =
    leaves === 2 ? [u + leafWidth / 2 - slide, u + w - leafWidth / 2] : [u + w / 2 - slide];

  if (hasTrack) {
    /*
     * The track has to span the leaves *in their current positions*, not just the opening: a leaf
     * parked past the jamb would otherwise hang off the end of its own rail.
     */
    const edges = centres.flatMap((centre) => [centre - leafWidth / 2, centre + leafWidth / 2]);
    const trackWidth = Math.max(...edges) - Math.min(...edges);
    const trackCentre = (Math.max(...edges) + Math.min(...edges)) / 2;

    parts.push(
      box('track-top', [trackCentre, h + 30, -TRACK_INSET - 20], [trackWidth, 60, 70], colors.barge, 'trim'),
    );
    if (double) {
      parts.push(
        box('track-top-2', [trackCentre, h + 30, -TRACK_INSET * 2 - 20], [trackWidth, 60, 70], colors.barge, 'trim'),
      );
    }
    parts.push(
      box('track-bottom', [trackCentre, 8, -TRACK_INSET - 20], [trackWidth, 16, 60], colors.barge, 'metal'),
    );
  }

  centres.forEach((centre, index) => {
    const depth = index === 1 && double ? -TRACK_INSET * 2 - 25 : -TRACK_INSET - 25;
    parts.push(...slidingLeaf(index, [centre, centreY], leafWidth, leafHeight, depth, colors));
  });

  return parts;
}

/* ------------------------------------------------------------------ window */

/**
 * Window: a ring of four bars, a centre mullion above 900 mm, glass set back, flashing above and
 * a sill cover below.
 *
 * The frame is four separate bars on purpose. A single box larger than the hole reads as a solid
 * rectangle — which is what the editor drew for a while — because nothing is left open for glass.
 */
export function windowParts(opening: Opening, u: number, colors: ShedColors): OpeningPart[] {
  const w = opening.width;
  const h = opening.height;
  const sill = opening.sill;
  const parts: OpeningPart[] = [];

  /*
   * Depth in the wall, not a crate bolted to it.
   *
   * The frame used to be `WINDOW_FRAME * 1.4` (126 mm) deep, centred at z = −35, so 98 mm of it stood
   * outside a 50 mm cladding, and the flashings reached 125 mm. At grazing angles it read as a box
   * stuck on the wall (measured 2026-11-24). Drawn in three planes now:
   *
   *   outside face  z = −25   the frame's front, 25 mm proud of the cladding
   *   glass         z = −10   inside the frame, still visible through it
   *   flashing      z = −15   outer face at −45, so it reads as a drip, not a shelf
   */
  const FRAME_DEPTH = 60;
  const frameZ = -25 + FRAME_DEPTH / 2;
  const FLASH_DEPTH = 60;
  const flashZ = -45 + FLASH_DEPTH / 2;

  parts.push({
    kind: 'glass',
    shape: 'box',
    position: [u + w / 2, sill + h / 2, -10],
    size: [w - WINDOW_FRAME, h - WINDOW_FRAME, 10],
    color: GLASS_COLOR,
    finish: 'glass',
    opacity: 0.34,
  });

  parts.push(
    box('frame-left', [u + WINDOW_FRAME / 2, sill + h / 2, frameZ], [WINDOW_FRAME, h, FRAME_DEPTH], colors.window, 'trim'),
    box('frame-right', [u + w - WINDOW_FRAME / 2, sill + h / 2, frameZ], [WINDOW_FRAME, h, FRAME_DEPTH], colors.window, 'trim'),
    box('frame-head', [u + w / 2, sill + h - WINDOW_FRAME / 2, frameZ], [w, WINDOW_FRAME, FRAME_DEPTH], colors.window, 'trim'),
    box('frame-sill', [u + w / 2, sill + WINDOW_FRAME / 2, frameZ], [w, WINDOW_FRAME, FRAME_DEPTH], colors.window, 'trim'),
  );

  // One centre mullion on a wide window, as the desktop's `Window3D` draws.
  if (w > 900) {
    parts.push(
      box('mullion', [u + w / 2, sill + h / 2, frameZ], [46, h - WINDOW_FRAME * 2, FRAME_DEPTH], colors.window, 'trim'),
    );
  }

  // Flashing: a drip above and a sill cover below, both wider than the frame.
  parts.push(
    box('head-flashing', [u + w / 2, sill + h + 15, flashZ], [w + 160, 30, FLASH_DEPTH], colors.barge, 'trim'),
    box('sill-flashing', [u + w / 2, sill - 20, flashZ], [w + 120, 40, FLASH_DEPTH], colors.barge, 'trim'),
  );

  return parts;
}

/* ------------------------------------------------------------------ entry point */

/**
 * Every fitted part for one opening, in wall-local millimetres.
 *
 * A plain `opening` is a hole with nothing fitted into it, so the answer is empty — the wall is
 * cut and the 3D layer draws nothing in the gap. `u` is the hole's offset from the wall's left
 * corner, which `buildWallGeometries` has already clamped into the wall face.
 */
export function openingParts(opening: Opening, u: number, colors: ShedColors): OpeningPart[] {
  switch (opening.type) {
    case 'roller_door':
      return rollerDoorParts(opening, u, colors);
    case 'pa_door':
      return paDoorParts(opening, u, colors);
    case 'sliding_door':
      return slidingDoorParts(opening, u, colors);
    case 'window':
      return windowParts(opening, u, colors);
    case 'opening':
      return [];
  }
}
