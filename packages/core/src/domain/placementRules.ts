/**
 * Placement rules: may this door go on this wall, and if not, what would work.
 *
 * The desktop refuses a placement in one of three ways — it fits, it does not fit but
 * a small change would make it fit ("POSSIBLE ACTION: GO WITH …"), or it cannot be
 * made to fit at all. That third answer is a sentence naming what is in the way, never
 * a silent no-op.
 *
 * ## What this module can and cannot see
 *
 * It works on the plan model this build has: walls with a run in millimetres, and
 * openings with a width, a height and an offset along their wall.
 *
 * Two of the three rules that once needed a model have one now:
 *
 * - **gable infill columns (R3/R5)** — `infillOverrideRefusal()` takes the infill
 *   positions the caller computed (`infillPositions`), because a door landing on a post
 *   is a refusal a wall run alone cannot express.
 * - **the roof-sheet grid (R12)** — `skylightSnap.ts` owns the sheet layout, so the rule
 *   reads it there instead of guessing a pitch.
 *
 * What is still absent is **track segment lengths (R11)**: a sliding door's track is not
 * an object in this model, so a rule about how it is cut has nothing to look at. It stays
 * a recorded gap rather than an approximation — a rule that guesses is worse than a rule
 * that is absent, because the operator cannot tell which one refused their door.
 *
 * Pure TypeScript: no React, Next.js, Zustand, Konva, or three.
 */

import type { Opening, ShedConfig, WallSide } from './types';
import { nearestWall, planPointToWallU } from './placement';

/** Clearance from either end of a wall, mm. The desktop's own figure. */
const WALL_MARGIN = 100;
/** A roller door below this size is not a catalogue item the factory supplies. */
const ROLLER_MIN_HEIGHT = 2000;
const ROLLER_MIN_WIDTH = 1000;
/** A carry beam is not offered on a building wider than this, mm. */
const CARRY_BEAM_MAX_RUN = 15000;
/** A sliding door's track segment, mm. The desktop's R11 bound. */
const TRACK_MIN_WIDTH = 1000;
const TRACK_MAX_WIDTH = 6000;
/**
 * The widest gable whose infill columns a door may displace, mm.
 *
 * The desktop's `AddingRuleDoor.AllowOverrideInfill` — `Wall.Plan.Width <= 4000`. On a
 * wider gable the infill columns are carrying the sheeting, and a door may not simply
 * take one out: the factory re-spaces them instead, which is a rule this build cannot
 * apply (see `infill.ts`). So the door is refused with that sentence rather than placed
 * over a column the quote still charges for.
 */
const INFILL_OVERRIDE_MAX_SPAN = 4000;
/**
 * The gap a door keeps from a neighbour, mm — the desktop's `SpaceBetween2OtherDoor`.
 *
 * That figure is `2 × (infillColumnWidth + sideRoomOtherDoor)` rounded up to 50, so it
 * varies with the section; 250 mm is the shipped book's value for the common case
 * (a 65 mm infill and a 60 mm side room). It is used here only to decide whether a
 * column counts as **displaced** — a jamb 100 mm from a column is not really clear of
 * it — so being a little generous is the safe direction: it refuses rather than places.
 */
const DOOR_SPACING_MM = 250;

/** One suggestion that would make the placement legal. */
export interface OpeningProposal {
  /** The sentence a menu shows, e.g. `GO WITH 1300 mm from the left corner`. */
  label: string;
  opening: Opening;
}

/** The three answers a placement can have. */
export type OpeningPlacement =
  | { ok: true; opening: Opening }
  | { ok: false; reason: string }
  | { ok: false; proposals: OpeningProposal[] };

/** The run of `wall` in millimetres. */
function wallRun(shed: ShedConfig, wall: WallSide): number {
  return wall === 'front' || wall === 'back' ? shed.span : shed.length;
}

