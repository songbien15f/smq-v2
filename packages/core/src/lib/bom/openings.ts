/**
 * The openings group: doors and windows.
 *
 * A door is the most expensive single item on most sheds — a roller door costs
 * more than the frame steel around it — so a BOM that omits openings produces a
 * quote that is confidently and badly wrong. This group prices every opening
 * against the catalogue.
 *
 * The catalogue is a size ladder, not a made-to-measure service: a 900 mm
 * personal-access request is filled by the smallest catalogue door that is at
 * least 900 wide and 2040 high. A door that is too small cannot be fitted, so the
 * nearest larger size is what a factory supplies; when nothing in the book is
 * large enough the line is marked incomplete rather than guessed.
 *
 * A plain `opening` is a hole with nothing in it, so it consumes no material — the
 * frame group already accounts for the jamb columns it needs.
 *
 * **Deviation from the desktop (recorded at `/deviations`):** the desktop's door
 * lookup also brings its own flashing, screws and brackets per door type. This
 * build prices the door leaf and frame only; the flashing around a door is part of
 * the door package in the catalogue price, and pricing it twice is a worse error
 * than pricing it once.
 */

import type { Opening, OpeningType, ShedConfig } from '@/domain/types';
import { doorColour } from '@/domain/colors';
import type { DoorKind, PriceLookup, PriceRow } from '@/lib/pricing/types';
import { bomLine, mockedLine, type BomLine } from './types';
import { safeCall } from './safe';

/** The book's name for each opening type. */
const DOOR_KIND: Record<Exclude<OpeningType, 'window' | 'opening'>, DoorKind> = {
  roller_door: 'roller',
  pa_door: 'pa',
  sliding_door: 'sliding',
};

/** What each opening type is called on a materials list. */
const LABEL: Record<OpeningType, string> = {
  roller_door: 'Roller door',
  pa_door: 'PA door',
  sliding_door: 'Sliding door',
  window: 'Window',
  opening: 'Opening',
};

/** One line for one opening. */
function openingLine(
  opening: Opening,
  row: PriceRow | undefined,
): BomLine[] {
  const label = LABEL[opening.type];
  const description = `${label}, ${opening.width} × ${opening.height} mm`;
  const quantity = 1;

  if (row === undefined) {
    return [mockedLine({ group: 'option', description, unit: 'ea', quantity })];
  }
  return [
    bomLine({
      group: 'option',
      code: row.code,
      description: `${description} — ${row.description}`,
      unit: 'ea',
      quantity,
      unitCost: row.unitCost,
      massKg: row.massKg,
    }),
  ];
}

/**
 * The door and window lines.
 *
 * Each opening gets its own line rather than being merged by product, because a
 * materials list that says "3 doors" hides which wall each goes on and which
 * swing it has — the things a factory needs. Two identical doors still merge in
 * `buildBom` when their descriptions match, which is the right outcome.
 *
 * **A sliding door is priced by the wall it is in.** The book carries three
 * rates — side wall, gable end, and a hangar's gable end — and its generic
 * `sld_price` column is zero on every row. Passing the placement is what keeps a
 * sliding door from being quoted at nothing.
 */
export function openingLines(shed: ShedConfig, lookup: PriceLookup): BomLine[] {
  const lines: BomLine[] = [];
  const hangar = shed.structureType === 'aircraft_hangar';

  for (const opening of shed.openings) {
    // A plain hole has nothing fitted into it.
    if (opening.type === 'opening') continue;

    // A window has its own catalogue, which this build does not import yet: the
    // book's window rows are sized by a `material_window` join rather than a
    // width/height pair. The line is emitted and marked incomplete so the quote
    // says "this is missing" instead of silently omitting the window.
    if (opening.type === 'window') {
      lines.push(
        ...openingLine(opening, safeCall(() => lookup.window(opening.width, opening.height))),
      );
      continue;
    }

    const kind = DOOR_KIND[opening.type];
    // A gable end is `left`/`right`; `front`/`back` are the long side walls.
    const endWall = opening.wall === 'left' || opening.wall === 'right';
    // A door takes the colour of the wall it sits in. A painted door is dearer
    // than a zincalume one and the book states both prices, so the colour is not
    // cosmetic here — it is a 16% swing on the line.
    const painted = isPainted(doorColour(shed.colors, opening.type), lookup);
    const row = safeCall(() =>
      lookup.door(kind, opening.width, opening.height, { endWall, hangar, painted }),
    );
    lines.push(...openingLine(opening, row));
  }

  return lines;
}

/**
 * True when a wall colour is a paint rather than bare steel.
 *
 * The book names its galvanised finishes `Zinc`, `Z450 Galv` and `Z600 Galv`;
 * every other colour in the catalogue is a Colorbond paint. The name is asked of
 * the book rather than matched against a hex table here, so a book that renames a
 * finish still classifies correctly.
 *
 * An unrecognised colour counts as painted: that is what a shed with a chosen
 * colour is, and a galvanised building is the case that names itself.
 */
function isPainted(hex: string, lookup: PriceLookup): boolean {
  const name = safeCall(() => lookup.colourName(hex)) ?? '';
  return !/galv|^zinc$/i.test(name);
}
