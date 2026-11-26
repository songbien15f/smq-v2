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
 * the shed. The cladding occupies `z ∈ [0, WALL_DEPTH]`, so `z = 0` is the outside face.
 *
 * ## Nothing fitted into a window or a PA door stands proud of the sheeting
 *
 * A client reading the model said the window and the PA door "vượt ra ngoài mặt sheeting cũng sai,
 * phải bằng mặt ngoài" — they must be flush with the outer face. That is now a rule with a test:
 * every part of a window or a PA door has its outer face at `z ≥ 0`. The frame and its trim ring sit
 * **inside the hole**, so they never overlap the sheeting and cannot z-fight with it.
 *
 * The one exception is the PA door's **leaf**, which is drawn swung open and therefore sweeps outside
 * `z = 0`. That is the leaf's own movement, not the frame standing off the wall.
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
/**
 * Face width of the trim ring around a window or a PA door, mm.
 *
 * One width on **all four** sides and for **both** openings, because a visitor reads a window as
 * framed or not framed at all: a flashing across the head and none at the sill reads as a mistake
 * (the client said so — "cái viền trim đỏ trên top mới có, ko có bottom"). 45 mm is wide enough to
 * read at 20 m and narrow enough that the glass is still the window.
 */
export const OPENING_TRIM_FACE = 45;
/**
 * How far the trim ring reaches into the wall, mm.
 *
 * It sits **inside the hole**, from the sheeting plane inwards, so it never laps the sheeting and
 * cannot z-fight with it. A trim that lapped the outside face would have to stand proud of it, which
 * is exactly what the client objected to.
 */
export const OPENING_TRIM_DEPTH = 25;
/**
 * Gap between anything fitted into a hole and the hole's own cut edges, mm.
 *
 * A frame whose side face lay exactly on the hole's inner face would share a plane with the extruded
 * cladding and flicker as the camera moved. 1.5 mm of clearance is invisible at 20 m and puts every
 * fitted face a hair inside the opening, where nothing can be coplanar.
 */
export const OPENING_CLEARANCE = 1.5;
/**
 * Gap between a fitted part and the sheeting plane it sits behind, mm.
 *
 * The trim ring's front face is **flush** with the sheeting at `z = 0`; the window frame behind it
 * starts 2 mm further in, so the ring's back face and the frame's front face never coincide.
 */
export const OPENING_STACK_GAP = 2;
/** PA door section, mm — the desktop's `PADOOR_COLUMN_THICK` is 30; the ring's 45 reads at 20 m. */
export const PA_FRAME = OPENING_TRIM_FACE;
/** Window frame section, mm. Twice `WINDOW_INSET`, so a frame matches the 2D inset. */
export const WINDOW_FRAME = WINDOW_INSET * 2;
/** How far a PA door leaf stands open, radians. */
export const PA_OPEN_ANGLE = (22 * Math.PI) / 180;
/** Thickness of a PA door's leaf, mm. */
export const PA_LEAF_THICK = 45;
/**
 * Thickness of a roller door's curtain, mm. 3D only — the 2D symbol's `ROLLER_DEPTH` is a plan depth
 * and is not this number.
 */
export const ROLLER_CURTAIN_THICK = 22;
/**
 * How far a roller door's curtain sits **behind** the front tangent of its drum, mm.
 *
 * The curtain unrolls off the front of the drum, so its front face belongs 1 mm behind that tangent —
 * close enough to read as hanging from it, far enough that the two never share a plane.
 */
