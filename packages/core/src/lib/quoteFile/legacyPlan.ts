/**
 * Turning a legacy `.sqd` revision into a building this build can edit.
 *
 * ## The one rule
 *
 * **The file's money is never used.** `ContractPrice`, `BuildingCost`, `TotalPrice` and the rest were
 * computed by the desktop from a book that may be years older than this one, with a margin nobody
 * recorded. Importing them would create a revision whose `engine_version` and `price_book_hash`
 * describe a calculation that never happened — the exact failure the whole product exists to avoid.
 * So this module reads the **building** and nothing else; the engine re-prices it and the operator
 * saves what this build stands behind. The file's own figure is returned separately, so a screen can
 * show the two side by side and explain the difference.
 *
 * ## What is carried, and what is not
 *
 * Carried: the shell (span, height, bays, length, pitch, structure), the site conditions the price
 * table is indexed by (wind region, terrain, importance, shielding, state), the sheeting and footing
 * codes, the wall-open switches, the twelve colours and `MiscOptions` catalogue lines, plus the four
 * opening kinds on every wall.
 *
 * Not carried: skylights, mezzanines, awnings, stables, outriggers, carry beams, tracks, dividing
 * walls, cantilevers and infill columns. Each is a shape with its own geometry on the old plan, and
 * converting them without the old drawing to check against would put an object in the wrong place
 * and quote it. They are **reported by name and count** so the operator adds them back deliberately;
 * silently dropping them would quote a shed without its skylights.
 *
 * ## Why the plan is rotated, and why the wall names look wrong
 *
 * The desktop draws the bays along its X axis and calls the two long walls **front** and **rear**,
 * with the two gable ends **left** and **right** (`MSideWall` / `MEndWall`, `EDirection`). This build
 * puts the span on x and the length on y, so the long walls are `left`/`right` and the ends are
 * `front`/`back` — the same rotation, with the labels swapped.
 *
 * Which end of the old plan becomes `front` cannot be derived from the file: it stores no absolute
 * coordinates for the end walls. The pairing below is therefore a **convention**, reported to the
 * operator as an assumption. If the plan comes out mirrored, drag the opening to the other end; the
 * price does not change for a door of the same size on the same kind of wall, but the drawing must
 * match the one the customer was sent.
 */

import { COLORBOND } from '@/domain/defaults';
import { parseSheeting } from '@/domain/sheeting';
import type { Opening, ShedColors, WallSide } from '@/domain/types';
import type { RawRevision } from './sqd';

/** A field the import left behind, in words an operator can act on. */
export interface LegacyNote {
  what: string;
  detail: string;
  /** How many of them, when the note is a group of identical objects. */
  count?: number;
}

/** The customer as the old file holds it, shaped for this build's draft. */
export interface LegacyCustomer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  mobile: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
}

/** The site, which the old file keeps apart from the customer. */
export interface LegacySite {
  address: string;
  suburb: string;
  state: string;
  postcode: string;
}

/** Everything a screen needs to show the file, and to open it in the editor. */
export interface LegacyPlan {
  /** A `ShedConfig`-shaped object. Unnormalised: the editor normalises on apply. */
  config: Record<string, unknown>;
  /** What came across, as short statements. */
  carried: string[];
  /** What did not come across, and why. */
  dropped: LegacyNote[];
  /** What this build had to decide, which the operator should check. */
  assumed: LegacyNote[];
  customer: LegacyCustomer;
  site: LegacySite;
  /** The file's own claim, so a screen can put it next to the new price. */
  claimed: { revisionName: string; quoteNumber: string; contractDollars: number | null };
}

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A finite number, or `undefined`. */
function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** A trimmed non-empty string, or `''`. */
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** An array, or `[]`. */
function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * The legacy structure codes this build can name.
 *
 * The file stores the price book's own `structure_sub_code` (`GB_TH64`, `SB_TH64`, `GC`, …) or, in
 * older files, a short code the desktop's own lookup resolves. The values below are the sub-codes;
 * the four-letter forms with a trailing digit (`GC2`, `SC2`) are the carport series the desktop
 * writes in some builds. Anything else is reported rather than guessed: a gable priced as a skillion
 * is a different roof, not a rounding error.
 */
