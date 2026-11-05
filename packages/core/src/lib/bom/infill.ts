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

import type { ShedConfig } from '@/domain/types';

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
  shed: ShedConfig,
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

/** The result of building the infill columns for a shed. */
export interface InfillColumns {
  columns: InfillColumn[];
  /**
   * Why there are none, when a caller might reasonably have expected some.
   *
   * `null` when the building genuinely has none — a narrow span, or a design the book
   * says needs no infill. A sentence when a rule this build cannot apply withheld them
   * (a door in the gable end), so the panel can say which it is instead of showing an
   * empty list.
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
 * A gable end with an **opening in it** is withheld with a sentence rather than
 * approximated — see the module comment: re-spacing columns around a door needs the
 * desktop's `RDoor` model, which this build does not have.
 */
export function buildInfillColumns(shed: ShedConfig, geometry: InfillGeometry): InfillColumns {
  if (geometry.count === null || geometry.section === null || geometry.count <= 0) {
    return { columns: [], withheld: null };
  }

  const decrement = infillSetback(geometry);
  const positions = infillPositions(shed.span, geometry.count, decrement);
  if (positions.length === 0) return { columns: [], withheld: null };

  const ends: { end: 'front' | 'back'; open: boolean }[] = [
    { end: 'front', open: shed.endOpening.left },
    { end: 'back', open: shed.endOpening.right },
  ];

  for (const { end, open } of ends) {
    if (open) continue;
    // Any opening cut into this gable end could be a roller door, which changes
    // where the columns go. Withholding is the only answer that is not a guess.
    const hasOpening = shed.openings.some(
      (opening) => opening.wall === (end === 'front' ? 'front' : 'back'),
    );
    if (hasOpening) {
      return {
        columns: [],
        withheld:
          'Infill columns are withheld because this gable end has an opening in it. Where the columns go around a door depends on the door’s style and its exact position, which this build does not model — so the end wall is priced with no infill rather than with guessed positions.',
      };
    }
  }

  const columns: InfillColumn[] = [];
  for (const { end, open } of ends) {
    if (open) continue;
    for (const positionMm of positions) {
      columns.push({
        end,
        positionMm,
        lengthMm: infillLength(shed, positionMm, geometry, decrement),
      });
    }
  }

  return { columns, withheld: null };
}
