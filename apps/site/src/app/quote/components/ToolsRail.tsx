'use client';

/**
 * The tools rail: what the left column becomes when it is collapsed on a desktop.
 *
 * Three 40 × 46 buttons — Size, Colours, Doors — with an icon above a 9px label, exactly the shape the
 * template uses. A click opens that group **and** the column, then scrolls the group into view, so the
 * rail is a shortcut to a control rather than a state of its own.
 *
 * Doors stays a button even on a type that locks doors (a carport): the group is still there, saying
 * why there are no doors, and hiding the button would remove the explanation.
 */

import { openTools } from '../panels';
import { IconChevronRight, IconList, IconSearch } from './icons';

const ITEMS = [
  { id: 'g-group-size' as const, label: 'Size', Icon: IconList, aria: 'Open Size and structure' },
  { id: 'g-group-colours' as const, label: 'Colour', Icon: IconSearch, aria: 'Open Colours' },
  { id: 'g-group-doors' as const, label: 'Doors', Icon: IconChevronRight, aria: 'Open Doors and windows' },
];

export function ToolsRail() {
  return (
    <div className="g-rail" aria-label="Tools — quick open">
      {ITEMS.map(({ id, label, Icon, aria }) => (
        <button key={id} type="button" className="g-rail-btn" aria-label={aria} onClick={() => openTools(id)}>
          <Icon />
          <span aria-hidden="true">{label}</span>
        </button>
      ))}
    </div>
  );
}
