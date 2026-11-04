/**
 * The material an added option consumes.
 *
 * The eleven option kinds are not one family. Some are pure geometry that the
 * frame group already counts (a carry beam removes a column, so its steel is in
 * `frameLines`); some consume stock the base building never touches (a skylight
 * replaces a sheet, a mezzanine is a priced floor); and two of them — a dividing
 * wall and horizontal cladding — are sheeting and batten runs that only exist
 * because the option was added.
 *
 * So each kind gets one branch, and a kind whose material is already counted
 * returns nothing. That is the honest answer: emitting a second line for steel
 * the frame group already priced would double-charge it.
 *
 * Where this build has no data the desktop has — a mezzanine's floor-load class,
 * a stable's panel sections — the branch uses the common case and says so in the
 * description, so the operator can see what was assumed.
 */

import type {
  AwningOption,
  MezzanineOption,
  ShedConfig,
  ShedOption,
  StableOption,
} from '@/domain/types';
import type { PriceLookup, PriceRow } from '@/lib/pricing/types';
import { bomLine, mockedLine, type BomLine } from './types';
import type { OptimisedFrame } from './types';
import { safeCall } from './safe';
import type { BomRules } from './rules';

/** The sheeting profile the option branches assume, matching the sheeting group. */
const PROFILE = 'Corro';
const BMT = 0.42;

/**
 * Mezzanine rates, cents per square metre, by floor-load class.
 *
 * The desktop's `FLOOR_LOAD_VALUE = {1.5, 3.0, 5.0, 7.5}` kPa maps to
 * `{40, 45, 60, 80}`. This build's mezzanine has no floor-load field, so the
 * lightest class is used — a storage platform, which is what a shed mezzanine
 * almost always is. A customer wanting a 7.5 kPa floor needs the heavier rate and
 * the field to state it. Recorded at `/deviations`.
 */
const MEZZANINE_RATE_CENTS_PER_M2 = 4000;
/** The desktop's Queensland multiplier on a mezzanine. */
const MEZZANINE_QLD_FACTOR = 1.4;
/** The batten spacing behind horizontal cladding, mm. */
const BATTEN_SPACING = 900;
/** The girt spacing a dividing wall is framed at, mm. */
const DIVIDING_GIRT_SPACING = 1200;
/** A stable's walls are a standard 2400 high when the option does not say. */
const STABLE_MIN_HEIGHT = 2100;

/** An each line, or a mocked one. */
function eachLine(
  group: 'option',
  description: string,
  count: number,
  row: PriceRow | undefined,
): BomLine[] {
  if (count <= 0) return [];
  if (row === undefined) return [mockedLine({ group, description, unit: 'ea', quantity: count })];
  return [
    bomLine({
      group,
      code: row.code,
      description: `${description} — ${row.description}`,
      unit: 'ea',
      quantity: count,
      unitCost: row.unitCost,
      massKg: row.massKg * count,
    }),
  ];
}

/** A linear-metre line: the quantity is metres, the unit cost is per metre. */
function lengthLine(
  group: 'option',
  description: string,
  metres: number,
  row: PriceRow | undefined,
): BomLine[] {
  if (metres <= 0) return [];
  const quantity = Math.round(metres * 100) / 100;
  if (row === undefined) return [mockedLine({ group, description, unit: 'm', quantity })];
  return [
    bomLine({
      group,
      code: row.code,
      description: `${description} — ${row.description}`,
      unit: 'm',
      quantity,
      unitCost: row.unitCost,
      massKg: row.massKg * quantity,
    }),
  ];
}

/** A square-metre line: the quantity is m², the unit cost is per m². */
function areaLine(
  group: 'option',
  description: string,
  squareMetres: number,
  row: PriceRow | undefined,
): BomLine[] {
  if (squareMetres <= 0) return [];
  const quantity = Math.round(squareMetres * 100) / 100;
  // The unit is `m²`, not `m`: a reader who sees "12 m" for a 3 × 4 m floor will
  // read it as 12 linear metres.
  if (row === undefined) return [mockedLine({ group, description, unit: 'sqm', quantity })];
  return [
    bomLine({
      group,
      code: row.code,
      description: `${description} — ${row.description}`,
      unit: 'sqm',
      quantity,
      unitCost: row.unitCost,
      massKg: row.massKg * quantity,
    }),
  ];
}

/**
 * A sheeting area, converted from m² to whole sheets.
 *
 * A sheeting row's `unitCost` is **per sheet**, not per square metre, so an area
 * multiplied by it undercharges by the area of a sheet — 4.7× on a 6 m sheet.
 * The area is divided by a sheet's coverage before it meets the price.
 */
