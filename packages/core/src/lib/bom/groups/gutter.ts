/**
 * The gutter, downpipe and flashing groups.
 *
 * Gutters collect what runs off the roof, so their length is the eave length of
 * every roofed edge; brackets hold them up at a fixed spacing; a downpipe takes
 * the water to the ground at each corner. Flashing closes the joints where two
 * sheets or a sheet and a frame meet.
 *
 * **Deviation from the desktop (recorded at `/deviations`):** the desktop's
 * export writes gutter rows into the flashing section because two section arrays
 * are index-swapped. Here each line's `group` is set when the line is created, so
 * a gutter line can never appear under Flashing.
 */

import type { ShedConfig } from '@/domain/types';
import type { PriceLookup, PriceRow } from '@/lib/pricing/types';
import { bomLine, mockedLine, type BomLine } from '../types';
import type { OptimisedFrame } from '../types';
import { safeCall } from '../safe';
import { isOpenStructure } from './sheeting';
import { DEFAULT_BOM_RULES, type BomRules } from '../rules';
import { buildingSlidingDoors, headFlashingType } from '../slidingDoors';

/* The bracket spacing is a **factory rule** and arrives with the rule set. */
/** One downpipe per corner of a rectangular shed. */
const CORNERS = 4;
/** A downpipe drops from the gutter to the ground, so it is the wall height long. */
const DOWNPIPE_LENGTH_MM = (height: number) => height;
/** The gutter profile a shed uses by default. */
const DEFAULT_GUTTER_SIZE = '115 Quad';
/** The material used when the shed has not been given one. */
const DEFAULT_DOWNPIPE_KIND = 'PVC';

/** How many brackets hold the gutter up, which the fixing group also needs. */
export function gutterBracketCount(shed: ShedConfig, rules: BomRules = DEFAULT_BOM_RULES): number {
  const fallsAlongLength =
    shed.structureType === 'skillion' || shed.structureType === 'skillion_carport';
  const eaves = fallsAlongLength ? 1 : 2;
  return Math.ceil(((shed.length / 1000) * eaves * 1000) / rules.bracketSpacing);
}

/** Metres of gutter along one eave. */
function eaveMetres(shed: ShedConfig): number {
  return shed.length / 1000;
}

/** A length line, or a mocked one when the price book has no row. */
function lengthLine(
  group: 'gutter' | 'flashing',
  description: string,
  metres: number,
  row: PriceRow | undefined,
): BomLine[] {
  if (metres <= 0) return [];
  const quantity = Math.round(metres * 100) / 100;
  if (row === undefined) {
    return [mockedLine({ group, description, unit: 'm', quantity })];
  }
  return [
    bomLine({
      group,
      code: row.code,
      description,
      unit: 'm',
      quantity,
      unitCost: row.unitCost,
      massKg: row.massKg * quantity,
    }),
  ];
}

/** An each line, or a mocked one. */
function eachLine(
  group: 'gutter' | 'flashing',
  description: string,
  count: number,
  row: PriceRow | undefined,
): BomLine[] {
  if (count <= 0) return [];
  if (row === undefined) {
    return [mockedLine({ group, description, unit: 'ea', quantity: count })];
  }
  return [
    bomLine({
      group,
      code: row.code,
      description,
      unit: 'ea',
      quantity: count,
      unitCost: row.unitCost,
      massKg: row.massKg * count,
    }),
  ];
}

/** The gutter, bracket and downpipe lines. */
export function gutterLines(
  shed: ShedConfig,
  frame: OptimisedFrame,
  lookup: PriceLookup,
  rules: BomRules = DEFAULT_BOM_RULES,
): BomLine[] {
  // A carport's roof still collects water, so it keeps its gutter, but there are
  // no walls for the fascia capping.

  const fallsAlongLength =
    shed.structureType === 'skillion' || shed.structureType === 'skillion_carport';
  // A gable has an eave on both long walls; a skillion sheds to one.
  const eaves = fallsAlongLength ? 1 : 2;

  const gutterMetres = eaveMetres(shed) * eaves;
  const brackets = gutterBracketCount(shed, rules);

  // The gutter has its own colour role now that the studio paints it separately
  // from the barge. The book prices the same profile galvanised and painted, and
  // an unpainted gutter on a Colorbond shed is a callback — so the name is
  // resolved once here.
  const colour = safeCall(() => lookup.colourName(shed.colors.gutter));
  /*
   * The pipe is the **chosen material in the chosen colour**, not a default.
   *
   * The desktop looks it up with all three parts of the key — colour, kind and state
   * (`BOMFactory.cs:118`), and it is the same fact the Colours block lets a person pick. Reading
   * `PVC 90mm` for every shed meant a steel-pipe quote was priced from the PVC row and the document
   * said nothing about the difference.
   */
  const downpipeKind = shed.downpipeType.trim() === '' ? DEFAULT_DOWNPIPE_KIND : shed.downpipeType.trim();
  const downpipeColour = safeCall(() => lookup.colourName(shed.colors.downpipe));
  /*
   * The book stocks a downpipe in **two states only**: NSW and SA.
   *
   * The desktop maps every other state onto NSW and keeps SA as itself
   * (`BOMFactory.cs:114-115`: `state = PVC ? "NSW" : (StateCode == "SA" ? "SA" : "NSW")`). Asking for
   * the quote's own state finds no row in QLD, VIC, WA … and falls through to "cheapest anywhere",
   * which on this book is SA's 100×50 at $8.02 instead of the 100×75 the factory actually ships.
   */
  const downpipeState =
    downpipeKind.toUpperCase() === 'PVC'
      ? 'NSW'
      : shed.stateCode.trim().toUpperCase() === 'SA'
        ? 'SA'
        : 'NSW';

  return [
    ...lengthLine('gutter', 'Gutter', gutterMetres, safeCall(() => lookup.gutter(DEFAULT_GUTTER_SIZE, colour))),
    ...eachLine('gutter', 'Gutter bracket', brackets, safeCall(() => lookup.gutterBracket(DEFAULT_GUTTER_SIZE))),
    // A downpipe is sold per metre and drops the wall height at each corner. A
    // fixed count of four billed one piece per corner whatever the wall height,
    // so a 6 m shed and a 3 m shed ordered the same pipe.
    ...lengthLine(
      'gutter',
      `Downpipe, ${shed.height} mm drop`,
      (DOWNPIPE_LENGTH_MM(shed.height) / 1000) * CORNERS,
      safeCall(() => lookup.downpipe(downpipeKind, downpipeColour, downpipeState)),
    ),
  ];
}

