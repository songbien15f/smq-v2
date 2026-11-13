import type { ShedColors, StructureType } from '@sq/core/domain';

/**
 * The structures the domain models, with the words a customer reads.
 *
 * ## Four of these values used to be rejected by the schema
 *
 * `carports`, `tophot`, `zed` and `hangar` are not members of `StructureType`, so choosing one went
 * through `applyPartial`, hit `structureTypeSchema.catch(DEFAULT_SHED.structureType)`, and came back
 * as **`gable`** — measured 2026-11-11 with a probe. The dropdown offered seven structures and
 * silently delivered two families, which is the same shape of defect as the importance level that
 * became 1: a select where the value shown is not the value stored.
 *
 * The list is now keyed to the union, with `satisfies` so a member added to `StructureType` without
 * a label here is a compile error rather than a missing option.
 */
export const STRUCTURE_TYPES: readonly { value: StructureType; label: string }[] = [
  { value: 'gable', label: 'Gable' },
  { value: 'skillion', label: 'Skillion' },
  { value: 'gable_carport', label: 'Gable carport' },
  { value: 'skillion_carport', label: 'Skillion carport' },
  { value: 'tophot_64', label: 'TopHat (64 mm)' },
  { value: 'tophot_96', label: 'TopHat (96 mm)' },
  { value: 'zed_shed', label: 'Zed shed' },
  { value: 'aircraft_hangar', label: 'Aircraft hangar' },
  { value: 'cyclonic', label: 'Cyclonic' },
  { value: 'custom_gable', label: 'Custom gable (non-standard)' },
  { value: 'custom_skillion', label: 'Custom skillion (non-standard)' },
] as const satisfies readonly { value: StructureType; label: string }[];

export const STATES: string[] = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];

/**
 * BCA importance levels, all four, with the meaning a person is choosing between.
 *
 * Not read from the price book on purpose. The book lists only the levels it has frame tables for
 * (today 1 and 2), but the **certificate** may say 3 or 4 — and an importance level that quietly
 * becomes 1 is the defect this list exists to prevent. The book's own list is used separately, to
 * say when it cannot price the level that was chosen.
 */
export const IMPORTANCE: { value: string; label: string }[] = [
  { value: '1', label: '1 — normal' },
  { value: '2', label: '2 — high consequence' },
  { value: '3', label: '3 — substantial' },
  { value: '4', label: '4 — exceptional' },
];

/**
 * What each colour role is called in the trade, so the label is not a code name.
 *
 * Keyed by `keyof ShedColors`: adding a role to the domain is a compile error here,
 * not a role that silently has no swatch grid.
 */
export const COLOUR_LABELS: Record<keyof ShedColors, string> = {
  wall: 'Wall',
  roof: 'Roof',
  barge: 'Barge and fascia',
  downpipe: 'Downpipe',
  gutter: 'Gutter',
  window: 'Window',
  paDoor: 'PA door',
  rollerDoor: 'Roller door',
  slidingDoor: 'Sliding door',
  dividingWall: 'Dividing wall',
};
