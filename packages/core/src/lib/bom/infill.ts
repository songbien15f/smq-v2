/**
 * The infill columns on a gable end: how many, where, and how long.
 *
 * ## What an infill column is
 *
 * A gable end is a triangle, and its wall sheeting has to be carried. Two end
 * columns alone can hold it on a narrow building; on a wide one the girt would sag
 * between them, so the factory stands extra columns in between. Those are the
 * **infill columns**, and the price book states how many and in what section
 * (`no_M/EW`, `M1`, `M2` in the structure table — see `FrameSchedule.infill`).
 *
 * ## Why this was missing
 *
 * The BOM priced `End wall column` from `endMemberCount()` and nothing else, so a
 * 12 m gable with two infill columns per end was quoted **two columns short per
 * end wall** — four columns on the building. The steel is not optional: it is what
 * carries the sheeting the quote already charges for.
 *
 * ## What is ported, and what is not
 *
 * `positionsFor()` is the desktop's `arrayInfillPosition`: the columns are spread
 * evenly across the span and pushed in by half the frame's depth so the flanges do
 * not clash at the corners. `lengthFor()` is its length formula — the column runs
 * from the eave up the pitch to the ridge and down again, so a column further from
 * the corner is shorter.
 *
 * **Not ported: the sliding-door / roller-door re-spacing** (`computeInfillPosition`
 * and `checkRDoorColumnQuantity`). Those rules move or drop columns around a door in
 * the gable end, and they read a door model this build has as an opening on a wall —
 * not as a positioned `RDoor` with a `Style` and a `RelativeLocation`. Guessing that
 * mapping would move a column the factory put somewhere for a reason. So a gable end
 * with a roller door in it gets no infill columns from this function, and says so.
 *
 * Pure TypeScript: no DB, no HTTP, no framework.
 */

import type { ShedConfig, DimensionedShed } from '@/domain/types';

/** One infill column, in plan millimetres along the gable end. */
export interface InfillColumn {
  /** Which end wall it stands on. */
  end: 'front' | 'back';
  /** Distance from the wall's left corner as seen from outside, mm. */
  positionMm: number;
  /** Cut length, mm. */
  lengthMm: number;
}

/** The parts of the frame the infill geometry needs. */
export interface InfillGeometry {
  /** The design's infill count per end wall, from the book. Null when it names none. */
  count: number | null;
  /** The infill section, from the book. */
  section: string | null;
  /** An end-wall column's depth, mm — the infill is set in by half of it. */
  endColumnDepth: number | null;
  /** The eave purlin's depth, mm — the other half of the setback. */
  purlinDepth: number | null;
  /** The punch centre for the end column's web, mm. */
  centreMm: number;
  /** The knee-edge hole offset, mm. */
  kneeEdgeCode: number | null;
  /** The footing allowance, mm. */
  footingAllowanceMm: number;
  /** True when the columns are cast in the ground and take the allowance. */
  postInGround: boolean;
}

/**
 * Where the infill columns stand, in mm along the span.
 *
 * The desktop's `arrayInfillPosition(span, ewc, decrement)`:
 *
 * ```
 * step = (span − 2 × decrement) / (count + 1)
 * ```
 *
 * and then, counting inward from both corners, positions are added in mirrored
 * pairs until the pair meets at the middle — where a single column takes the ridge
 * rather than two overprinting each other. The `decrement` is half the frame's
 * depth, so the outermost columns clear the corner columns' flanges.
 *
 * **`span < 3000` gives no interior positions.** That is the desktop's own guard,
 * and the spec's R3 threshold says the same thing from the other side: a gable that
 * narrow is carried by its two corner columns.
 */
export function infillPositions(span: number, count: number, decrement: number): number[] {
  const positions: number[] = [];
  if (!Number.isFinite(span) || span < 3000 || count <= 0) return positions;

  const step = (span - 2 * decrement) / (count + 1);
  let pairs = count;

  for (let index = 1; index < count + 1; index++) {
    if (index === pairs) {
      // The pair has met: one column on the centreline, not two on top of each other.
      positions.push(span / 2);
    }
    if (index !== count && index !== pairs && index <= pairs) {
      positions.push(step * index + decrement);
      positions.push(span - step * index - decrement);
      pairs -= 1;
    } else {
      break;
    }
  }

  // Whole millimetres, in plan order, with no duplicates: two positions rounding to
  // the same millimetre would price one column and build one column.
  return [...new Set(positions.map((value) => Math.round(value)))].sort((a, b) => a - b);
}

/**
 * How long an infill column is cut, mm.
 *
 * The desktop's formula:
 *
 * ```
 * length = (height − kneeEdge) + (x − decrement) × tan(pitch) + 35 + footing
 * ```
 *
 * where `x` is the position's distance from the **nearer** corner — the column
 * stops at the roof line, which rises toward the ridge, so a column further out is
 * shorter. The `35` is the desktop's own allowance for the roof frame it meets.
 */