/** The wall-local offset an alignment resolves to, clamped onto the wall. */
function offsetFor(opening: Opening, run: number): number {
  const max = Math.max(0, run - opening.width);
  switch (opening.align) {
    case 'left':
      return 0;
    case 'right':
      return max;
    case 'custom':
      return Math.min(Math.max(opening.offset ?? 0, 0), max);
    case 'center':
    default:
      return max / 2;
  }
}

/** A copy of `opening` pinned to an explicit offset. */
function atOffset(opening: Opening, offset: number): Opening {
  return { ...opening, align: 'custom', offset: Math.round(offset) };
}

/** The half-open interval `[u, u + width)`. */
function interval(u: number, width: number): [number, number] {
  return [u, u + width];
}

/** True when two wall intervals share any millimetre. */
function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

/**
 * Decide whether `request` can be placed on its wall, and what would fix it.
 *
 * Order is deliberate: a size the catalogue cannot supply is answered before a
 * position, because resizing changes whether the position is even legal.
 */
export function placeOpening(
  request: Opening,
  shed: ShedConfig,
  options: {
    /**
     * Where the gable's infill columns stand, mm along the span.
     *
     * Supplied by the caller that can read the price book. Omitted means R3 is not
     * applied — which is right for a caller with no book, and wrong for one that has
     * it: a door over a column is not a door the factory builds.
     */
    infillPositionsMm?: readonly number[];
  } = {},
): OpeningPlacement {
  const run = wallRun(shed, request.wall);

  // R10 — a roller door has a catalogue minimum. Offer the smallest legal size.
  if (
    request.type === 'roller_door' &&
    (request.height < ROLLER_MIN_HEIGHT || request.width < ROLLER_MIN_WIDTH)
  ) {
    const width = Math.max(request.width, ROLLER_MIN_WIDTH);
    const height = Math.max(request.height, ROLLER_MIN_HEIGHT);
    if (width <= run - 2 * WALL_MARGIN) {
      return {
        ok: false,
        proposals: [
          { label: `GO WITH ${width} × ${height} mm`, opening: { ...request, width, height } },
        ],
      };
    }
    return {
      ok: false,
      reason: `A roller door needs at least ${ROLLER_MIN_WIDTH} × ${ROLLER_MIN_HEIGHT} mm, which does not fit this ${run} mm wall.`,
    };
  }

  if (request.width > run - 2 * WALL_MARGIN) {
    return {
      ok: false,
      reason: `This opening is ${request.width} mm wide, wider than the ${run} mm wall allows with a ${WALL_MARGIN} mm margin at each end.`,
    };
  }

  // R11 — a track segment outside 1000–6000 mm is not a track the factory sells.
  if (request.type === 'sliding_door' && request.trackWidth !== undefined) {
    const clamped = Math.round(Math.min(Math.max(request.trackWidth, TRACK_MIN_WIDTH), TRACK_MAX_WIDTH));
    if (clamped !== Math.round(request.trackWidth)) {
      return {
        ok: false,
        proposals: [
          {
            label: `GO WITH ${clamped} mm per track segment`,
            opening: { ...request, trackWidth: clamped },
          },
        ],
      };
    }
  }

  // R3 — a gable-end door may only displace an infill column on a narrow building.
  // Checked before the position rules, because a position the door fits at is still a
  // position the factory will not build. The positions come from the price book, so a
  // caller that cannot read one (`placeOpening` on its own) passes none and R3 does
  // not apply; `addOpening` in the store, which does have them, passes them through.
  if (options.infillPositionsMm !== undefined) {
    const infillRefusal = infillOverrideRefusal(
      shed,
      request.wall,
      options.infillPositionsMm,
      offsetFor(request, run),
      request.width,
    );
    if (infillRefusal !== null) return { ok: false, reason: infillRefusal };
  }

  const u = offsetFor(request, run);

  // R1 — 100 mm clear at both ends.
  if (u < WALL_MARGIN || u + request.width > run - WALL_MARGIN) {
    const clamped = Math.min(Math.max(u, WALL_MARGIN), run - WALL_MARGIN - request.width);
    if (clamped >= WALL_MARGIN && clamped + request.width <= run - WALL_MARGIN) {
      return {
        ok: false,
        proposals: [
          {
            label: `GO WITH ${Math.round(clamped)} mm from the left corner`,
            opening: atOffset(request, clamped),
          },
        ],
      };
    }
    return {
      ok: false,
      reason: `The opening does not fit on this wall with a ${WALL_MARGIN} mm margin at each end.`,
    };
  }

  // R2 — no overlap with another opening on the same wall.
  const candidate = interval(u, request.width);
  const blockers = shed.openings
    .filter((other) => other.wall === request.wall && other.id !== request.id)
    .map((other) => ({ other, span: interval(offsetFor(other, run), other.width) }))
    .filter((entry) => overlaps(candidate, entry.span));

  if (blockers.length > 0) {
    const proposals: OpeningProposal[] = [];
    for (const blocker of blockers) {
      const left = blocker.span[0] - request.width;
      const right = blocker.span[1];
      if (left >= WALL_MARGIN) {
        proposals.push({
          label: `GO WITH ${Math.round(left)} mm from the left corner`,
          opening: atOffset(request, left),
        });
      }
      if (right + request.width <= run - WALL_MARGIN) {
        proposals.push({
          label: `GO WITH ${Math.round(right)} mm from the left corner`,
          opening: atOffset(request, right),
        });
      }
    }
    if (proposals.length > 0) return { ok: false, proposals };
    return { ok: false, reason: 'There is no room beside the opening already on this wall.' };
  }

  return { ok: true, opening: atOffset(request, u) };
}