export const ROLLER_CURTAIN_SETBACK = 1;
/** Gap between a curtain's front face and its slat ribs / bottom bar, mm. Sits in front, never on it. */
export const ROLLER_RIB_GAP = 2;
/** Depth of a roller door's guide rails into the shed, mm. */
export const ROLLER_GUIDE_DEPTH = 90;
/** How far a guide rail is sunk into the cladding, mm — keeps its back face off the inner plane. */
export const ROLLER_GUIDE_SINK = 10;
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
 * Roller door: a three-sided trim ring, curtain with slat ribs, two guides, drum, brackets, springs
 * and a bottom bar.
 *
 * ## Mounted on the **inside** face of the opening
 *
 * An Australian shed's roller door is fixed to the inner face of the reveal: the guides bolt on
 * inside, the curtain hangs from the front of the drum. So from the street a visitor sees a framed
 * opening, a curtain **set back** in it, and nothing at all standing off the sheeting.
 *
 * That is what this draws. An earlier version had the curtain at `z = −28`, the ribs at −48, the
 * guides reaching −80 and a 130 mm head box — a shutter bolted to the outside of the wall, measured
 * and recorded as a defect. Every part of the door is now at `z ≥ 0`, and the only piece on the
 * sheeting plane is the trim ring's front face, exactly like a window's and a PA door's.
 *
 * The head is no longer a separate box: the ring's own head closes the top of the reveal.
 *
 * ## Where each piece sits (mm, `z` into the shed; `WALL_DEPTH` is 50)
 *
 *   ring        0 … 25            head + two jambs, no sill — a car drives over it
 *   guides      40 … 130          sunk 10 mm into the cladding, hugging the curtain's edges
 *   curtain     79 … 101          front face 1 mm behind the drum's front tangent (80)
 *   ribs        67 … 77           2 mm in front of the curtain, never on it
 *   bottom bar  53 … 77
 *   drum        80 … 380          unchanged: inside the shed, above the head of the opening
 *   brackets    40 … 290          unchanged
 *
 * The desktop's `RDoor3D` draws the same set (`RDOOR_FRAME_THICK`, `ROLLER_RADIUS`,
 * `BRACKET_HEIGHT`). It also mounts the door outside; the rule that governs here is the one a person
 * can see in the model, so the door is inside.
 */
export function rollerDoorParts(opening: Opening, u: number, colors: ShedColors): OpeningPart[] {
  const w = opening.width;
  const h = opening.height;
  const cx = u + w / 2;
  const parts: OpeningPart[] = [];

  // The reveal: head and two jambs in the trim colour, the same section as every other opening.
  parts.push(...trimRing(u, 0, w, h, colors.barge, OPENING_TRIM_FACE, OPENING_TRIM_DEPTH, false));

  /*
   * The curtain hangs inside, its front face 1 mm behind the drum's front tangent. The drum sits at
   * `drumZ = WALL_DEPTH + 30 + ROLLER_DRUM_RADIUS`, so that tangent is `WALL_DEPTH + 30`.
   */
  const drumY = h + 250;
  const drumZ = WALL_DEPTH + 30 + ROLLER_DRUM_RADIUS;
  const curtainFront = drumZ - ROLLER_DRUM_RADIUS - ROLLER_CURTAIN_SETBACK;
  const curtainBack = curtainFront + ROLLER_CURTAIN_THICK;
  const curtainWidth = w - ROLLER_TRACK_WIDTH * 2;
  parts.push(
    box('curtain', [cx, h / 2, (curtainFront + curtainBack) / 2], [curtainWidth, h, ROLLER_CURTAIN_THICK], colors.rollerDoor, 'door'),
  );

  /*
   * Slat ribs and the bottom bar sit **in front of** the curtain, against it but 2 mm clear, so no
   * face of either coincides with a face of the curtain. Their own front faces stay inside the
   * shed (`z > WALL_DEPTH`).
   */
  const ribBack = curtainFront - ROLLER_RIB_GAP;
  const slats = Math.max(2, Math.round(h / ROLLER_SLAT_PITCH));
  const slatHeight = h / slats;
  for (let i = 1; i < slats; i += 1) {
    parts.push(
      box(
        `slat-${i}`,
        [cx, i * slatHeight, ribBack - 5],
        [curtainWidth, 22, 10],
        colors.barge,
        'metal',
      ),
    );
  }
  // Bottom bar: 24 mm deep, so it clears the inner face by 3 mm with its back on the same line.
  parts.push(
    box('bottom-bar', [cx, 35, ribBack - 12], [curtainWidth, 60, 24], colors.barge, 'metal'),
  );

  /*
   * Guide rails, inside the reveal, hugging the curtain's edges.
   *
   * Their back face is sunk `ROLLER_GUIDE_SINK` into the cladding so it never lands on `z =
   * WALL_DEPTH` (a coplanar pair flickers), and the whole rail sits well clear of the trim ring.
   */
  const guideBack = WALL_DEPTH - ROLLER_GUIDE_SINK;
  const guideZ = guideBack + ROLLER_GUIDE_DEPTH / 2;
  parts.push(
    box(
      'guide-left',
      [u + ROLLER_TRACK_WIDTH / 2, h / 2, guideZ],
      [ROLLER_TRACK_WIDTH, h, ROLLER_GUIDE_DEPTH],
      colors.barge,
      'trim',
    ),
    box(
      'guide-right',
      [u + w - ROLLER_TRACK_WIDTH / 2, h / 2, guideZ],
      [ROLLER_TRACK_WIDTH, h, ROLLER_GUIDE_DEPTH],
      colors.barge,
      'trim',
    ),
  );

  /*
   * Drum, brackets and springs — **inside** the shed, on the inner face of the wall above the
   * opening, as a roller door is actually hung. Unchanged by the round-3 fix; the drum clears the
   * inner face by 30 mm and each bracket reaches from the wall to past the drum's axis, its back face
   * sunk 10 mm into the wall so it is never coplanar with the inner cladding surface.
   */
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

  return parts;
}