export function infillLength(
  shed: DimensionedShed,
  positionMm: number,
  geometry: Pick<InfillGeometry, 'kneeEdgeCode' | 'footingAllowanceMm' | 'postInGround'>,
  decrement: number,
): number {
  const toRidge = Math.min(positionMm, shed.span - positionMm);
  const kneeEdge = geometry.kneeEdgeCode ?? 0;
  const footing = geometry.postInGround ? geometry.footingAllowanceMm : 0;
  const rise = (toRidge - decrement) * Math.tan((shed.roofPitchDeg * Math.PI) / 180);
  return Math.round(shed.height - kneeEdge + rise + 35 + footing);
}

/**
 * The half-depth setback that keeps an infill clear of the corner columns.
 *
 * The desktop: `(2 × endPurlinDepth + endColumnDepth − centre) / 2`, where `centre`
 * is the punch centre for the column's web. Truncated rather than rounded, matching
 * the desktop's integer division — a millimetre of clash is a millimetre of clash.
 */
export function infillSetback(geometry: InfillGeometry): number {
  const purlinDepth = geometry.purlinDepth ?? 0;
  const columnDepth = geometry.endColumnDepth ?? 0;
  return Math.trunc((2 * purlinDepth + columnDepth - geometry.centreMm) / 2);
}

/**
 * Re-space the infill columns around a roller door in the gable end.
 *
 * This is the ordinary branch of the desktop's `computeInfillPosition`
 * (`BOMQuoteUtil.cs:569-637`), which is the rule R5 names: a column the door would
 * cut through is **removed**, **moved to one side**, or **split into two** — decided
 * by how much clear wall is left either side of the door.
 *
 * | Clear each side | What happens |
 * |---|---|
 * | both ≤ 500 mm | the column is **removed** — there is no useful run to hold it |
 * | both > 500 mm | it becomes **two columns**, 250 mm clear of each jamb |
 * | one side > 500 mm | it **moves** to that side, 250 mm clear of the jamb |
 *
 * The `500` and `250` are the desktop's own numbers. `curtain` is the door's curtain
 * allowance — 50 mm for a style-A roller, 100 mm for anything else
 * (`RDoor.GetCurtain`) — and half of it is added to the clear run, because the
 * curtain rolls into the reveal.
 *
 * **Not ported: the special cases above it.** The desktop also has bespoke rules for
 * one or two exactly-sized doors on a gable under 6–7.5 m, which read
 * `rollerDoorDevided` and compare door widths to the span to the millimetre. Those
 * are for the factory's standard door layouts; the branch here produces a buildable
 * wall for any door, which is what a rule engine owes an operator who places one
 * anywhere.
 */
export function respaceAroundDoors(
  positions: number[],
  doors: readonly { leftMm: number; widthMm: number; curtainMm: number }[],
  spanMm?: number,
): number[] {
  let result = [...positions].sort((a, b) => a - b);

  for (const door of doors) {
    const half = door.curtainMm / 2;
    const doorRight = door.leftMm + door.widthMm;

    // Walk a copy so removing from `result` mid-loop cannot skip a position.
    for (const position of [...result]) {
      if (position < door.leftMm || position > doorRight) continue;

      /*
       * A corner column is not re-spaced, whichever list it happens to sit in.
       *
       * This used to test the array index (`index <= 0 || index >= length - 1`), copied
       * from the desktop where the list **includes** both corners. `infillPositions`
       * returns interior positions only, so the first and last of *its* list are ordinary
       * columns — and the index test silently exempted them from every door. A 2 400 mm
       * door over the first infill column left that column standing inside the opening.
       */
      const isCorner = spanMm !== undefined && (position <= 0 || position >= spanMm);
      if (isCorner) continue;

      const index = result.indexOf(position);
      if (index === -1) continue;

      const previous = result[index - 1];
      const next = result[index + 1];
      // A neighbour missing at either end means the corner column, so the clear run is
      // measured to the wall's edge.
      const gapLeft = door.leftMm - (previous ?? 0) + half;
      const gapRight = (next ?? (spanMm ?? doorRight)) - doorRight + half;

      if (gapLeft <= CLEAR_ENOUGH_MM && gapRight <= CLEAR_ENOUGH_MM) {
        // No usable run on either side: the column goes.
        result.splice(index, 1);
        continue;
      }

      if (gapLeft > CLEAR_ENOUGH_MM && gapRight > CLEAR_ENOUGH_MM) {
        // Room both sides: two columns, each a door-clearance off its jamb.
        result.splice(
          index,
          1,
          Math.round(door.leftMm - DOOR_CLEARANCE_MM + half),
          Math.round(doorRight + DOOR_CLEARANCE_MM - half),
        );
        continue;
      }

      // Room on one side only: move it there.
      result[index] = Math.round(
        gapRight > CLEAR_ENOUGH_MM
          ? doorRight + DOOR_CLEARANCE_MM - half
          : door.leftMm - DOOR_CLEARANCE_MM + half,
      );
    }

    result = [...new Set(result)].sort((a, b) => a - b);
  }

  return result;
}