const STRUCTURE_OF_CODE: Record<string, string> = {
  GB_TH64: 'gable',
  GB_TH96: 'tophot_96',
  GB_Z150: 'zed_shed',
  GB_Z100: 'cyclonic',
  GB_AH: 'aircraft_hangar',
  GB_AW: 'gable',
  SB_TH64: 'skillion',
  GC: 'gable_carport',
  GC2: 'gable_carport',
  SC: 'skillion_carport',
  SC2: 'skillion_carport',
  CGB: 'gable',
  CSB: 'skillion',
};

/**
 * The long walls. The desktop calls them front and rear; this build calls them left and right.
 *
 * A convention, not a derivation — see the module comment.
 */
const SIDE_WALL: Record<'front' | 'rear', WallSide> = { front: 'left', rear: 'right' };

/** The gable ends. The desktop calls them left and right; this build calls them front and back. */
const END_WALL: Record<'left' | 'right', WallSide> = { left: 'front', right: 'back' };

/** The eight states the price book spells. */
const STATES: readonly string[] = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

/** A `#rrggbb` string, or `undefined`. */
function hex(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : undefined;
}

/**
 * One colour role from the file's `ColorOption` block.
 *
 * The name is preferred over the hex: this build's price book prices flashing and screws **by
 * colour**, so a name that matches the book is worth more than a value copied from an older book. A
 * name the book does not list falls back to the file's own hex, and then to the default.
 */
function colour(option: unknown, fallback: string): string {
  if (!isRecord(option)) return fallback;
  const name = str(option.Name);
  if (name !== '' && COLORBOND[name] !== undefined) return COLORBOND[name];
  return hex(option.Value) ?? fallback;
}

/** A colour role read from the legacy block by its old key. */
function colourRole(block: Record<string, unknown>, key: string, fallback: string): string {
  return colour(block[key], fallback);
}

/** The number of bays the file describes, and their starts and widths along the length. */
interface Bays {
  count: number;
  length: number;
  starts: number[];
  widths: number[];
  /** True when the file's bays are not all the same length. */
  uneven: boolean;
}

/**
 * Read the bay list.
 *
 * The desktop writes one entry per bay **plus a sentinel** whose `Length` is 0 and whose `Index`
 * repeats the last real bay — `NumberOfBays` indexes into `Bays`, so the list has `n + 1` entries.
 * Counting the array length therefore reports one bay too many, which is why the real bays are the
 * entries with a positive length.
 */
function readBays(plan: Record<string, unknown>): Bays | null {
  const entries = arr(plan.Bays).filter(isRecord);
  const real = entries.filter((entry) => (num(entry.Length) ?? 0) > 0);
  if (real.length === 0) return null;

  const widths = real.map((entry) => Math.round(num(entry.Length) ?? 0));
  let cursor = 0;
  const starts = widths.map((width) => {
    const start = cursor;
    cursor += width;
    return start;
  });

  const first = widths[0] ?? 0;
  return {
    count: widths.length,
    length: widths.reduce((sum, width) => sum + width, 0),
    starts,
    widths,
    uneven: widths.some((width) => width !== first),
  };
}

/** An opening built from a legacy option, before it is normalised. */
interface BuiltOpening {
  opening: Opening;
  /** Which legacy group it came from, for the report. */
  kind: string;
}

/**
 * The legacy option groups that name a shape this module does not build.
 *
 * Reported with their counts so the operator can see what is missing. Named after the desktop's own
 * groups, so the list reads like the old screen.
 */