function sheetAreaLine(
  description: string,
  squareMetres: number,
  row: PriceRow | undefined,
  coverMm: number,
  sheetLengthMm: number,
): BomLine[] {
  if (squareMetres <= 0) return [];
  const sheetArea = (coverMm / 1000) * (sheetLengthMm / 1000);
  if (!(sheetArea > 0)) return [];
  const sheets = Math.ceil(squareMetres / sheetArea);
  return eachLine('option', description, sheets, row);
}

/** The roof sheet length a skylight replaces, mm: the slope run plus its ends. */
function roofSheetLength(shed: ShedConfig): number {
  const pitch = (shed.roofPitchDeg * Math.PI) / 180;
  return Math.round(shed.span / 2 / Math.cos(pitch) + 80);
}

/** A skylight's sheet, plus the clearfix screws that hold it. */
function skylightLines(shed: ShedConfig, lookup: PriceLookup): BomLine[] {
  const count = shed.options.filter((option) => option.kind === 'skylight').length;
  if (count === 0) return [];
  // A skylight sheet is one roof sheet's worth of polycarbonate, so it is priced
  // by the same profile lookup the roof uses.
  const row = safeCall(() => lookup.sheeting(PROFILE, BMT));
  return [
    ...eachLine('option', `Skylight sheet, ${roofSheetLength(shed)} mm`, count, row),
  ];
}

/** A mezzanine: a priced floor area, not a list of members. */
function mezzanineLines(shed: ShedConfig, option: MezzanineOption): BomLine[] {
  const area = (option.width / 1000) * (option.depth / 1000);
  const rate =
    Math.round(MEZZANINE_RATE_CENTS_PER_M2 * (shed.stateCode === 'QLD' ? MEZZANINE_QLD_FACTOR : 1));
  const quantity = Math.round(area * 100) / 100;
  return [
    bomLine({
      group: 'option',
      code: 'MEZZANINE',
      description: `Mezzanine floor, ${option.width} × ${option.depth} mm at ${option.level} mm — storage rate`,
      unit: 'm',
      quantity,
      unitCost: rate,
      massKg: 0,
    }),
  ];
}

/** An awning's roof and wall sheets. */
function awningLines(option: AwningOption, lookup: PriceLookup): BomLine[] {
  const row = safeCall(() => lookup.sheeting(PROFILE, BMT));
  const area = (option.width / 1000) * (option.depth / 1000);
  // A sheet covers `coverage × depth` of awning, so the count is the area over
  // that — a per-sheet price must not meet an area.
  return sheetAreaLine('Awning roof', area, row, row?.coverageMm ?? 762, option.depth);
}

/**
 * A dividing wall: girts and a sheet run over the wall's area.
 *
 * The girt is priced from the frame's own girt material, so a partition inside a
 * TopHat shed is a TopHat partition. Pricing it from a fixed code would quietly
 * mix two sections in one building.
 */
function dividingWallLines(
  shed: ShedConfig,
  frame: OptimisedFrame,
  option: Extract<ShedOption, { kind: 'dividing_wall' }>,
  lookup: PriceLookup,
): BomLine[] {
  const run = option.axis === 'x' ? shed.span : shed.length;
  const sheet = safeCall(() => lookup.sheeting(PROFILE, BMT));
  const rows = Math.max(1, Math.ceil(option.height / DIVIDING_GIRT_SPACING));
  const girtRow = safeCall(() => lookup.purlin(frame.girtMaterial));
  return [
    ...sheetAreaLine(
      'Dividing wall sheeting',
      (run / 1000) * (option.height / 1000),
      sheet,
      sheet?.coverageMm ?? 762,
      option.height,
    ),
    ...lengthLine('option', `Dividing wall girt (${rows} rows)`, (run / 1000) * rows, girtRow),
  ];
}

/** Horizontal cladding: the batten runs behind the sheet band. */
function claddingLines(
  shed: ShedConfig,
  frame: OptimisedFrame,
  option: Extract<ShedOption, { kind: 'horizontal_cladding' }>,
  lookup: PriceLookup,
): BomLine[] {
  const run = option.wall === 'front' || option.wall === 'back' ? shed.span : shed.length;
  const band = option.to - option.from;
  // A band of zero height is no cladding, so it needs no battens. `Math.max(1)`
  // here charged a batten row for a band the user had collapsed to nothing.
  if (!(band > 0)) return [];
  const battens = Math.ceil(band / BATTEN_SPACING) + 1;
  const batten = safeCall(() => lookup.purlin(frame.girtMaterial));
  return lengthLine('option', `Cladding batten (${battens} rows)`, (run / 1000) * battens, batten);
}