/** Where a pointer on the plan would put an opening, and whether that works there. */
export interface OpeningAtPoint {
  wall: WallSide;
  /**
   * The opening as the pointer places it — centred on the point, before any rule moves it.
   *
   * Carried so the overlay can draw the **ghost** where the pointer is, and the accepted or
   * suggested position as a second marker. Without it a caller would have to rebuild the
   * candidate to draw it, and a rebuild is where the picture and the write drift apart.
   */
  candidate: Opening;
  outcome: OpeningPlacement;
}

/**
 * What an add-mode click needs to know about the opening being placed.
 *
 * `swing` and `track` are optional because they do not affect whether the door **fits** —
 * they describe how it opens — so a caller placing a door from a click should not have to
 * invent them. They default to `null`, which is what the store's own default opening uses.
 */
export type OpeningRequest = Omit<Opening, 'id' | 'wall' | 'align' | 'offset' | 'swing' | 'track'> &
  Partial<Pick<Opening, 'swing' | 'track'>>;

/**
 * The placement a click at `point` would produce.
 *
 * This is the whole of the add-mode overlay's decision, kept pure so it can be tested
 * without a canvas: the nearest wall wins, the pointer becomes the centre of the
 * opening, and the ordinary rules decide whether that lands and what to suggest instead.
 * The renderer only has to colour the answer; it makes no decision of its own.
 */
export function openingAtPoint(
  shed: ShedConfig,
  request: OpeningRequest,
  point: { x: number; y: number },
): OpeningAtPoint {
  const wall = nearestWall(shed, point);
  const u = planPointToWallU(shed, wall, point);
  const candidate: Opening = {
    swing: null,
    track: null,
    ...request,
    id: 'preview',
    wall,
    align: 'custom',
    // Centre the opening on the pointer, in wall-local millimetres.
    offset: Math.round(u - request.width / 2),
  };
  return { wall, candidate, outcome: placeOpening(candidate, shed) };
}

/** R7 — a carry beam is not offered above this span. */
export function carryBeamRefusal(shed: ShedConfig): string | null {
  if (shed.span > CARRY_BEAM_MAX_RUN) {
    return `A carry beam is not available on a building wider than ${CARRY_BEAM_MAX_RUN} mm (this one is ${shed.span} mm).`;
  }
  return null;
}