const OPTION_GROUPS: Record<string, string> = {
  SkylightOptions: 'Skylight',
  MezzamineOptions: 'Mezzanine',
  StableOptions: 'Stable',
  OutTriggerOptions: 'Outrigger',
  CarryBeamOptions: 'Carry beam',
  DoubleTrackOptions: 'Double track',
  DoubleTrackInBayOptions: 'Double track (in bay)',
  Track1Options: 'Track',
  EmptySDTrackOptions: 'Empty track',
  DividingWallOptions: 'Dividing wall',
  CantileverOptions: 'Cantilever',
};

/** The four opening groups the desktop writes, named as a person speaks them. */
const OPENING_LABEL: Record<string, string> = {
  RDoorOptions: 'roller door',
  PADoorOptions: 'PA door',
  SlidingDoorOptions: 'sliding door',
  WindowOptions: 'window',
};

/** Where an opening sits on its wall, and which wall that is. */
interface Placement {
  wall: WallSide;
  /** Offset of the wall's start along the length axis, when the legacy X is bay-local. */
  bayStart: number;
  /** The bay's own width, so a bay-local offset can be told from an absolute one. */
  bayWidth: number;
}

/**
 * Read one wall-length offset into a wall-local `u`.
 *
 * A side wall stores its options per bay, and the desktop measures `RelativeLocation.X` from the
 * **start of that bay** (`RLDoorAddToSWallCmd` compares it with `bay2D.Width`). Some builds write the
 * absolute offset instead. Both are handled without a flag: a bay-local value is always at most the
 * bay's width, and an absolute value in a later bay is always larger.
 */
function wallOffset(x: number, place: Placement): number {
  return Math.round(x <= place.bayWidth ? place.bayStart + x : x);
}

/** A roller door's series, when the file names one this build prices. */
function series(value: unknown): 'A' | 'AA' | 'B' | null {
  const text = str(value).toUpperCase();
  return text === 'A' || text === 'AA' || text === 'B' ? text : null;
}

/**
 * The openings on one wall group.
 *
 * Every legacy option part records the opening's left edge in `RelativeLocation.X` and its sill in
 * `RelativeLocation.Y` — a window in the sample file sits at Y 1200 with a 790-high sash, and doors
 * at 0. `AlignTo` is not used: the stored X already says where the opening is, and re-deriving a
 * centre would move a door that the old plan had off-centre.
 */
