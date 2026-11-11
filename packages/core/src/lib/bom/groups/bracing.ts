/**
 * The wind bracing group.
 *
 * Bracing is the diagonal that stops a rectangle from racking. A shed needs it on
 * both long walls, on both gable ends, and in the roof plane at each end of the
 * building; the desktop's rule is the same shape.
 *
 * Bracing is sold in **rolls**, not by the metre, so the quantity is
 * `ceil(totalMetres / rollMetres)` and the price is the roll price. The mass is
 * the steel actually used, `metres × (massPerRoll / rollMetres)`, because a part
 * roll's leftover does not end up in the building.
 *
 * **Deviation from the desktop (recorded at `/deviations`):** the desktop's final
 * normalisation divides the roll count by 1000 a second time
 * (`Ceil(Length / UnitLength / 1000)`), so a shed that needs four 30 m rolls is
 * billed for one thousandth of a roll. Here the division happens once.
 *
 * A wall cannot take bracing where a roller or sliding door is fitted — the door
 * has to be able to open — so a wall with one is skipped.
 */

import { bayWidthsFor } from '@/domain/bays';
import type { Opening, ShedConfig, WallSide } from '@/domain/types';
import type { PriceLookup } from '@/lib/pricing/types';
import { bomLine, mockedLine, type BomLine } from '../types';
import type { OptimisedFrame } from '../types';
import { safeCall } from '../safe';
import type { BomRules } from '../rules';

/** The bracing section a shed uses by default. */
const DEFAULT_BRACING = '30x1.2mm';
/** Used when the book has no roll row, so the count still comes out. */
const FALLBACK_ROLL_METRES = 30;

/** The diagonal across a rectangle, in metres. */
function diagonal(horizontalMm: number, verticalMm: number): number {
  return Math.sqrt(horizontalMm ** 2 + verticalMm ** 2) / 1000;
}

/**
 * How many of a wall's bays can still take a diagonal.
 *
 * A brace cannot cross a door that has to roll or slide clear, so the bays that
 * door occupies are lost — not the whole wall. Dropping the entire wall for one
 * roller door is what the first version did, and on the common case (one roller
 * door in a side wall) it removed every diagonal on that wall, under-bracing the
 * building.
 */
function braceableBays(shed: ShedConfig, wall: WallSide): number {
  const doors = shed.openings.filter(
    (opening: Opening) =>
      opening.wall === wall && (opening.type === 'roller_door' || opening.type === 'sliding_door'),
  );
  const bayWidthMm = Math.max(...bayWidthsFor(shed));
  // Each door blocks at least one bay, and a door wider than a bay blocks the
  // bays it spans.
  const blocked = doors.reduce(
    (sum, door) => sum + Math.max(1, Math.ceil(door.width / bayWidthMm)),
    0,
  );
  return Math.max(0, shed.bays - blocked);
}

/**
 * The bay width used for a side-wall diagonal, mm — the largest, since a diagonal across a short bay
 * would under-order the brace on a long one.
 */
function bayWidth(shed: ShedConfig): number {
  return Math.max(...bayWidthsFor(shed));
}

/**
 * Total bracing metres.
 *
 * - **Side walls**: one diagonal per bay per long wall, across the bay width and
 *   the wall height.
 * - **Gable ends**: two diagonals per end, each across half the span. The second
 *   of the pair rises with the roof, so it is longer.
 * - **Roof plane**: two diagonals in the first bay, and two more in the last bay
 *   when the shed is long enough for that bay to be a separate plane.
 */
export function bracingMetres(shed: ShedConfig, frame: OptimisedFrame): number {
  const pitch = (shed.roofPitchDeg * Math.PI) / 180;
  const rise = (shed.span / 2) * Math.tan(pitch);
  const bay = bayWidth(shed);

  let metres = 0;

  // Side walls: a cross brace in every bay a door does not occupy.
  for (const wall of ['front', 'back'] as WallSide[]) {
    metres += braceableBays(shed, wall) * diagonal(bay, shed.height);
  }

  // Gable ends: a pair of diagonals across half the span, one of which follows
  // the roof up to the ridge. A door in an end wall removes that pair.
  const flat = diagonal(shed.span / 2, shed.height);
  const raking = diagonal(shed.span / 2, shed.height + rise);
  for (const wall of ['left', 'right'] as WallSide[]) {
    const hasDoor = shed.openings.some(
      (opening: Opening) =>
        opening.wall === wall &&
        (opening.type === 'roller_door' || opening.type === 'sliding_door'),
    );
    if (!hasDoor) metres += flat + raking;
  }

  // Roof plane: the first bay, plus the last bay when it is a plane of its own.
  const roofBays = shed.bays >= 4 ? 2 : 1;
  const slopeRun = shed.span / 2 / Math.cos(pitch);
  metres += roofBays * 2 * diagonal(bay, slopeRun);

  return metres;
}

/** The bracing line. */
export function bracingLines(
  shed: ShedConfig,
  frame: OptimisedFrame,
  lookup: PriceLookup,
  // Bracing is measured from the geometry of the walls and roof; the roll length
  // comes from the book, not from a factory setting.
  _rules?: BomRules,
): BomLine[] {
  const metres = bracingMetres(shed, frame);
  if (metres <= 0) return [];

  const row = safeCall(() => lookup.bracing(DEFAULT_BRACING));
  const rollMetres = row !== undefined && row.rollMetres > 0 ? row.rollMetres : FALLBACK_ROLL_METRES;
  const quantity = Math.ceil(metres / rollMetres);
  const description = `Wind bracing — ${row?.description ?? DEFAULT_BRACING}, ${rollMetres} m roll`;

  if (row === undefined) {
    return [mockedLine({ group: 'bracing', description, unit: 'roll', quantity })];
  }
  return [
    bomLine({
      group: 'bracing',
      code: row.code,
      description,
      unit: 'roll',
      quantity,
      unitCost: row.unitCost,
      massKg: (metres / rollMetres) * row.massKg,
    }),
  ];
}
