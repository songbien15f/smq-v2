/**
 * The frame group: columns and rafters.
 *
 * The counts come from the desktop's own formulas, which are driven by the bay
 * count and by what is cut into the walls. The shape of the rule is:
 *
 *   - a bay grid line gets a column at each long wall, so `(bays − 1) × 2`;
 *   - an opening in a side wall adds a jamb column on both ends;
 *   - a carry beam replaces the wall it spans, so it removes a column;
 *   - the gable ends get their own columns, one pair per end.
 *
 * Rafters follow the same count as the columns on the same grid line, because a
 * portal frame is one column-and-rafter pair.
 *
 * Every frame member is priced by size from `cost_frame`, which is a length
 * material: the line's quantity is metres, so `quantity = length_mm / 1000`.
 */

import type { Opening, ShedConfig, ShedOption, WallSide } from '@/domain/types';
import type { FrameSchedule, PriceLookup } from '@/lib/pricing/types';
import { frameScheduleQuery, subCodeFor } from '@/lib/pricing/structure';
import { DEFAULT_BOM_RULES, type BomRules } from '../rules';
import { bomLine, mockedLine, type BomLine } from '../types';
import type { OptimisedFrame } from '../types';
import { safeCall } from '../safe';

/** How the desktop names the frame members, so the quote reads like its own. */
const MEMBER = {
  mainColumn: 'Main column',
  endWallColumn: 'End wall column',
  mainRafter: 'Main rafter',
  endWallRafter: 'End wall rafter',
  kneeBrace: 'Knee brace',
} as const;

/**
 * A column's footing allowance, mm, added to its length.
 *
 * The desktop adds this only for a `POST_IN_GROUND` column and nothing for one
 * bolted to a slab, and `ShedConfig` has no footing field to say which. This build
 * keeps the allowance, because a shed whose columns are cast in the ground is the
 * common rural case and a column that is 600 mm short cannot be used, while one
 * that is 600 mm long is an offcut. A slab-footed quote therefore over-orders that
 * allowance on each column; recorded at `/deviations`, and the fix is the footing
 * field rather than a guess in either direction.
 */
/* The footing allowance and knee brace length are **factory rules**. */
/**
 * The apex and haunch offsets a rafter gains, by pitch.
 *
 * From the book's `kneeedge` table: the rafter is cut long enough to meet the
 * apex plate and the haunch, which together add 70 mm at a 10° pitch and less as
 * the pitch steepens. These are the desktop's `kneeEdge.Apex` and
 * `kneeEdge.Haunch`, and they are **tens of millimetres**, not the 2.5 m knee
 * brace: the brace is a separate member with its own line.
 */
const KNEE_EDGE: { maxPitch: number; apex: number; haunch: number }[] = [
  { maxPitch: 7.5, apex: 35, haunch: 35 },
  { maxPitch: 15, apex: 35, haunch: 35 },
  { maxPitch: 20, apex: 30, haunch: 30 },
  { maxPitch: 25, apex: 30, haunch: 30 },
  { maxPitch: 30, apex: 25, haunch: 25 },
  { maxPitch: 90, apex: 25, haunch: 25 },
];
/* The rafter clearance is a **factory rule**. */
/** The frame size used when the price book has no row. */
const FALLBACK_SIZE = '100 x 100 x 2.0 SHS';

const SIDES: WallSide[] = ['front', 'back', 'left', 'right'];

/** Openings on one wall. */
function openingsOn(shed: ShedConfig, wall: WallSide): Opening[] {
  return shed.openings.filter((opening) => opening.wall === wall);
}

/** Carry beams on one wall. */
function carryBeamsOn(shed: ShedConfig, wall: WallSide): ShedOption[] {
  return shed.options.filter(
    (option): option is Extract<ShedOption, { kind: 'carry_beam' }> =>
      option.kind === 'carry_beam' && option.wall === wall,
  );
}