/**
 * R3 — may this opening displace an infill column in a gable end?
 *
 * An infill column stands in the gable to carry the sheeting, and a door placed over
 * one either takes it out or makes the factory re-space the run. The desktop allows
 * that only on a gable up to 4 m wide (`AddingRuleDoor.AllowOverrideInfill`); wider
 * than that the columns are doing real work and the door is refused.
 *
 * **`positionsMm` is required, and that is the point of the signature.** The desktop's
 * check is not "is this a gable" — it is `OverrideAnyInfillColumn`: does the door's
 * rectangle, widened by half the required spacing, contain a column? A door on a 12 m
 * gable that sits between two columns is perfectly legal, so a rule that refuses by
 * wall alone would ban ordinary gable doors. The positions come from the price book
 * (`no_M/EW` and `M1` in the structure table) via `infillPositions`, so they are not
 * available to this module — the caller supplies them.
 *
 * `null` means the placement is allowed. A sentence explains a refusal.
 */
export function infillOverrideRefusal(
  shed: ShedConfig,
  wall: WallSide,
  positionsMm: readonly number[],
  openingLeftMm: number,
  openingWidthMm: number,
): string | null {
  // Only a gable end has infill columns; a long wall has none.
  if (wall !== 'front' && wall !== 'back') return null;
  if (positionsMm.length === 0) return null;
  // The desktop widens the door by half the spacing it wants between two doors, so a
  // column that would end up hard against the jamb counts as displaced.
  const clearance = DOOR_SPACING_MM / 2;
  const from = openingLeftMm - clearance;
  const to = openingLeftMm + openingWidthMm + clearance;
  const displaced = positionsMm.some((position) => position > from && position < to);
  if (!displaced) return null;
  if (shed.span <= INFILL_OVERRIDE_MAX_SPAN) return null;
  return `This door would displace an infill column in the gable end, and that is only allowed on a building up to ${INFILL_OVERRIDE_MAX_SPAN} mm wide. This one is ${shed.span} mm, so the column has to stay where the design put it.`;
}

/**
 * Remove an opening, and clear any carry beam that claimed to span it.
 *
 * A beam whose pointer is left dangling would draw as spanning a door that is no
 * longer there; clearing the pointer keeps the beam and drops the false claim.
 */
export function removeOpeningWithCascade(id: string, shed: ShedConfig): ShedConfig {
  return {
    ...shed,
    openings: shed.openings.filter((opening) => opening.id !== id),
    options: shed.options.map((option) =>
      option.kind === 'carry_beam' && option.openingId === id
        ? { ...option, openingId: null }
        : option,
    ),
  };
}

/** Remove one option. */
export function removeOptionWithCascade(id: string, shed: ShedConfig): ShedConfig {
  return { ...shed, options: shed.options.filter((option) => option.id !== id) };
}

/**
 * Drop every option, keeping the openings and the charges.
 *
 * This mirrors the desktop's wipe when a structural dimension changes: the options
 * were placed against a building that no longer exists. Openings are not part of the
 * wipe because the desktop keeps them; charges are commercial and unrelated.
 */
export function wipeOptions(shed: ShedConfig): ShedConfig {
  return { ...shed, options: [] };
}

/**
 * True when a dimension change invalidates every placed option.
 *
 * The caller asks this **before** applying the change, so it can show the desktop's
 * confirmation. Wiping without asking would silently delete work; asking on every
 * keystroke would be noise, which is why the comparison is against the previous
 * committed config rather than the field being typed.
 */
export function shouldWipeOptions(before: ShedConfig, after: ShedConfig): boolean {
  if (before.options.length === 0) return false;
  return (
    before.span !== after.span ||
    before.height !== after.height ||
    before.roofPitchDeg !== after.roofPitchDeg ||
    before.bays !== after.bays
  );
}
