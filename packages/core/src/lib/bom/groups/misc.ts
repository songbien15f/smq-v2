/**
 * Miscellaneous catalogue lines.
 *
 * The desktop's Step 2 "Misc. Options" category is 55 accessories — insulation,
 * bird proofing, screens, duct tape — sold by quantity and priced from the book's
 * `misc_option` table. They are **cost** items, not selling charges: they belong in
 * the BOM so the margin recovers them, unlike engineering and extra charges which
 * are added after the kit (see `pricing/price.ts`).
 *
 * A name the book does not price is reported, never guessed. A line priced at zero
 * would look like a free accessory and quietly remove it from the quote.
 */

import type { ShedConfig, DimensionedShed } from '@/domain/types';
import type { PriceLookup } from '@/lib/pricing/types';
import { bomLine, type BomLine, type BomUnit } from '../types';

/** The units a BOM line can carry; the catalogue's unit is checked against them. */
const BOM_UNITS: readonly BomUnit[] = ['m', 'sqm', 'ea', 'pack', 'roll'];

/** The priced lines, and the names the book could not price. */
export interface MiscOptionLines {
  lines: BomLine[];
  unknown: string[];
}

/**
 * Price every `misc_option` on `shed`.
 *
 * A blank name is a row the operator added but has not chosen a catalogue item for
 * yet; it produces nothing and is not reported, because it is visibly incomplete in
 * the editor rather than a wrong price.
 */
export function miscOptionLines(shed: DimensionedShed, lookup: PriceLookup): MiscOptionLines {
  const lines: BomLine[] = [];
  const unknown: string[] = [];

  for (const option of shed.options) {
    if (option.kind !== 'misc_option') continue;

    const name = option.name.trim();
    if (name === '') continue;

    const row = lookup.miscOption(name);
    if (row === undefined) {
      unknown.push(name);
      continue;
    }

    const unit = BOM_UNITS.includes(option.unit as BomUnit) ? (option.unit as BomUnit) : 'ea';
    lines.push(
      bomLine({
        group: 'misc',
        code: row.code,
        description: name,
        unit,
        quantity: option.quantity,
        unitCost: row.unitCost,
        // `massKg` is the shipping mass of the line, so it scales with quantity.
        massKg: row.massKg * option.quantity,
      }),
    );
  }

  return { lines, unknown };
}