/**
 * The widest gable whose infill columns the factory re-spaces around a door, mm.
 *
 * The desktop's `AddingRuleDoor.AllowOverrideInfill`. Wider than this, the columns are
 * carrying the sheeting and the door is refused rather than accommodated — the two
 * answers are mutually exclusive, and mixing them reports a blocker and an assumption
 * for the same door.
 */
const INFILL_RESPACE_MAX_SPAN = 4000;

/** Clear wall below this either side of a door is not worth a column, mm. */
const CLEAR_ENOUGH_MM = 500;
/** How far a moved column stands off the jamb, mm. */
const DOOR_CLEARANCE_MM = 250;

/** The result of building the infill columns for a shed. */
export interface InfillColumns {
  columns: InfillColumn[];
  /**
   * The positions the **design** put the columns at, before any door moved them.
   *
   * Kept so a caller can tell an untouched gable from one whose steel has been
   * re-spaced. A moved column is still a column, but the wall is no longer the wall the
   * book drew — and the reader of a quote is owed that fact.
   */
  designPositionsMm: number[];
  /** Which ends had their columns moved, because a door stood where one belonged. */
  respacedEnds: ('front' | 'back')[];
  /**
   * Why there are none, when a caller might reasonably have expected some.
   *
   * `null` when the building genuinely has none — a narrow span, or a design the book
   * says needs no infill. A sentence when a rule withheld them, so a panel can say
   * which it is instead of showing an empty list.
   */
  withheld: string | null;
}

/**
 * The infill columns for both gable ends.
 *
 * A gable end that is **left open** gets none: there is no wall for a column to
 * carry. That is the desktop's `if (!endwall.IsOpen)` check, and it is why
 * `endOpening` matters here.
 *
 * A gable end with a **roller door** in it has its columns re-spaced around the door
 * (`respaceAroundDoors`, which is R5). A gable end with any *other* opening keeps the
 * plain layout: a window or a PA door is small enough that the column either misses it
 * or is where the design put it, and the desktop's re-spacing branch only looks at
 * roller doors.
 */
export function buildInfillColumns(shed: DimensionedShed, geometry: InfillGeometry): InfillColumns {
  if (geometry.count === null || geometry.section === null || geometry.count <= 0) {
    return { columns: [], designPositionsMm: [], respacedEnds: [], withheld: null };
  }

  const decrement = infillSetback(geometry);
  const basePositions = infillPositions(shed.span, geometry.count, decrement);
  if (basePositions.length === 0) {
    return { columns: [], designPositionsMm: [], respacedEnds: [], withheld: null };
  }

  const ends: { end: 'front' | 'back'; wall: 'front' | 'back'; open: boolean }[] = [
    { end: 'front', wall: 'front', open: shed.endOpening.left },
    { end: 'back', wall: 'back', open: shed.endOpening.right },
  ];

  const columns: InfillColumn[] = [];
  const respacedEnds: ('front' | 'back')[] = [];
  for (const { end, wall, open } of ends) {
    if (open) continue;

    /*
     * **The re-spacing is only for a gable the factory will re-space.**
     *
     * The desktop's editor refuses a door over an infill column on a building wider
     * than 4 000 mm (`AddingRuleDoor.AllowOverrideInfill`) — it does *not* move the
     * column, because a wide gable's columns are carrying the sheeting. Doing both
     * here would report a blocker and an assumption for one door, which tells the
     * reader two contradictory things.
     *
     * So: a narrow gable gets its columns moved, and is *indicative* because the steel
     * is no longer where the drawing shows it. A wide gable keeps the design's columns,
     * and `build.ts` raises a blocker against the door.
     */
    const respace = shed.span <= INFILL_RESPACE_MAX_SPAN;
    const doors = respace
      ? shed.openings
          .filter((opening) => opening.wall === wall && opening.type === 'roller_door')
          .map((opening) => ({
            leftMm: openingPosition(shed, opening),
            widthMm: opening.width,
            // The desktop's `RDoor.GetCurtain`: 50 for style A, 100 for anything else.
            curtainMm: opening.series === 'A' ? 50 : 100,
          }))
      : [];

    const positions =
      doors.length === 0 ? basePositions : respaceAroundDoors(basePositions, doors, shed.span);
    if (doors.length > 0 && positions.join(',') !== basePositions.join(',')) {
      respacedEnds.push(end);
    }

    for (const positionMm of positions) {
      // Re-spacing can move a column onto the very edge; a column at mm 0 is not a
      // column, it is the corner one that is already there.
      if (positionMm <= 0 || positionMm >= shed.span) continue;
      columns.push({
        end,
        positionMm,
        lengthMm: infillLength(shed, positionMm, geometry, decrement),
      });
    }
  }

  return { columns, designPositionsMm: basePositions, respacedEnds, withheld: null };
}

/**
 * Where an opening starts along its wall, mm from the left corner seen from outside.
 *
 * The opening's own offset, resolved from its alignment — the same rule the plan
 * draws with, restated here because this module must not import the geometry layer
 * (it is called from the BOM, which runs without a plan).
 */
function openingPosition(shed: DimensionedShed, opening: { align: string; offset: number | null; width: number }): number {
  const run = shed.span;
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