/** The flashing lines: barge, fascia and corners. */
export function flashingLines(
  shed: ShedConfig,
  frame: OptimisedFrame,
  lookup: PriceLookup,
  // Flashing runs are measured from the roof's geometry and priced by profile and
  // colour; no factory setting applies.
  _rules?: BomRules,
): BomLine[] {
  const fallsAlongLength =
    shed.structureType === 'skillion' || shed.structureType === 'skillion_carport';

  // Barge closes the gable end of the roof, so a gable has two barge runs and a
  // skillion has one raking edge.
  const bargeRuns = fallsAlongLength ? 1 : 2;
  const bargeMetres = (shed.span / 1000) * bargeRuns;

  // Fascia or capping runs along every eave, like the gutter.
  const eaveRuns = fallsAlongLength ? 1 : 2;
  const fasciaMetres = (shed.length / 1000) * eaveRuns;

  // Flashing is colour-matched. The config stores hex; the book indexes by name,
  // so the name is resolved once here. An unknown colour falls back to the book's
  // painted price rather than its galvanised one, which is dearer.
  const colour = safeCall(() => lookup.colourName(shed.colors.barge));
  const flashing = (type: string) => safeCall(() => lookup.flashing(type, colour));

  // Ridge capping runs the full length at the apex. Without it a gable quote
  // omits a per-metre material the roofer cannot finish the roof without.
  const ridgeMetres = fallsAlongLength ? 0 : shed.length / 1000;

  /*
   * A sliding door's head flashing, one line per profile the building needs.
   *
   * The beam over a sliding door needs a flashing over it, and the book carries two: a
   * shallow one for a single track and a deeper one for a double track, because the double
   * stands further off the wall. This build priced neither, so a sliding door was the leaf
   * alone and the water ran behind its beam.
   *
   * Grouped by profile rather than per door: two doors on one wall are one run in metres,
   * and a reader wants that as one line. A building with both track types gets two lines,
   * because they are different products at different prices.
   */
  const slidingFlashingMetres = new Map<string, number>();
  for (const member of safeCall(() => buildingSlidingDoors(shed)) ?? []) {
    if (member.item !== 'sld_head_flashing') continue;
    const opening = shed.openings.find((candidate) => candidate.id === member.openingId);
    if (opening === undefined) continue;
    const type = headFlashingType(opening);
    const metres = (member.lengthMm / 1000) * member.quantity;
    slidingFlashingMetres.set(type, (slidingFlashingMetres.get(type) ?? 0) + metres);
  }

  return [
    ...lengthLine('flashing', 'Ridge capping', ridgeMetres, flashing('ROLLTOP_RIDGE_CAPPING')),
    ...lengthLine('flashing', 'Barge flashing', bargeMetres, flashing('GABLE_BARGE')),
    ...lengthLine('flashing', 'Eave capping', fasciaMetres, flashing('CORO_CAPPING')),
    // A corner flashing runs the wall height, so it is a length, not a count.
    ...lengthLine(
      'flashing',
      `Corner flashing, ${shed.height} mm`,
      (shed.height / 1000) * CORNERS,
      flashing('CORNER_FLASHING'),
    ),
    ...[...slidingFlashingMetres.entries()].flatMap(([type, metres]) =>
      lengthLine(
        'flashing',
        type === 'SLD_HEAD_FLASHING'
          ? 'Sliding door head flashing, double track'
          : 'Sliding door head flashing, single track',
        metres,
        flashing(type),
      ),
    ),
  ];
}