/* ------------------------------------------------------------------ trim ring */

/**
 * A closed four-sided trim ring around a hole, in **barge** colour.
 *
 * ## Why four sides and not two
 *
 * The head and the sill used to be different objects — a head flashing wider than the frame and a
 * sill cover under it — so a window read as "framed on top, unframed below". A client described
 * exactly that: *"cái viền trim đỏ trên top mới có, ko có bottom"*. One section on all four sides
 * makes the window read as one object.
 *
 * ## Why the bars do not overlap
 *
 * Head and sill run the full width; the jambs fill the height **between** them. Two bars crossing at
 * a corner would put two front faces at exactly the same plane, and a coplanar pair flickers as the
 * camera moves — the "chớp chớp" this codebase has already been bitten by twice.
 *
 * ## Why it sits inside the hole
 *
 * The whole ring lies in `z ∈ [0, depth]`: its front face is the sheeting plane and it grows
 * *inward*. A ring that lapped the sheeting would have to stand proud of it, which is the thing the
 * client objected to. Inside the hole it covers no sheeting, so it cannot z-fight with it either.
 */
function trimRing(
  u: number,
  sill: number,
  width: number,
  height: number,
  color: string,
  face: number,
  depth: number,
  /**
   * Whether the ring closes its bottom edge.
   *
   * `false` for a roller door: a car drives over that threshold, and the building's base trim is cut
   * at this opening anyway, so a sill bar would be a painted line across the doorway. Every other
   * opening keeps the sill — one section on all four sides is the whole point of the ring.
   */
  withSill = true,
): OpeningPart[] {
  const z = depth / 2;
  // Inside the hole by a clearance all round, so no face lies on the hole's cut edge.
  const inset = OPENING_CLEARANCE;
  const innerW = width - inset * 2;
  const innerH = height - inset * 2;
  const x = u + inset;
  const y = sill + inset;
  /*
   * The jambs fill the height **between** the head and the sill — or, when there is no sill, everything
   * below the head down to the floor of the reveal.
   *
   * A four-sided ring's jambs stop one face short at each end. That is right for a window or a PA door,
   * where the sill is a bar the jamb butts against; it is wrong for a roller door, whose reveal runs to
   * the ground because a car drives over it. Using the four-sided arithmetic there left each jamb
   * 46.5 mm off the floor and exposed a notch of grey sheeting under it, exactly where the base trim
   * stops (round 3b review).
   */
  const jambHeight = Math.max(0, innerH - face * (withSill ? 2 : 1));
  const jambCentreY = withSill ? y + innerH / 2 : y + (innerH - face) / 2;
  const bars = [
    box('trim-head', [x + innerW / 2, y + innerH - face / 2, z], [innerW, face, depth], color, 'trim'),
  ];
  /*
   * The sill goes **second** when present, which is the order rounds 1–2 shipped. Part order is not
   * cosmetic: a renderer draws in list order, and keeping it means a window and a PA door come out of
   * this function byte-for-byte as they were (their snapshot test asserts it).
   */
  if (withSill) {
    bars.push(box('trim-sill', [x + innerW / 2, y + face / 2, z], [innerW, face, depth], color, 'trim'));
  }
  bars.push(
    box('trim-left', [x + face / 2, jambCentreY, z], [face, jambHeight, depth], color, 'trim'),
    box('trim-right', [x + innerW - face / 2, jambCentreY, z], [face, jambHeight, depth], color, 'trim'),
  );
  return bars;
}

