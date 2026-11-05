/**
 * Skylight placement: snapping to the roof sheets, and refusing an overlap. R12.
 *
 * ## Which axis the sheets run on
 *
 * A shed's roof sheets run from **eave to ridge** — down the slope — so they are laid
 * side by side **along the building's length**. The desktop says so in its own words:
 * `Roof.Width` is `Plan.Length` (`Roof.cs:64`), and it snaps a skylight with
 * `LocSkylight.X / RoofSheetingSize` where that `X` is a position along the roof's
 * width — the length of the building.
 *
 * This build's `alongBay` measures along the length too, so **the axes already agree**.
 * An earlier note in this project claimed they did not, and withheld R12 as a result.
 * That was wrong: it compared the skylight's `bay` field (which does select a bay along
 * the length) with a remembered "span" axis that the desktop does not use for sheets.
 *
 * ## Why a skylight replaces a sheet
 *
 * A glazed sheet **is** a roof sheet — it occupies a sheet's width and the BOM already
 * subtracts one per skylight (`sheetCounts`). So the correct snap is to the sheet
 * boundary, not to an arbitrary millimetre: a skylight half over two sheets would need
 * a cut sheet on each side of it, which is not what a factory ships.
 *
 * Pure TypeScript: no DB, no HTTP, no framework.
 */

import type { ShedConfig, SkylightOption } from '@/domain/types';

/** A roof sheet as it lies on the roof, in plan millimetres along the building. */
export interface RoofSheet {
  /** Index from the front eave, 0-based. */
  index: number;
  /** Where the sheet starts along the length, mm. */
  startMm: number;
  /** Its cover along the length, mm. */
  coverMm: number;
}

/**
 * The roof sheets for a building, in plan millimetres along its length.
 *
 * The last sheet is usually narrower than the rest — a 24 m building at a 762 mm cover
 * is 31 full sheets and a 578 mm offcut — and that matters: a skylight snapped to the
 * *nominal* cover would hang off the end of the roof on the last sheet. So the final
 * entry carries the real remaining width, not the nominal one.
 */
export function roofSheets(shed: ShedConfig, coverMm: number): RoofSheet[] {
  if (!(coverMm > 0) || !(shed.length > 0)) return [];
  const count = Math.ceil(shed.length / coverMm);
  const sheets: RoofSheet[] = [];
  for (let index = 0; index < count; index++) {
    const startMm = index * coverMm;
    sheets.push({
      index,
      startMm,
      coverMm: Math.min(coverMm, shed.length - startMm),
    });
  }
  return sheets;
}

/** Where a skylight sits relative to the sheets. */
export interface SkylightSnap {
  /** The sheet it replaces, or `null` when it is not over one. */
  sheet: RoofSheet | null;
  /** The position along the length that would centre it on that sheet, mm. */
  snappedCentreMm: number;
  /** True when the skylight does not straddle a sheet boundary. */
  aligned: boolean;
  /** Why it cannot be placed at all, or `null` when it can. */
  refusal: string | null;
}

/**
 * Snap a skylight onto the roof sheet under its centre. R12's snapping half.
 *
 * The desktop's rule is a division that lands on a sheet index and then moves the
 * option to that sheet's start (`AddSkylightRule.cs:92`: `Location.X = GetSheetingPos() *
 * RoofSheetingSize`). Two checks guard it, and both are ported:
 *
 * - `GetSheetingPos() > NumberOfRoofSheetings` — the pointer is past the last sheet;
 * - `(GetSheetingPos() + 1) * RoofSheetingSize > Roof.Width` — the sheet it lands on runs
 *   off the end of the roof.
 *
 * The second one bites on the **last** sheet of a building whose length is not a whole
 * multiple of the cover: the sheet is there, but it is narrower than the skylight, so a
 * full-width pane does not fit. The desktop refuses that rather than letting the pane
 * overhang. So does this.
 */