function readOpenings(
  parts: unknown,
  place: Placement,
  dropped: LegacyNote[],
  assumed: LegacyNote[],
): BuiltOpening[] {
  if (!isRecord(parts)) return [];
  const built: BuiltOpening[] = [];

  const build = (
    kind: 'roller_door' | 'pa_door' | 'sliding_door' | 'window',
    entry: unknown,
  ): Opening | null => {
    if (!isRecord(entry)) return null;
    const part = isRecord(entry.OptionPart) ? entry.OptionPart : {};
    const location = isRecord(part.RelativeLocation) ? part.RelativeLocation : {};
    const width = Math.round(num(entry.Width) ?? 0);
    const height = Math.round(num(entry.Height) ?? 0);
    if (width <= 0 || height <= 0) {
      dropped.push({
        what: `A ${kind.replace(/_/g, ' ')} with no size`,
        detail: 'The file records no width or height for it, so it was not placed. Add it in the editor.',
      });
      return null;
    }

    const x = num(location.X) ?? 0;
    const sill = Math.max(0, Math.round(num(location.Y) ?? 0));
    const common = {
      id: '',
      width,
      height,
      sill,
      wall: place.wall,
      align: 'custom',
      offset: wallOffset(x, place),
      swing: null,
      prepOnly: entry.PrepOnly === true,
      sku: null,
    } satisfies Omit<Opening, 'type' | 'track'>;

    switch (kind) {
      case 'roller_door':
        return {
          ...common,
          type: 'roller_door',
          track: null,
          series: series(entry.RDoorType),
          windlock: entry.WindLock === true,
        };
      case 'pa_door':
        return { ...common, type: 'pa_door', track: null, sku: str(entry.PADoorType) || null };
      case 'sliding_door': {
        const reserves = arr(entry.TrackReserves)
          .map((value) => Math.round(num(value) ?? 0))
          .filter((value) => value > 0);
        /*
         * `ESlidingDoorType` is a track geometry (Inner, Outer, DoubleInSingleBay,
         * SingleInSingleBay), not a count. The count is the track reserve list the desktop writes for
         * it; without one, the door is a single-track door.
         */
        const segments = Math.max(1, reserves.length);
        const type = num(entry.SDType);
        if (type === 0 || type === 1) {
          assumed.push({
            what: 'A sliding door track position',
            detail:
              'The old file records an inner or outer track. This build does not model which side the track sits on, so the door was placed on a single track.',
          });
        }
        return {
          ...common,
          type: 'sliding_door',
          track: segments > 1 || type === 2 ? 'double' : 'single',
          trackSegments: segments,
          trackWidth: Math.round(reserves[0] ?? width),
        };
      }
      case 'window':
        return { ...common, type: 'window', track: null, sku: str(entry.WindowType) || null };
    }
  };

  const take = (group: string, kind: Parameters<typeof build>[0]): void => {
    for (const entry of arr(parts[group])) {
      const opening = build(kind, entry);
      if (opening !== null) built.push({ opening, kind: group });
    }
  };

  take('RDoorOptions', 'roller_door');
  take('PADoorOptions', 'pa_door');
  take('SlidingDoorOptions', 'sliding_door');
  take('WindowOptions', 'window');

  /*
   * `EmptyOptions` is the desktop's "opening only" hole — a wall cut with no door in it. This build
   * has the type, but the legacy entry carries no size of its own: the hole is whatever the option's
   * frame is, which the file does not state. It is reported rather than guessed, because a hole
   * without a door changes the sheeting and the infill columns.
   */
  const empty = arr(parts.EmptyOptions).length;
  if (empty > 0) {
    dropped.push({
      what: 'An opening with no door in it',
      detail:
        'The old file records a cut opening but not its size. Add it in the editor as an "Opening" so the sheeting and columns it affects are priced.',
      count: empty,
    });
  }

  return built;
}

/** A wall group's own options, plus one entry per bay for a side wall. */
function readWall(
  wall: unknown,
  isSide: boolean,
  bays: Bays,
  dropped: LegacyNote[],
  assumed: LegacyNote[],
): BuiltOpening[] {
  if (!isRecord(wall)) return [];
  const found: BuiltOpening[] = [];

  /*
   * An end wall has no bays and measures `RelativeLocation.X` from its own corner, so every X is
   * already wall-local. `bayWidth: Infinity` says exactly that: never add a bay start.
   */
  const wholeWall: Placement = {
    wall: isSide ? wallOfSide(wall) : wallOfEnd(wall),
    bayStart: 0,
    bayWidth: Number.POSITIVE_INFINITY,
  };

  if (!isSide) {
    found.push(...readOpenings(wall.OptionParts, wholeWall, dropped, assumed));
    return found;
  }

  for (const sub of arr(wall.SubWalls)) {
    if (!isRecord(sub)) continue;
    const index = num(sub.Index) ?? 0;
    const bayStart = bays.starts[index] ?? 0;
    const bayWidth = bays.widths[index] ?? bays.length;
    found.push(...readOpenings(sub.OptionParts, { ...wholeWall, bayStart, bayWidth }, dropped, assumed));
  }

  /*
   * A side wall may also carry options outside any bay — a door on a wall the operator extended. Read
   * them from the wall's own corner rather than dropping them silently.
   */
  if (arr(wall.SubWalls).length === 0) {
    found.push(...readOpenings(wall.OptionParts, wholeWall, dropped, assumed));
  }

  return found;
}

/** The v2 wall for a legacy side wall, from its own `Direction` when it has one. */
function wallOfSide(wall: Record<string, unknown>): WallSide {
  // `EDirection`: Front = 0, Back = 1.
  return num(wall.Direction) === 1 ? SIDE_WALL.rear : SIDE_WALL.front;
}