/* ------------------------------------------------------------------ PA door */

/**
 * Personal access door: a four-sided trim frame, a leaf swung open, handle and hinges.
 *
 * ## Flush with the sheeting
 *
 * Every part of the door except the swinging leaf lies in `z ∈ [0, …]`, so nothing stands off the
 * outside face. The surround is `colors.barge` like every other piece of trim on the building; the
 * leaf keeps `colors.paDoor`, which is the door's own paint. Before this the whole frame was
 * `paDoor` and 70 mm proud of the wall.
 *
 * The leaf is drawn **open** on the `hinge` jamb and therefore sweeps outside `z = 0`. That is the
 * leaf's own movement, not the frame standing off the wall, and the flushness test allows for it.
 */
export function paDoorParts(opening: Opening, u: number, colors: ShedColors): OpeningPart[] {
  const w = opening.width;
  const h = opening.height;
  const hingedRight = opening.hinge === 'right';
  const parts: OpeningPart[] = [];

  // The surround, closed on all four sides: two stiles, a head and a threshold at the floor.
  parts.push(...trimRing(u, 0, w, h, colors.barge, PA_FRAME, OPENING_TRIM_DEPTH));

  /*
   * The leaf fills the ring's opening, a clearance inside it — not the whole hole, or it would pass
   * through its own surround.
   */
  const jamb = PA_FRAME + OPENING_CLEARANCE;
  const leafWidth = Math.max(0, w - jamb * 2);
  const leafHeight = Math.max(0, h - jamb * 2);
  const angle = PA_OPEN_ANGLE;
  const hingeX = hingedRight ? u + w - jamb : u + jamb;
  // A leaf hinged on the right opens the other way, so its sweep is mirrored.
  const swing = hingedRight ? -1 : 1;

  /*
   * The hinge axis sits on the outside face, so a closed leaf would fill the reveal from `z = 0` to
   * `z = PA_LEAF_THICK`. Swinging it about that axis moves the free edge out (`z < 0`) and leaves the
   * hinge edge exactly where the frame is — which is what stops the leaf drifting out of its own hole.
   */
  const zHinge = PA_LEAF_THICK / 2;
  const leafCentreX = hingeX + swing * (leafWidth / 2) * Math.cos(angle);
  const leafCentreZ = zHinge - (leafWidth / 2) * Math.sin(angle);

  parts.push(
    box(
      'leaf',
      [leafCentreX, jamb + leafHeight / 2, leafCentreZ],
      [leafWidth, leafHeight, PA_LEAF_THICK],
      colors.paDoor,
      'door',
      [0, swing * angle, 0],
    ),
  );

  /*
   * Handle near the free edge, at the same rotation as the leaf, on its outside face.
   *
   * Named `leaf-handle` rather than `handle` so the flushness rule can except the **leaf assembly**
   * with one prefix: a handle is bolted to the leaf, and a leaf swung open carries it outside the
   * wall. Anything not named `leaf*` must stay behind the sheeting plane.
   */
  const handleAt = 0.88;
  parts.push(
    box(
      'leaf-handle',
      [
        hingeX + swing * leafWidth * handleAt * Math.cos(angle),
        jamb + leafHeight * 0.48,
        zHinge - leafWidth * handleAt * Math.sin(angle) - PA_LEAF_THICK / 2 - 14,
      ],
      [150, 28, 28],
      colors.barge,
      'metal',
      [0, swing * angle, 0],
    ),
  );

  // Three hinges on the hinge stile, inside the reveal so no barrel stands off the wall.
  for (const at of [0.18, 0.5, 0.82]) {
    parts.push(
      box(
        `hinge-${at}`,
        [hingeX + swing * 10, jamb + leafHeight * at, 22],
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
 * Window: a four-sided trim ring, a set-back frame, glass, and one mullion above 900 mm.
 *
 * ## Flush with the sheeting
 *
 * Every part lies in `z ∈ [0, …]`. The ring is the outermost thing the visitor sees, its front face
 * on the sheeting plane; the frame sits behind it inside the hole; the glass sits behind the frame.
 * Nothing stands off the wall — the client's "phải bằng mặt ngoài".
 *
 * ## Why four separate frame bars
 *
 * A single box larger than the hole reads as a solid rectangle — which is what the editor drew for a
 * while — because nothing is left open for glass. The bars of the ring and the frame are each sized to
 * their own edge, and the jambs stop short of the head and sill bars, so no two front faces share a
 * plane.
 *
 * ## Colours
 *
 * The **ring** is `colors.barge`, the same trim colour as the ridge, the barge and the base. The
 * window's own frame inside it stays `colors.window` — the book prices a window frame separately from
 * the flashing, and one colour for every piece of trim is what the client asked for.
 */
export function windowParts(opening: Opening, u: number, colors: ShedColors): OpeningPart[] {
  const w = opening.width;
  const h = opening.height;
  const sill = opening.sill;
  const parts: OpeningPart[] = [];

  /*
   * Depths, measured from the sheeting plane and growing inward.
   *
   *   ring       z ∈ [0, 25]          front face on the sheeting plane
   *   frame      z ∈ [27, 87]         behind the ring, still inside the 90 mm hole depth
   *   glass      z ∈ [70, 80]         inside the frame, visible through it
   *
   * The hole is `WINDOW_DEPTH` (90 mm) deep, so the frame's back face lands 3 mm inside the reveal —
   * never on it. The 2 mm between ring and frame is `OPENING_STACK_GAP`.
   */
  const frameDepth = 60;
  const frameFront = OPENING_TRIM_DEPTH + OPENING_STACK_GAP;
  const frameZ = frameFront + frameDepth / 2;

  /*
   * The frame sits inside the ring's opening, a clearance in from it, so no frame face shares a plane
   * with a ring face either.
   */
  const clearance = OPENING_CLEARANCE;
  const frameInset = clearance + OPENING_TRIM_FACE + clearance;
  const frameW = w - frameInset * 2;
  const frameH = h - frameInset * 2;
  const fx = u + frameInset;
  const fy = sill + frameInset;

  parts.push({
    kind: 'glass',
    shape: 'box',
    position: [u + w / 2, sill + h / 2, 75],
    size: [Math.max(0, frameW - WINDOW_FRAME * 2), Math.max(0, frameH - WINDOW_FRAME * 2), 10],
    color: GLASS_COLOR,
    finish: 'glass',
    opacity: 0.34,
  });

  parts.push(
    box('frame-left', [fx + WINDOW_FRAME / 2, sill + h / 2, frameZ], [WINDOW_FRAME, frameH, frameDepth], colors.window, 'trim'),
    box('frame-right', [fx + frameW - WINDOW_FRAME / 2, sill + h / 2, frameZ], [WINDOW_FRAME, frameH, frameDepth], colors.window, 'trim'),
    box('frame-head', [fx + frameW / 2, fy + frameH - WINDOW_FRAME / 2, frameZ], [frameW, WINDOW_FRAME, frameDepth], colors.window, 'trim'),
    box('frame-sill', [fx + frameW / 2, fy + WINDOW_FRAME / 2, frameZ], [frameW, WINDOW_FRAME, frameDepth], colors.window, 'trim'),
  );

  // One centre mullion on a wide window, as the desktop's `Window3D` draws.
  if (w > 900) {
    parts.push(
      box('mullion', [u + w / 2, sill + h / 2, frameZ], [46, Math.max(0, frameH - WINDOW_FRAME * 2), frameDepth], colors.window, 'trim'),
    );
  }

  /*
   * The trim ring is the last thing pushed so a renderer that draws in order puts it in front of the
   * frame, and so does a reader of the part list.
   */
  parts.push(...trimRing(u, sill, w, h, colors.barge, OPENING_TRIM_FACE, OPENING_TRIM_DEPTH));

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