export function snapSkylightToSheet(
  shed: ShedConfig,
  option: SkylightOption,
  coverMm: number,
): SkylightSnap {
  const sheets = roofSheets(shed, coverMm);
  if (sheets.length === 0) {
    return {
      sheet: null,
      snappedCentreMm: 0,
      aligned: false,
      refusal: 'The price book gives no usable roof sheet cover, so a skylight cannot be aligned to a sheet.',
    };
  }

  // Where the skylight's centre currently lies, along the length.
  const { start, end } = bayIntervalOf(shed, option.bay);
  const centreMm = start + (end - start) * option.alongBay;

  const index = Math.floor(centreMm / coverMm);
  const sheet = sheets[index];
  if (sheet === undefined) {
    return {
      sheet: null,
      snappedCentreMm: centreMm,
      aligned: false,
      refusal: 'The skylight is beyond the last roof sheet. Move it back onto the roof.',
    };
  }

  // The pane has to fit within the sheet it lands on, or it needs two cut sheets beside it.
  const fitsOnSheet = option.width <= sheet.coverMm;
  const snappedCentreMm = Math.round(sheet.startMm + sheet.coverMm / 2);
  // Aligned when the pane's edges both sit inside the sheet's span.
  const left = centreMm - option.width / 2;
  const right = centreMm + option.width / 2;
  const aligned = left >= sheet.startMm && right <= sheet.startMm + sheet.coverMm;

  return {
    sheet,
    snappedCentreMm,
    aligned,
    refusal: fitsOnSheet
      ? null
      : // Two different reasons a sheet is too narrow, and saying the wrong one sends the
        // operator looking for a full sheet that is the same width as this one.
        sheet.index === sheets.length - 1 && sheet.coverMm < coverMm
        ? `This skylight is ${Math.round(option.width)} mm wide but the last sheet of the roof is only ${Math.round(sheet.coverMm)} mm, so it cannot replace one. Use a narrower skylight, or put it on a full sheet.`
        : `This skylight is ${Math.round(option.width)} mm wide but a roof sheet is only ${Math.round(sheet.coverMm)} mm, so it would need a cut sheet on each side. Use a skylight no wider than one sheet.`,
  };
}

/**
 * The skylight's new position, centred on its sheet.
 *
 * Returned as a `bay`/`alongBay` pair rather than a millimetre, because that is what the
 * option stores — so the snapped position survives a save, a reload and a `.sqd` round
 * trip without drifting.
 */
export function skylightOnSheet(
  shed: ShedConfig,
  option: SkylightOption,
  coverMm: number,
): SkylightOption {
  const snap = snapSkylightToSheet(shed, option, coverMm);
  if (snap.sheet === null) return option;

  // Which bay that millimetre falls in, and how far along it.
  for (let bay = 0; bay < shed.bays; bay++) {
    const { start, end } = bayIntervalOf(shed, bay);
    if (snap.snappedCentreMm >= start && snap.snappedCentreMm <= end) {
      const span = end - start;
      return {
        ...option,
        bay,
        alongBay: span > 0 ? Math.min(1, Math.max(0, (snap.snappedCentreMm - start) / span)) : 0.5,
      };
    }
  }
  return option;
}

/** True when two skylights overlap in plan. R12's refusal half. */
export function skylightsOverlap(a: SkylightOption, b: SkylightOption, shed: ShedConfig): boolean {
  if (a.id === b.id) return false;
  const ra = skylightRect(a, shed);
  const rb = skylightRect(b, shed);
  return (
    ra.left < rb.right && rb.left < ra.right && ra.top < rb.bottom && rb.top < ra.bottom
  );
}

/**
 * The skylight a new one would collide with, or `null`.
 *
 * The desktop refuses a second skylight that lands on the first
 * (`Roof.HaveSkyLight`, `AddSkylightRule.cs:73`) — but it only compares the **start**
 * position, not the rects, so two skylights starting on different sheets but wide enough
 * to touch both fitted through. This compares the footprints, which is what overlap
 * means.
 */
export function skylightCollision(
  shed: ShedConfig,
  candidate: SkylightOption,
): SkylightOption | null {
  for (const option of shed.options) {
    if (option.kind !== 'skylight') continue;
    if (skylightsOverlap(candidate, option, shed)) return option;
  }
  return null;
}

/** A skylight's footprint in plan millimetres. */
function skylightRect(option: SkylightOption, shed: ShedConfig) {
  const { start, end } = bayIntervalOf(shed, option.bay);
  const centreY = start + (end - start) * option.alongBay;
  const y = Math.min(Math.max(centreY - option.height / 2, 0), shed.length - option.height);
  const x = Math.min(Math.max(shed.span / 2 - option.width / 2, 0), shed.span - option.width);
  return { left: x, right: x + option.width, top: y, bottom: y + option.height };
}

/**
 * A bay's extent along the building's length, mm.
 *
 * Duplicated from the geometry layer on purpose: this module is called from the BOM and
 * from a store action, neither of which should have to build a full plan to place a
 * skylight.
 */
function bayIntervalOf(shed: ShedConfig, bay: number): { start: number; end: number } {
  const count = Math.max(1, shed.bays);
  const width = shed.length / count;
  const index = Math.min(Math.max(bay, 0), count - 1);
  return { start: index * width, end: (index + 1) * width };
}