/**
 * The number of main (internal grid line) columns and rafters.
 *
 * `(bays − 1)` internal lines, each with a member at both long walls, less one
 * for every carry beam that has taken a column's place, plus a jamb pair for each
 * side wall that has an opening.
 */
function mainMemberCount(shed: ShedConfig): number {
  const beams = carryBeamsOn(shed, 'front').length + carryBeamsOn(shed, 'back').length;
  const leftJamb = openingsOn(shed, 'left').length > 0 ? 2 : 0;
  const rightJamb = openingsOn(shed, 'right').length > 0 ? 2 : 0;
  const count = (shed.bays - 1) * 2 - beams + leftJamb + rightJamb;
  return Math.max(0, count);
}

/**
 * The number of end-wall (gable end) columns and rafters.
 *
 * Each end normally takes two members. A side wall with an opening already has a
 * jamb column at that corner, so the end loses one.
 */
function endMemberCount(shed: ShedConfig): number {
  const leftOpen = openingsOn(shed, 'left').length > 0 ? 1 : 0;
  const rightOpen = openingsOn(shed, 'right').length > 0 ? 1 : 0;
  const perEnd = Math.max(0, 2 - leftOpen - rightOpen);
  return perEnd * 2;
}

/**
 * A column's length: the wall height plus whatever the design puts below the
 * floor.
 *
 * The book states that depth per design (`system_lookup_data.embedment`: 450 mm
 * or 300 mm on the shipped book). When there is no schedule the flat 600 mm
 * allowance is kept, because a column that is 600 mm short cannot be used.
 */
function columnLength(shed: ShedConfig, embedment: number | null, rules: BomRules): number {
  return shed.height + (embedment ?? rules.footingAllowance);
}

/**
 * A rafter's length, mm.
 *
 * Half the span over the cosine of the pitch — the slope run — plus the apex and
 * haunch offsets. At a zero pitch the cosine is 1, so the rafter is half the span
 * and nothing divides by zero.
 *
 * **The knee brace is not part of this.** An earlier version added
 * `2 × 2500 mm`, which made every rafter 5 m too long and, on the default 12 m
 * shed, ordered 11.1 m of steel for a 6.1 m slope. The desktop adds
 * `kneeEdge.Apex + kneeEdge.Haunch` — 70 mm at a 10° pitch — and carries the
 * brace as its own member, which this group already does.
 */
function rafterLength(shed: ShedConfig, rules: BomRules): number {
  const pitch = (shed.roofPitchDeg * Math.PI) / 180;
  const slopeRun = shed.span / 2 / Math.cos(pitch);
  const edge = KNEE_EDGE.find((row) => shed.roofPitchDeg <= row.maxPitch) ?? KNEE_EDGE[0];
  return Math.round(slopeRun + rules.rafterClearance + edge.apex + edge.haunch);
}

/** Emit a length-material line in metres, or a mocked line when unpriced. */
function memberLine(
  group: 'frame',
  description: string,
  lengthMm: number,
  count: number,
  lookup: PriceLookup,
  section: string,
): BomLine[] {
  if (count <= 0) return [];
  const metres = (lengthMm / 1000) * count;
  const row = safeCall(() => lookup.frame(section));
  if (row === undefined) {
    return [mockedLine({ group, description, unit: 'm', quantity: Math.round(metres * 100) / 100 })];
  }
  return [
    bomLine({
      group,
      code: row.code,
      description: `${description} — ${section}`,
      unit: 'm',
      quantity: Math.round(metres * 100) / 100,
      unitCost: row.unitCost,
      massKg: row.massKg * metres,
    }),
  ];
}