/** The v2 wall for a legacy end wall, from `IsLeft`. */
function wallOfEnd(wall: Record<string, unknown>): WallSide {
  return wall.IsLeft === true ? END_WALL.left : END_WALL.right;
}

/**
 * Read a revision's building.
 *
 * Returns `null` when the revision carries no `HousePlan.BuildingPlan` at all — a file written by
 * something other than the quote screen has nothing to import, and a default shed would be a
 * fabricated building rather than a converted one.
 */
export function readLegacyPlan(revision: RawRevision): LegacyPlan | null {
  const housePlan = revision.HousePlan;
  if (!isRecord(housePlan)) return null;
  const plan = housePlan.BuildingPlan;
  if (!isRecord(plan)) return null;

  const dropped: LegacyNote[] = [];
  const assumed: LegacyNote[] = [];
  const carried: string[] = [];

  const bays = readBays(plan);
  const span = Math.round(num(plan.Width) ?? num(housePlan.Width) ?? 0);
  const height = Math.round(num(plan.Height) ?? num(housePlan.Height) ?? 0);

  if (bays === null || span <= 0 || height <= 0) {
    dropped.push({
      what: 'The whole building',
      detail:
        'The file records no usable span, height or bay list, so there is no building to convert. Re-key it.',
    });
    return null;
  }

  /*
   * The bays, kept **as the file states them**.
   *
   * This used to collapse them: 4 000 / 4 000 / 6 000 became three equal bays and the mismatch was
   * reported as an assumption. That was right while the editor could only describe equal bays, and it
   * is wrong now that `bayWidths` exists — the cascade matters, because the frame table is keyed by the
   * **largest** bay, so a collapsed building takes a different row from the one the desktop quoted.
   *
   * `NormalBaySize` is still read for the nominal spacing, which is the spacing the operator typed and
   * which the desktop leaves alone once a bay is edited.
   */
  const typedSpacing = Math.round(num(plan.NormalBaySize) ?? 0);
  const nomBaySpacing = typedSpacing > 0 ? typedSpacing : Math.floor(bays.length / bays.count);
  if (bays.uneven) {
    /*
     * Still reported, but now as information rather than a lost fact: the plan's bays are being
     * carried over exactly, and this says what they are so the operator can confirm them.
     */
    assumed.push({
      what: 'Bay spacing',
      detail: `The old plan's bays are ${bays.widths.join(' / ')} mm and have been carried over as they are. The steel frame is sized from the longest one.`,
    });
  } else if (typedSpacing > 0 && typedSpacing * bays.count !== bays.length) {
    assumed.push({
      what: 'Bay spacing',
      detail: `The old plan types a ${typedSpacing} mm spacing but its bays add up to ${bays.length} mm. The bays are used as they are; the nominal spacing is the typed figure.`,
    });
  }

  const openings: Opening[] = [];
  const byKind = new Map<string, number>();
  const collect = (found: BuiltOpening[]): void => {
    for (const { opening, kind } of found) {
      openings.push(opening);
      byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    }
  };

  const endWalls = arr(plan.EndWalls).filter(isRecord);
  const leftEnd = endWalls.find((wall) => wall.IsLeft === true) ?? endWalls[0];
  const rightEnd = endWalls.find((wall) => wall.IsLeft !== true) ?? endWalls[1];
  collect(readWall(leftEnd, false, bays, dropped, assumed));
  collect(readWall(rightEnd, false, bays, dropped, assumed));
  collect(readWall(plan.FrontWall, true, bays, dropped, assumed));
  collect(readWall(plan.RearWall, true, bays, dropped, assumed));

  const openingsWithIds = openings.map((opening, index) => ({ ...opening, id: `legacy-${index + 1}` }));
  for (const [kind, count] of byKind) {
    carried.push(`${count} × ${OPENING_LABEL[kind] ?? kind}`);
  }

  /*
   * Options this module does not build, grouped over every wall and the plan itself, so the report
   * says "Skylight × 2" once rather than once per wall.
   */
  const optionCounts = new Map<string, number>();
  const countGroup = (parts: unknown): void => {
    if (!isRecord(parts)) return;
    for (const [group, label] of Object.entries(OPTION_GROUPS)) {
      const count = arr(parts[group]).length;
      if (count > 0) optionCounts.set(label, (optionCounts.get(label) ?? 0) + count);
    }
  };
  countGroup(housePlan.OptionParts);
  countGroup(plan.FrontWall && isRecord(plan.FrontWall) ? plan.FrontWall.OptionParts : undefined);
  countGroup(plan.RearWall && isRecord(plan.RearWall) ? plan.RearWall.OptionParts : undefined);
  for (const wall of endWalls) countGroup(wall.OptionParts);
  for (const wall of [plan.FrontWall, plan.RearWall]) {
    if (!isRecord(wall)) continue;
    for (const sub of arr(wall.SubWalls)) {
      if (isRecord(sub)) countGroup(sub.OptionParts);
    }
  }
  for (const [label, count] of optionCounts) {
    dropped.push({
      what: label,
      detail: 'This build does not convert it from the old plan. Add it in the editor if the quote had one.',
      count,
    });
  }

  const structureCode = str(plan.StructureType);
  const structure = STRUCTURE_OF_CODE[structureCode];
  if (structure === undefined) {
    assumed.push({
      what: 'Structure type',
      detail:
        structureCode === ''
          ? 'The file names no structure, so this is a gable — the default. Change it if the old quote was a skillion or a carport.'
          : `The file names structure "${structureCode}", which this build does not recognise. It was opened as a gable; change it if that is wrong.`,
    });
    carried.push('Structure (as a gable — see what this build assumed)');
  } else {
    carried.push(`Structure ${structure}`);
  }

  const windRegionRaw = str(plan.WindRegion).toUpperCase();
  const windRegion = ['A', 'B', 'C', 'D'].includes(windRegionRaw) ? windRegionRaw : undefined;
  if (windRegion === undefined) {
    dropped.push({
      what: 'Wind region',
      detail:
        'The file has no wind region — it was likely never ShedSafe-checked. Set it from the site check, because the purlin and girt spans are indexed by it.',
    });
  }

  const terrainRaw = num(plan.TerrainCategory);
  const terrain = terrainRaw === 2 || terrainRaw === 2.5 || terrainRaw === 3 ? terrainRaw : undefined;

  const importanceRaw = num(plan.ImportanceLevel);
  const importance = importanceRaw === 2 ? 2 : importanceRaw === 1 ? 1 : undefined;

  const stateRaw = str(plan.StateCode).toUpperCase();
  const state = STATES.includes(stateRaw) ? stateRaw : undefined;

  const shieldingRaw = num(plan.Shielding);
  // The book's shielding multiplier runs 0.8–1.0; anything outside it is not a value this build can
  // price, and 1 (no shielding) is the conservative reading of a value that cannot be trusted.
  const shielding =
    shieldingRaw !== undefined && shieldingRaw >= 0.8 && shieldingRaw <= 1 ? shieldingRaw : undefined;

  /*
   * A site value the file states but this build cannot price. Silence would hide it: quoting terrain
   * 2 for a site the old quote called category 3 under-prices the purlins, and the operator has no
   * way to notice from the screen.
   */
  const unusableSite = [
    terrainRaw !== undefined && terrain === undefined ? `terrain category ${terrainRaw}` : '',
    importanceRaw !== undefined && importance === undefined ? `importance level ${importanceRaw}` : '',
    stateRaw !== '' && state === undefined ? `state "${stateRaw}"` : '',
    shieldingRaw !== undefined && shielding === undefined ? `shielding ${shieldingRaw}` : '',
  ].filter((entry) => entry !== '');
  if (unusableSite.length > 0) {
    assumed.push({
      what: 'Site conditions',
      detail: `The file states ${unusableSite.join(', ')}, which this build's price book has no row for. The nearest standard value was used; check the site details before you save.`,
    });
  }

  const colorOption = isRecord(plan.ColorOption) ? plan.ColorOption : {};
  const colors: ShedColors = {
    wall: colourRole(colorOption, 'WallColor', '#B7BCC0'),
    roof: colourRole(colorOption, 'RoofColor', '#D5CFC5'),
    barge: colourRole(colorOption, 'BargeColor', '#D5CFC5'),
    downpipe: colourRole(colorOption, 'DownpipeColor', '#D5CFC5'),
    gutter: colourRole(colorOption, 'GutterColor', '#D5CFC5'),
    window: colourRole(colorOption, 'WindowColor', '#2B2B2B'),
    paDoor: colourRole(colorOption, 'PADoorColor', '#2B2B2B'),
    rollerDoor: colourRole(colorOption, 'RollerDoorColor', '#2B2B2B'),
    slidingDoor: colourRole(colorOption, 'SlidingDoorColor', '#2B2B2B'),
    dividingWall: colourRole(colorOption, 'DividingWallColor', '#D5CFC5'),
  };
  if (Object.keys(colorOption).length > 0) carried.push('Colours');

  /*
   * Wall-open switches. The file records them per bay on a side wall; this build has one switch for
   * the whole side, so a side that is open in some bays and closed in others cannot be represented.
   */
  const sideOpen = (wall: unknown): boolean => {
    if (!isRecord(wall)) return false;
    const subs = arr(wall.SubWalls).filter(isRecord);
    if (subs.length === 0) return false;
    const open = subs.filter((sub) => sub.Open === true).length;
    if (open > 0 && open < subs.length) {
      assumed.push({
        what: 'An open side wall',
        detail: `The old plan has ${open} of ${subs.length} bays on one side open. This build opens a whole side or none of it, so the side is opened.`,
      });
    }
    return open > 0;
  };

  const endOpen = (wall: unknown): boolean => isRecord(wall) && wall.IsOpen === true;

  const misc: Record<string, unknown>[] = [];
  for (const entry of arr(revision.MiscOptions)) {
    if (!isRecord(entry)) continue;
    const item = isRecord(entry.Item) ? entry.Item : {};
    const name = str(item.Size) || str(item.ProductCode);
    const quantity = num(entry.Quantity) ?? 0;
    if (name === '' || quantity <= 0) continue;
    misc.push({
      id: '',
      kind: 'misc_option',
      name,
      quantity,
      unit: str(item.Unit) || str(entry.Unit) || 'ea',
    });
  }
  if (misc.length > 0) carried.push(`${misc.length} × catalogue line`);

  const otherColours = ['TrimColor', 'FlashingColor'].filter((key) => isRecord(colorOption[key]));
  if (otherColours.length > 0) {
    dropped.push({
      what: otherColours.length === 1 ? 'One trim colour' : 'Trim and flashing colours',
      detail: 'This build has no separate trim or flashing role; both take the barge colour. Check the colour on the plan.',
    });
  }

  const config: Record<string, unknown> = {
    structureType: structure ?? 'gable',
    span,
    length: bays.length,
    height,
    bays: bays.count,
    /*
     * The bay lengths, in the file's order. `normaliseShedConfig` keeps them only when the count,
     * positivity and total all agree with the rest of the building, so a file that says one thing in
     * `Bays` and another in `Width` loses the array rather than pricing from it.
     */
    ...(bays.uneven ? { bayWidths: bays.widths } : {}),
    nomBaySpacing,
    roofPitchDeg: Math.round((num(plan.RoofPitch) ?? 0) * 10) / 10,
    openings: openingsWithIds,
    options: misc,
    charges: [],
    internalPressure: plan.OpenDesign === true ? 'open' : 'closed',
    windRegion: windRegion ?? 'A',
    terrainCategory: terrain ?? 2,
    shieldingFactor: shielding ?? 1,
    importanceLevel: importance ?? 1,
    topographyFactor: 1,
    stateCode: state ?? 'QLD',
    /*
     * The `.sqd` joins profile and thickness (`'0.35 TL-5'`), and the book's lookup is keyed by the
     * pair — a joined string matches no row, so every imported shed priced its sheeting as a mocked
     * line. `parseSheeting` splits them; measured on the reference book, `'0.35 TL-5'` as a profile
     * returns `NO ROW` while `{ profile: 'TL-5', bmt: 0.35 }` returns TL35 at $9.06.
     */
    wallProfile: parseSheeting(str(plan.WallSheeting)).profile,
    wallBmt: parseSheeting(str(plan.WallSheeting)).bmtMm,
    roofProfile: parseSheeting(str(plan.RoofSheeting)).profile,
    roofBmt: parseSheeting(str(plan.RoofSheeting)).bmtMm,
    downpipeType: str(plan.DownpipeType),
    footingType: str(plan.FootingType),
    footingSubType: str(plan.FootingSubType),
    endOpening: { left: endOpen(leftEnd), right: endOpen(rightEnd) },
    sideOpening: { front: sideOpen(plan.FrontWall), back: sideOpen(plan.RearWall) },
    colors,
  };

  carried.unshift(
    `Span ${span} mm × length ${bays.length} mm × wall ${height} mm`,
    `${bays.count} bays at ${nomBaySpacing} mm`,
    `Roof pitch ${(num(plan.RoofPitch) ?? 0).toFixed(1)}°`,
  );
  if (windRegion !== undefined) {
    carried.push(
      `Site: wind ${windRegion}, terrain ${terrain ?? 'assumed 2'}, importance ${importance ?? 1}`,
    );
  }

  if (openingsWithIds.length > 0) {
    assumed.push({
      what: 'Which end of the old plan is the front',
      detail:
        'The old drawing runs the bays left-to-right and calls the long walls front and rear. This build runs the span across and calls the same two walls left and right, so the ends are paired by convention. If the plan looks mirrored, drag each opening to the other end.',
    });
  }

  assumed.push({
    what: "The file's own price was ignored",
    detail:
      'The old total came from an older price book with a margin nobody recorded. This building is re-priced from the current book when it opens, and that is the figure to quote.',
  });

  const customerData = isRecord(revision.CustomerData) ? revision.CustomerData : {};
  const customer: LegacyCustomer = {
    firstName: str(customerData.FirstName),
    lastName: str(customerData.LastName),
    email: str(customerData.Email),
    phone: str(customerData.HomePhone),
    mobile: str(customerData.MobilePhone),
    address: str(customerData.Address),
    suburb: str(customerData.CustomerSurburbString),
    state: str(customerData.CustomerStateString),
    postcode: str(customerData.CustomerPostCodeString),
  };

  const site: LegacySite = {
    address: str(customerData.SiteAddress) || str(customerData.Address),
    suburb: str(customerData.SiteSurburbString),
    state: str(customerData.SiteStateString),
    postcode: str(customerData.SitePostCodeString),
  };

  const price = num(revision.ContractPrice);

  return {
    config,
    carried,
    dropped,
    assumed,
    customer,
    site,
    claimed: {
      revisionName: str(revision.RevisionName) || `Revision ${revision.RevisionId ?? 1}`,
      quoteNumber: str(revision.QuoteNumber),
      contractDollars: typeof price === 'number' ? price : null,
    },
  };
}

/** The newest revision that carries a building, so an import starts from the quote's latest state. */
export function readNewestLegacyPlan(revisions: readonly RawRevision[]): LegacyPlan | null {
  for (let index = revisions.length - 1; index >= 0; index -= 1) {
    const revision = revisions[index];
    if (revision === undefined) continue;
    const plan = readLegacyPlan(revision);
    if (plan !== null) return plan;
  }
  return null;
}

/** Exported for the report's own tests: the legacy wall a v2 wall came from. */
export const WALL_CONVENTION = {
  side: SIDE_WALL,
  end: END_WALL,
} as const;
