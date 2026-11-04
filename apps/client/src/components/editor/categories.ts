/**
 * The Step 2 dock: the desktop's fifteen categories, in its order.
 *
 * The desktop's Options dock is a property grid of categories, each with its own Add.
 * The order is the book's `display_priority`, and the list is fixed here because the
 * mapping from a category to what it creates is code, not data: "Track" is a view over
 * sliding doors, and "Extra Charges" is the existing charge table.
 *
 * Three categories are **views** rather than creators, and that is deliberate: a track
 * is owned by the sliding door it belongs to, an extra charge is a commercial line that
 * must not travel through the material margin, and an engineering charge is added after
 * the kit. Creating a second object for any of them would be a second source of truth.
 */

import type { OpeningType, OptionKind, ShedConfig } from '@sq/core/domain';

/** One row of the dock. */
export type DockCategory =
  | { id: string; label: string; description: string; kind: 'opening'; opening: OpeningType }
  | { id: string; label: string; description: string; kind: 'option'; option: OptionKind }
  | {
      id: string;
      label: string;
      description: string;
      kind: 'view';
      view: 'track' | 'charges' | 'engineering';
    };

/** The fifteen categories, in the desktop's order. */
export const CATEGORY_DOCK: DockCategory[] = [
  { id: 'window', label: 'Window', description: 'Glass or security window in a wall.', kind: 'opening', opening: 'window' },
  { id: 'pa-door', label: 'PA Door', description: 'Personal-access door.', kind: 'opening', opening: 'pa_door' },
  { id: 'roller-door', label: 'Roller Door', description: 'Roller door, from the catalogue sizes.', kind: 'opening', opening: 'roller_door' },
  { id: 'track', label: 'Track', description: 'The track each sliding door runs on.', kind: 'view', view: 'track' },
  { id: 'outrigger', label: 'Outrigger', description: 'Beam bracket projecting from a column line.', kind: 'option', option: 'outrigger' },
  { id: 'sliding-door', label: 'Sliding Door', description: 'Sliding door; its track is set on the door.', kind: 'opening', opening: 'sliding_door' },
  { id: 'dividing-wall', label: 'Dividing Wall', description: 'Internal partition.', kind: 'option', option: 'dividing_wall' },
  { id: 'skylight', label: 'Skylight', description: 'Roof light, anchored to a bay.', kind: 'option', option: 'skylight' },
  { id: 'opening', label: 'Opening', description: 'A plain hole with nothing fitted.', kind: 'opening', opening: 'opening' },
  { id: 'mezzanine', label: 'Mezzanine', description: 'Raised floor slab in a corner.', kind: 'option', option: 'mezzanine' },
  { id: 'awning', label: 'Awning', description: 'Roof extension projecting from a wall.', kind: 'option', option: 'awning' },
  { id: 'carry-beam', label: 'Carry Beam', description: 'Beam spanning a bay so the wall below can open.', kind: 'option', option: 'carry_beam' },
  { id: 'misc-options', label: 'Misc. Options', description: 'Catalogue accessories: insulation, screens, bird proofing.', kind: 'option', option: 'misc_option' },
  { id: 'extra-charges', label: 'Extra Charges or Notes', description: 'A commercial line, added after the margin.', kind: 'view', view: 'charges' },
  { id: 'engineering-charges', label: 'Engineering Charges', description: 'Engineering fee, added after the kit.', kind: 'view', view: 'engineering' },
];

/** How many of this category's object the shed already carries. */
export function categoryCount(config: ShedConfig, category: DockCategory): number {
  if (category.kind === 'opening') {
    return config.openings.filter((opening) => opening.type === category.opening).length;
  }
  if (category.kind === 'option') {
    return config.options.filter((option) => option.kind === category.option).length;
  }
  switch (category.view) {
    case 'track':
      return config.openings.filter((opening) => opening.type === 'sliding_door').length;
    case 'charges':
      return config.charges.length;
    case 'engineering':
      return 0;
  }
}
