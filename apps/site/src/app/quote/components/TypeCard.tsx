'use client';

import type { GuestBuildingTypeSpec } from '@sq/core/domain';
import {
  IconArena,
  IconCarport,
  IconCheck,
  IconGarage,
  IconHangar,
  IconHouse,
  IconIndustrial,
  IconShed,
  IconSkillion,
} from './icons';

export const ICONS = {
  shed: IconShed,
  garage: IconGarage,
  carport: IconCarport,
  skillion: IconSkillion,
  industrial: IconIndustrial,
  arena: IconArena,
  hangar: IconHangar,
  house: IconHouse,
} as const satisfies Record<GuestBuildingTypeSpec['config']['icon'], unknown>;

/**
 * One building type on tab ① (override §5 `TypeCard`): the admin's icon, name and one-line description.
 *
 * Selection is never colour alone — the selected card has a red ring **and** a check badge **and**
 * `aria-pressed`. It is a toggle button, not a radio: picking again does nothing, and the cards sit in
 * the page's natural tab order.
 */
export function TypeCard({
  type,
  selected,
  onPick,
}: {
  type: GuestBuildingTypeSpec;
  selected: boolean;
  onPick: (type: GuestBuildingTypeSpec) => void;
}) {
  const Icon = ICONS[type.config.icon];
  return (
    <button type="button" className="g-type-card" aria-pressed={selected} onClick={() => onPick(type)}>
      <span className="g-type-icon">
        <Icon />
      </span>
      <span className="g-type-text">
        <span className="g-type-name">{type.name}</span>
        {type.description === '' ? null : <span className="g-type-desc">{type.description}</span>}
      </span>
      {selected ? (
        <span className="g-type-check">
          <IconCheck />
        </span>
      ) : null}
    </button>
  );
}