/**
 * The frame's BOM lines.
 *
 * **Which section each member takes.** When the book carries its
 * structure-to-section table (`system_lookup_data`), the section comes from
 * there: a 15 m span is framed in `C35030`, a 6 m span in `C15019`, and the two
 * are priced $38.61 and $12.18 a metre. Pricing every member from one 100 × 100
 * SHS — which is what this group did — understates a wide portal by more than
 * half and overstates a narrow one.
 *
 * The table is asked for the dimensions the config states. It also keys on two
 * it does not (the design's pitch class and footing class), so the lookup takes
 * the lowest-pitch, lowest-footing row of that combination; on the shipped book
 * that row exists for every combination this build can express, and the two
 * classes differ by one section step at most.
 *
 * **When the book has no table** — a partial dump, or an older book — the frame
 * falls back to one fixed section and the standing assumption says so. A quote
 * that cannot be exact is still worth producing, provided it says which part is
 * approximate.
 *
 * The purlin material's depth is part of a rafter's length in the desktop's
 * formula; this build keeps the rafter at the slope run plus its allowances,
 * which is the same shape of answer without depending on a column the desktop
 * reads from a different table.
 */
export function frameLines(
  shed: ShedConfig,
  frame: OptimisedFrame,
  lookup: PriceLookup,
  rules: BomRules = DEFAULT_BOM_RULES,
): BomLine[] {
  const main = mainMemberCount(shed);
  const end = endMemberCount(shed);
  const schedule = safeCall(() => scheduleFor(shed, frame, lookup));
  const section = schedule?.mainColumn ?? FALLBACK_SIZE;
  const endSection = schedule?.endWallColumn ?? FALLBACK_SIZE;
  const rafterSection = schedule?.mainRafter ?? FALLBACK_SIZE;
  const endRafterSection = schedule?.endWallRafter ?? FALLBACK_SIZE;
  // A design with no knee brace has none to price. The fallback section is only
  // used when there is no schedule at all, where the brace is assumed present.
  const braceSection = schedule === undefined ? FALLBACK_SIZE : schedule.kneeBrace;

  const column = columnLength(shed, schedule?.embedment ?? null, rules);

  return [
    ...memberLine('frame', MEMBER.mainColumn, column, main, lookup, section),
    ...memberLine('frame', MEMBER.endWallColumn, column, end, lookup, endSection),
    ...memberLine('frame', MEMBER.mainRafter, rafterLength(shed, rules), main, lookup, rafterSection),
    ...memberLine(
      'frame',
      MEMBER.endWallRafter,
      rafterLength(shed, rules),
      end,
      lookup,
      endRafterSection,
    ),
    // One knee brace per portal frame connection: two per main member.
    ...(braceSection === null
      ? []
      : memberLine(
          'frame',
          MEMBER.kneeBrace,
          rules.kneeBraceLength,
          main * 2,
          lookup,
          braceSection,
        )),
  ];
}

/**
 * The book's frame schedule for this building, or `undefined` when it has none.
 *
 * The query is built by `frameScheduleQuery` — the same function the optimiser
 * uses to decide whether this quote rests on a fixed section. Sharing it is what
 * keeps the two answers consistent.
 */
function scheduleFor(
  shed: ShedConfig,
  frame: OptimisedFrame,
  lookup: PriceLookup,
): FrameSchedule | undefined {
  const structureCode = lookup.structureId(subCodeFor(shed.structureType));
  if (structureCode === undefined) return undefined;
  return lookup.frameSchedule(frameScheduleQuery(shed, frame.bayStandard, structureCode));
}

/**
 * The two member counts, exported for the groups that fix or brace the frame.
 *
 * A base bracket, a bracing pair and a set of bolts all hang off "how many main
 * columns" and "how many end-wall columns", so the rule that answers that must
 * exist once. Recomputing it in three modules is how the groups drift apart.
 */
export function frameCounts(shed: ShedConfig): { main: number; end: number } {
  return { main: mainMemberCount(shed), end: endMemberCount(shed) };
}

/** Every wall a frame member can sit on, exported for the groups that need it. */
export const FRAME_SIDES = SIDES;
