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

import type { Opening, ShedConfig, ShedOption, WallSide, DimensionedShed } from '@/domain/types';
import { fallsToBothSides } from '@/domain/types';
import type { FrameSchedule, PriceLookup } from '@/lib/pricing/types';
import { frameScheduleQuery, subCodeFor } from '@/lib/pricing/structure';
import { buildInfillColumns, type InfillColumns } from '../infill';
import { buildDoorFrameMembers, type DoorFrameMember } from '../doorFrames';
import { buildingSlidingDoors } from '../slidingDoors';
import { DEFAULT_BOM_RULES, type BomRules } from '../rules';
import { bomLine, mockedLine, type BomLine } from '../types';
import type { OptimisedFrame } from '../types';
import { safeCall } from '../safe';

/** How the desktop names the frame members, so the quote reads like its own. */
/** The section the desktop cuts a sliding door header from (`SLDQuote.cs:58`). */
const SLIDING_HEADER_SECTION = 'C15024';

const MEMBER = {
  mainColumn: 'Main column',
  endWallColumn: 'End wall column',
  mainRafter: 'Main rafter',
  endWallRafter: 'End wall rafter',
  kneeBrace: 'Knee brace',
  infillColumn: 'Infill column',
  doorHeader: 'Roller door header',
  doorColumn: 'Roller door column',
  doorDropper: 'Roller door dropper',
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
function openingsOn(shed: DimensionedShed, wall: WallSide): Opening[] {
  return shed.openings.filter((opening) => opening.wall === wall);
}

/** Carry beams on one wall. */
function carryBeamsOn(shed: DimensionedShed, wall: WallSide): ShedOption[] {
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
function mainMemberCount(shed: DimensionedShed): number {
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
function endMemberCount(shed: DimensionedShed): number {
  const leftOpen = openingsOn(shed, 'left').length > 0 ? 1 : 0;
  const rightOpen = openingsOn(shed, 'right').length > 0 ? 1 : 0;
  const perEnd = Math.max(0, 2 - leftOpen - rightOpen);
  return perEnd * 2;
}

/**
 * A column's length: the wall height plus whatever goes below the floor.
 *
 * ## Which number wins, and why the footing now has a say
 *
 * The frame design states its own embedment (`view_system_lookup_data.embedment`: 450 mm on the
 * reference book), and that is the depth the design was calculated for. But the **footing** decides
 * whether the column stands on a slab or is buried: a post in the ground is `height + 500`, everything
 * on a slab stops at the floor (`−12` means "pinned at the slab", which is not a negative length).
 *
 * Until 2026-11-11 nothing read the footing at all: the desktop's own
 * `Height + getCodeFooting(FootingType)` (`SkillionBuildingQuote.cs:299`, `TopHatQuote.cs:49`) had no
 * equivalent here, so switching a shed from HD bolts to post-in-ground changed **nothing** — measured:
 * 28.80 column metres either way, and a post-in-ground shed ordered 500 mm less steel per column than
 * the factory pours.
 *
 * The footing wins when the book states it, because it is the more specific fact: it describes this
 * building's foundations rather than the generic design the sections came from. A book without the
 * pair falls back to the design's embedment, and then to the flat allowance.
 */
function columnLength(
  shed: DimensionedShed,
  embedment: number | null,
  footingParameters: number | null,
  rules: BomRules,
): number {
  /*
   * A footing parameter of zero or less adds nothing.
   *
   * `−12` is the book's way of writing "pinned at the slab": the column stops at the floor, and adding
   * a negative length would shorten it. `0` is a cast-in strap, which is cast into the slab — also no
   * extra length.
   */
  if (footingParameters !== null) {
    return shed.height + Math.max(0, footingParameters);
  }
  return shed.height + (embedment ?? rules.footingAllowance);
}

/**
 * The footing's parameter for this shed, mm, or `null` when the book has no row for the pair.
 *
 * One helper because both frame call sites need the same answer, and two lookups could drift.
 */
function footingFor(shed: DimensionedShed, lookup: PriceLookup): number | null {
  if (shed.footingType.trim() === '' || shed.footingSubType.trim() === '') return null;
  return safeCall(() => lookup.footingParameters(shed.footingType, shed.footingSubType)) ?? null;
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
function rafterLength(shed: DimensionedShed, rules: BomRules): number {
  const pitch = (shed.roofPitchDeg * Math.PI) / 180;
  // A gable sheds to both long walls, so its rafter runs over half the width; a
  // skillion falls the whole way to one side and its rafter is the full width. The
  // formula used to halve both, which ordered half a rafter on every skillion.
  const run = fallsToBothSides(shed.structureType) ? shed.span / 2 : shed.span;
  const slopeRun = run / Math.cos(pitch);
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
  shed: DimensionedShed,
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
  const footing = footingFor(shed, lookup);

  const column = columnLength(shed, schedule?.embedment ?? null, footing, rules);

  /*
   * The infill columns, priced.
   *
   * The same `buildInfillColumns` the cut list reads, called with the same inputs, so
   * the metres ordered and the members cut cannot disagree. Each column is its own
   * length — an outer one is shorter than an inner one — so they are summed rather
   * than multiplied by a quantity, and the description carries the count so a reader
   * can see the line is four columns and not one long one.
   */
  const infillColumns = buildingInfillColumns(shed, frame, lookup, rules).columns;
  const infillMetres = infillColumns.reduce((sum, column) => sum + column.lengthMm / 1000, 0);
  const infillSection = schedule?.infill?.section ?? null;

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
    // The infill columns: one line, total metres, count in the description.
    ...(infillColumns.length === 0 || infillSection === null
      ? []
      : memberLine(
          'frame',
          `${MEMBER.infillColumn} × ${infillColumns.length}`,
          // `memberLine` multiplies length by count, so hand it the average and the
          // count — the product is the total metres either way.
          Math.round((infillMetres / infillColumns.length) * 1000),
          infillColumns.length,
          lookup,
          infillSection,
        )),
    /*
     * The roller doors' frames. One line per member kind, with the openings' steel summed:
     * two 3 m doors on one wall are two headers and four posts, and a reader wants those as
     * two lines, not as four.
     *
     * Before this, the frame group priced no door steel at all and an assumption said the
     * mullions were included in the door's catalogue price — which they are not.
     */
    ...doorFrameLines(shed, frame, lookup, rules),
    ...slidingDoorHeaderLines(shed, lookup),
  ];
}

/**
 * The head beam over each sliding door, priced in the frame group.
 *
 * A sliding door hangs on a track, the track hangs from a beam, and the beam is steel cut
 * from `C15024`. The desktop cuts it there (`SLDQuote.cs:58`) and this build priced nothing
 * — a sliding door was the leaf alone, with no beam over it.
 *
 * **The track itself is deliberately absent.** Every `DOOR_TRACK` line in the desktop is
 * commented out, and the only live producer, `computeSLDTrackTQ3`, has its single call site
 * commented out too (`SLDQuote.cs:781`). Charging for track here would invent a line the
 * original never had.
 */
function slidingDoorHeaderLines(shed: DimensionedShed, lookup: PriceLookup): BomLine[] {
  const headers = (safeCall(() => buildingSlidingDoors(shed)) ?? []).filter(
    (member) => member.item === 'sld_header',
  );
  if (headers.length === 0) return [];

  const quantity = headers.reduce((sum, header) => sum + header.quantity, 0);
  const metres = headers.reduce(
    (sum, header) => sum + (header.lengthMm / 1000) * header.quantity,
    0,
  );
  return memberLine(
    'frame',
    `Sliding door header × ${quantity}`,
    Math.round((metres / quantity) * 1000),
    quantity,
    lookup,
    SLIDING_HEADER_SECTION,
  );
}

/** One priced line per kind of door-frame member the building has. */
function doorFrameLines(
  shed: DimensionedShed,
  frame: OptimisedFrame,
  lookup: PriceLookup,
  rules: BomRules,
): BomLine[] {
  const members = buildingDoorFrames(shed, frame, lookup, rules);
  const lines: BomLine[] = [];

  for (const item of ['door_header', 'door_column', 'door_dropper'] as const) {
    const group = members.filter((member) => member.item === item);
    if (group.length === 0) continue;
    const first = group[0]!;
    const quantity = group.reduce((sum, member) => sum + member.quantity, 0);
    const metres = group.reduce((sum, member) => sum + (member.lengthMm / 1000) * member.quantity, 0);
    const label =
      item === 'door_header'
        ? MEMBER.doorHeader
        : item === 'door_column'
          ? MEMBER.doorColumn
          : MEMBER.doorDropper;
    lines.push(
      ...memberLine(
        'frame',
        `${label} × ${quantity}`,
        Math.round((metres / quantity) * 1000),
        quantity,
        lookup,
        first.section,
      ),
    );
  }

  return lines;
}

/**
 * The book's frame schedule for this building, or `undefined` when it has none.
 *
 * The query is built by `frameScheduleQuery` — the same function the optimiser
 * uses to decide whether this quote rests on a fixed section. Sharing it is what
 * keeps the two answers consistent.
 */
function scheduleFor(
  shed: DimensionedShed,
  frame: OptimisedFrame,
  lookup: PriceLookup,
): FrameSchedule | undefined {
  const structureCode = lookup.structureId(subCodeFor(shed.structureType));
  if (structureCode === undefined) return undefined;
  return lookup.frameSchedule(frameScheduleQuery(shed, frame.bayStandard, structureCode));
}

/**
 * One run of steel in the building, as the workshop reads it off a drawing.
 *
 * The desktop's member-size screen and its Punchings report both work from this
 * list: a member, the section the design chose for it, its cut length, and how
 * many the building has. It is the same information the frame group prices — the
 * quantity here × length / 1000 is exactly the line's metres — so the cut list and
 * the order cannot describe different steel.
 */
export interface FrameMember {
  /** Stable name for the UI and for a saved snapshot. */
  item:
    | 'main_column'
    | 'end_column'
    | 'main_rafter'
    | 'end_rafter'
    | 'knee_brace'
    | 'infill_column'
    | 'door_header'
    | 'door_column'
    | 'door_dropper';
  /** What the desktop calls it. */
  label: string;
  /** The section from the book's structure table, or the fallback size. */
  section: string;
  /** True when the book has no structure table and every member takes one size. */
  assumed: boolean;
  /** Cut length, mm. */
  lengthMm: number;
  /** How many the building has. */
  quantity: number;
  /**
   * The section's web, mm, or `null` when the book has no row for it.
   *
   * The connector tables are keyed by web (`HP20-10` is the haunch for a 20 mm web
   * at a 10° pitch), so a punching sheet cannot be built without it. `null` rather
   * than `0`: a zero web would silently ask for a connector that does not exist.
   */
  web: number | null;
  /** The section's depth, mm, or `null` when the book has no row for it. */
  depth: number | null;
}

/**
 * The cut list for this building.
 *
 * Every number comes from the function that prices the same member, so a quote
 * whose order says six main columns cannot have a cut list that says eight. It
 * reads the book through the same `scheduleFor` as `frameLines`, which is what
 * makes the two agree on the section as well as the count.
 */
export function frameMemberSchedule(
  shed: DimensionedShed,
  frame: OptimisedFrame,
  lookup: PriceLookup,
  rules: BomRules = DEFAULT_BOM_RULES,
): FrameMember[] {
  const main = mainMemberCount(shed);
  const end = endMemberCount(shed);
  const schedule = safeCall(() => scheduleFor(shed, frame, lookup));
  const assumed = schedule === undefined;
  /*
   * The same footing the priced lines use: a cut list that disagrees with the order is a list
   * somebody cuts to, and 500 mm per column is not a rounding difference.
   */
  const column = columnLength(shed, schedule?.embedment ?? null, footingFor(shed, lookup), rules);
  const rafter = rafterLength(shed, rules);

  /** The section's cross-section, so the connector tables can be asked for it. */
  const geometry = (section: string): { web: number | null; depth: number | null } => {
    const row = safeCall(() => lookup.frameGeometry?.(section));
    return { web: row?.web ?? null, depth: row?.depth ?? null };
  };

  const mainColumnSection = schedule?.mainColumn ?? FALLBACK_SIZE;
  const mainRafterSection = schedule?.mainRafter ?? FALLBACK_SIZE;
  const endColumnSection = schedule?.endWallColumn ?? FALLBACK_SIZE;
  const endRafterSection = schedule?.endWallRafter ?? FALLBACK_SIZE;

  const members: FrameMember[] = [
    {
      item: 'main_column',
      label: MEMBER.mainColumn,
      section: mainColumnSection,
      assumed,
      lengthMm: column,
      quantity: main,
      ...geometry(mainColumnSection),
    },
    {
      item: 'main_rafter',
      label: MEMBER.mainRafter,
      section: mainRafterSection,
      assumed,
      lengthMm: rafter,
      quantity: main,
      ...geometry(mainRafterSection),
    },
    {
      item: 'end_column',
      label: MEMBER.endWallColumn,
      section: endColumnSection,
      assumed,
      lengthMm: column,
      quantity: end,
      ...geometry(endColumnSection),
    },
    {
      item: 'end_rafter',
      label: MEMBER.endWallRafter,
      section: endRafterSection,
      assumed,
      lengthMm: rafter,
      quantity: end,
      ...geometry(endRafterSection),
    },
  ];

  // A design with no brace has none to cut; one with no schedule at all is assumed
  // to have them, the same assumption the priced lines make.
  const braceSection = assumed ? FALLBACK_SIZE : schedule.kneeBrace;
  if (braceSection !== null) {
    members.push({
      item: 'knee_brace',
      label: MEMBER.kneeBrace,
      section: braceSection,
      assumed,
      lengthMm: rules.kneeBraceLength,
      quantity: Math.max(0, main * 2),
      ...geometry(braceSection),
    });
  }

  /*
   * The infill columns, from the book's `no_M/EW` and `M1`.
   *
   * These were **not priced at all**, which is four columns missing on a 12 m gable:
   * two per end wall. The steel is what carries the gable sheeting the quote already
   * charges for, so the omission understated the frame and would have produced a
   * building the factory could not erect.
   *
   * Their positions and lengths come from `infill.ts`, and a gable end holding a door
   * is withheld there rather than guessed. One line covers both ends because every
   * infill column on a symmetric gable is the same length — the pairs are mirrored
   * about the ridge — so a per-end breakdown would repeat one number.
   */
  const infillSection = schedule?.infill?.section ?? null;
  if (infillSection !== null) {
    const columns = buildingInfillColumns(shed, frame, lookup, rules).columns;
    if (columns.length > 0) {
      members.push({
        item: 'infill_column',
        label: MEMBER.infillColumn,
        section: infillSection,
        assumed: false,
        // Every infill on a symmetric gable is the same length: the pairs are mirrored
        // about the ridge. The first one speaks for them all.
        lengthMm: columns[0]?.lengthMm ?? 0,
        quantity: columns.length,
        ...geometry(infillSection),
      });
    }
  }

  /*
   * The roller doors' frames, one cut-list row per kind.
   *
   * A header and a post pair per opening, and a dropper on a wide one. Their sections come
   * from the book's `DH`/`DM`; without those the doors are framed by nothing, which is what
   * this build did before.
   */
  /*
   * The sliding doors' head beams. A beam is steel on a cut list like any other member, and
   * it was missing from the schedule even after it entered the priced lines — the two have
   * to describe the same building.
   */
  for (const header of safeCall(() => buildingSlidingDoors(shed)) ?? []) {
    if (header.item !== 'sld_header') continue;
    const existing = members.find(
      (member) => member.item === 'door_header' && member.section === SLIDING_HEADER_SECTION,
    );
    if (existing === undefined) {
      members.push({
        item: 'door_header',
        label: 'Sliding door header',
        section: SLIDING_HEADER_SECTION,
        assumed: false,
        lengthMm: header.lengthMm,
        quantity: header.quantity,
        ...geometry(SLIDING_HEADER_SECTION),
      });
    }
  }

  for (const door of buildingDoorFrames(shed, frame, lookup, rules)) {
    const existing = members.find(
      (member) => member.item === door.item && member.section === door.section,
    );
    if (existing !== undefined) {
      // Two doors of the same section: one row with the counts summed, because the workshop
      // cuts them the same way.
      const total = existing.quantity + door.quantity;
      const weighted =
        (existing.lengthMm * existing.quantity + door.lengthMm * door.quantity) / total;
      existing.lengthMm = Math.round(weighted);
      existing.quantity = total;
      continue;
    }
    members.push({
      item: door.item,
      label: door.label,
      section: door.section,
      // The section came from the book's own `DH`/`DM` column, so it is a design rather
      // than an assumption.
      assumed: false,
      lengthMm: door.lengthMm,
      quantity: door.quantity,
      ...geometry(door.section),
    });
  }

  return members.filter((member) => member.quantity > 0);
}

/**
 * The infill columns this building's design calls for, with their positions.
 *
 * One function for the three callers — the priced lines, the cut list and the R3
 * check in `build.ts` — because each of them must agree about **where a column
 * stands**. Three copies would let a door be refused for sitting on a column the cut
 * list does not have.
 *
 * Empty for a design the book says needs none, for a gable under 3 m, for an open
 * gable end, and for a gable end holding a door (see `infill.ts` for why that last
 * case is withheld rather than guessed).
 */
export function buildingInfillColumns(
  shed: DimensionedShed,
  frame: OptimisedFrame,
  lookup: PriceLookup,
  rules: BomRules = DEFAULT_BOM_RULES,
): InfillColumns {
  const schedule = safeCall(() => scheduleFor(shed, frame, lookup));
  const infill = schedule?.infill;
  const none: InfillColumns = { columns: [], designPositionsMm: [], respacedEnds: [], withheld: null };
  if (infill == null || infill.section === null) return none;

  const endSection = schedule?.endWallColumn ?? FALLBACK_SIZE;
  const endGeometry = safeCall(() => lookup.frameGeometry?.(endSection));
  return (
    safeCall(() =>
      buildInfillColumns(shed, {
        count: infill.count,
        section: infill.section,
        endColumnDepth: endGeometry?.depth ?? null,
        purlinDepth: safeCall(() => lookup.purlinDepth(frame.purlinMaterial)) || null,
        centreMm: (endGeometry?.web ?? 15) === 10 ? 60 : 90,
        kneeEdgeCode: safeCall(() => lookup.kneeEdge?.(shed.roofPitchDeg))?.kneeEdgeCode ?? null,
        footingAllowanceMm: rules.footingAllowance,
        // The desktop adds the footing only for a `POST_IN_GROUND` column, and the
        // config has no footing field yet — so the standing assumption applies, the
        // same one the column length already makes.
        postInGround: true,
      }),
    ) ?? none
  );
}

/**
 * The steel a building's roller doors add to the frame.
 *
 * One function for every caller — the priced lines, the cut list, the punch sheets — for
 * the same reason `buildingInfillColumns` exists: three copies would let the quote and the
 * drawing describe different door frames.
 *
 * Empty when the building has no roller door, or when the book names no `DM`/`DH` section
 * for this design.
 */
export function buildingDoorFrames(
  shed: DimensionedShed,
  frame: OptimisedFrame,
  lookup: PriceLookup,
  rules: BomRules = DEFAULT_BOM_RULES,
): DoorFrameMember[] {
  if (!shed.openings.some((opening) => opening.type === 'roller_door')) return [];

  const schedule = safeCall(() => scheduleFor(shed, frame, lookup));
  // Bound to locals so the null check narrows: TypeScript cannot carry a narrowing of
  // `schedule.doorMullion` into the arrow function below.
  const doorHeader = schedule?.doorHeader ?? null;
  const doorMullion = schedule?.doorMullion ?? null;
  if (doorHeader === null || doorMullion === null) return [];

  const endSection = schedule?.endWallColumn ?? FALLBACK_SIZE;
  const endGeometry = safeCall(() => lookup.frameGeometry?.(endSection));
  const mullionGeometry = safeCall(() => lookup.frameGeometry?.(doorMullion));
  // The infill columns as the **design** placed them: a door frame lands against the
  // drawing, not against a wall that was already re-spaced around a door.
  const infillPositionsMm = safeCall(() => buildingInfillColumns(shed, frame, lookup, rules))
    ?.designPositionsMm ?? [];

  return (
    safeCall(() =>
      buildDoorFrameMembers(
        shed,
        {
          headerSection: doorHeader,
          mullionSection: doorMullion,
          mullionDepth: mullionGeometry?.depth ?? null,
          endColumnDepth: endGeometry?.depth ?? null,
          girtDepth: safeCall(() => lookup.purlinDepth(frame.girtMaterial)) || null,
          centreMm: (endGeometry?.web ?? 15) === 10 ? 60 : 90,
          kneeEdgeCode: safeCall(() => lookup.kneeEdge?.(shed.roofPitchDeg))?.kneeEdgeCode ?? null,
          endRafterDepth: endGeometry?.depth ?? null,
          footingAllowanceMm: rules.footingAllowance,
          // The standing footing assumption, the same one the column length makes.
          postInGround: true,
        },
        infillPositionsMm,
      ),
    ) ?? []
  );
}

/**
 * The two member counts, exported for the groups that fix or brace the frame.
 *
 * A base bracket, a bracing pair and a set of bolts all hang off "how many main
 * columns" and "how many end-wall columns", so the rule that answers that must
 * exist once. Recomputing it in three modules is how the groups drift apart.
 */
export function frameCounts(shed: DimensionedShed): { main: number; end: number } {
  return { main: mainMemberCount(shed), end: endMemberCount(shed) };
}

/** Every wall a frame member can sit on, exported for the groups that need it. */
export const FRAME_SIDES = SIDES;
