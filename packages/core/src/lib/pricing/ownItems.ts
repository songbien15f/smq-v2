/**
 * The groups a company may add its own items to, and the unit each is priced in.
 *
 * Pure data, deliberately separated from the table that stores a company's rows.
 * The importer and the price editor both need this list, and neither needs a
 * database to read it — which is the point: a unit table that required a
 * connection would be unreachable from the engine's own tests.
 *
 * The unit is the **group's**, not the sheet's. The engine asks for 12.5 metres of
 * a section and multiplies by the unit price, so a row stored as `ea` would charge
 * 12.5 × the price of one. A column a customer can type into is therefore not
 * allowed to decide the unit.
 */

import type { BomUnit } from '@/lib/bom/types';

/** The groups a custom row may belong to, and the unit each uses. */
export const CUSTOM_SOURCES: { source: string; label: string; unit: BomUnit }[] = [
  { source: 'cost_frame', label: 'Frame sections', unit: 'm' },
  { source: 'cost_purlin', label: 'Purlins and girts', unit: 'm' },
  { source: 'view_cost_sheeting', label: 'Sheeting', unit: 'm' },
  { source: 'gutter', label: 'Gutter and brackets', unit: 'm' },
  { source: 'flashing', label: 'Flashing', unit: 'm' },
  { source: 'downpipe', label: 'Downpipes', unit: 'm' },
  { source: 'cost_bracket', label: 'Brackets', unit: 'ea' },
  { source: 'cost_bolt', label: 'Bolts', unit: 'pack' },
  { source: 'screws', label: 'Screws', unit: 'pack' },
  { source: 'cost_bracing', label: 'Bracing', unit: 'roll' },
  { source: 'roller_door', label: 'Roller doors', unit: 'ea' },
  { source: 'padoor', label: 'Personal access doors', unit: 'ea' },
  { source: 'sliding_door', label: 'Sliding doors', unit: 'ea' },
  { source: 'cost_window', label: 'Windows', unit: 'ea' },
  { source: 'misc_option', label: 'Miscellaneous options', unit: 'ea' },
];

/** True when `source` is a group a custom row may belong to. */
export function isCustomSource(source: string): boolean {
  return CUSTOM_SOURCES.some((entry) => entry.source === source);
}

/**
 * The unit a group is priced in, or `null` for a group the BOM never asks for.
 *
 * Returning `null` rather than a default is what lets the importer refuse a row
 * for a group the engine will never look up — a row that imports cleanly and is
 * never found is worse than a row that is refused.
 */
export function unitFor(source: string): BomUnit | null {
  return CUSTOM_SOURCES.find((entry) => entry.source === source)?.unit ?? null;
}

/** A company's own item, as a caller outside the lookup needs it. */
export interface OwnItem {
  source: string;
  /** Normalised: the key the item is stored under. */
  name: string;
  code: string;
  /** The name as the customer wrote it, for display. */
  description: string;
  unit: BomUnit;
  unitCostCents: number;
}