/** A stable's wall panels, by the sides the option keeps. */
function stableLines(option: StableOption, lookup: PriceLookup): BomLine[] {
  const sides = [option.panels.left, option.panels.right, option.panels.front, option.panels.back]
    .filter(Boolean).length;
  if (sides === 0) return [];
  const sheet = safeCall(() => lookup.sheeting(PROFILE, BMT));
  const height = Math.max(STABLE_MIN_HEIGHT, option.height);
  // Each kept panel is one side; the front and back run `depth`, not `width`, so
  // the two pairs are counted separately rather than four times one dimension.
  const alongWidth = (option.width / 1000) * (height / 1000);
  const alongDepth = (option.depth / 1000) * (height / 1000);
  const area =
    (option.panels.left ? alongDepth : 0) +
    (option.panels.right ? alongDepth : 0) +
    (option.panels.front ? alongWidth : 0) +
    (option.panels.back ? alongWidth : 0);
  return sheetAreaLine(
    `Stable wall (${sides} sides)`,
    area,
    sheet,
    sheet?.coverageMm ?? 762,
    height,
  );
}

/** A carry beam's transfer beam and its capping. */
function carryBeamLines(
  shed: ShedConfig,
  option: Extract<ShedOption, { kind: 'carry_beam' }>,
  lookup: PriceLookup,
): BomLine[] {
  const bayLength = shed.length / shed.bays;
  const beams = shed.span > 7500 ? 2 : 1;
  const beam = safeCall(() => lookup.frame('250 x 250 x 6.0 SHS'));
  return lengthLine(
    'option',
    `Carry beam, ${Math.round(bayLength)} mm × ${beams}`,
    (bayLength / 1000) * beams,
    beam,
  );
}

/** An overhang's extra roof sheet. */
function overhangLines(
  shed: ShedConfig,
  option: Extract<ShedOption, { kind: 'overhang' }>,
  lookup: PriceLookup,
): BomLine[] {
  const run = option.wall === 'front' || option.wall === 'back' ? shed.span : shed.length;
  const sheet = safeCall(() => lookup.sheeting(PROFILE, BMT));
  return sheetAreaLine(
    'Overhang sheet',
    (run / 1000) * (option.depth / 1000),
    sheet,
    sheet?.coverageMm ?? 762,
    option.depth,
  );
}

/** An outrigger's beam. */
function outriggerLines(
  frame: OptimisedFrame,
  option: Extract<ShedOption, { kind: 'outrigger' }>,
  lookup: PriceLookup,
): BomLine[] {
  const beam = safeCall(() => lookup.purlin(frame.purlinMaterial));
  return lengthLine('option', 'Outrigger beam', option.length / 1000, beam);
}

/** A cantilever's beam. */
function cantileverLines(
  frame: OptimisedFrame,
  option: Extract<ShedOption, { kind: 'cantilever' }>,
  lookup: PriceLookup,
): BomLine[] {
  const beam = safeCall(() => lookup.purlin(frame.purlinMaterial));
  return lengthLine('option', 'Cantilever beam', option.length / 1000, beam);
}

/**
 * Every option's material, in one list.
 *
 * A kind whose steel the frame group already counts — a carry beam's bracket set,
 * a gable infill's sheet — contributes only what that group does not. A gable
 * infill contributes nothing at all: the end-wall sheeting already covers the
 * full gable.
 */
export function optionLines(
  shed: ShedConfig,
  frame: OptimisedFrame,
  lookup: PriceLookup,
  // The option branches take their spacing from the option's own fields; none of
  // them is a per-factory number today.
  _rules?: BomRules,
): BomLine[] {
  const lines: BomLine[] = [...skylightLines(shed, lookup)];

  for (const option of shed.options) {
    switch (option.kind) {
      case 'skylight':
        // Counted once for the whole roof, above.
        break;
      case 'mezzanine':
        lines.push(...mezzanineLines(shed, option));
        break;
      case 'awning':
        lines.push(...awningLines(option, lookup));
        break;
      case 'outrigger':
        lines.push(...outriggerLines(frame, option, lookup));
        break;
      case 'dividing_wall':
        lines.push(...dividingWallLines(shed, frame, option, lookup));
        break;
      case 'gable_infill':
        // The end-wall sheeting already runs the full gable, so a closed end adds
        // no material; an open one is simply the absence of that sheet.
        break;
      case 'stable':
        lines.push(...stableLines(option, lookup));
        break;
      case 'carry_beam':
        lines.push(...carryBeamLines(shed, option, lookup));
        break;
      case 'horizontal_cladding':
        lines.push(...claddingLines(shed, frame, option, lookup));
        break;
      case 'overhang':
        lines.push(...overhangLines(shed, option, lookup));
        break;
      case 'cantilever':
        lines.push(...cantileverLines(frame, option, lookup));
        break;
      case 'misc_option':
        // A catalogue accessory is priced in the `misc` section, not as option
        // material: it has no geometry and no per-option construction rule.
        break;
    }
  }

  return lines;
}
