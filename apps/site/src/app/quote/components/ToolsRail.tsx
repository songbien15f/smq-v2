'use client';

/**
 * The tools rail: the always-visible icon toolbar for "Your design", at the left edge of the stage
 * (tablet and desktop; a phone keeps the drawer and its toolbar "Tools" button instead).
 *
 * Three buttons — Size, Colours, Doors — an icon above a short label. A click opens the "Your design"
 * card beside the rail with only that group expanded; clicking the icon of the group that is already
 * open closes the card. The rail itself never disappears. The active icon is the open group of an open
 * card, shown in gold and announced with `aria-expanded`.
 *
 * Doors stays a button even on a type that locks doors (a carport): the group is still there, saying
 * why there are no doors, and hiding the button would remove the explanation.
 */

import { railIdFor, toggleToolsGroup, usePanels } from '../panels';
import { IconDoor, IconPaintRoller, IconRuler } from './icons';

const ITEMS = [
  { id: 'g-group-size' as const, label: 'Size', Icon: IconRuler, name: 'Size and structure' },
  { id: 'g-group-colours' as const, label: 'Colours', Icon: IconPaintRoller, name: 'Colours' },
  { id: 'g-group-doors' as const, label: 'Doors', Icon: IconDoor, name: 'Doors and windows' },
];

export function ToolsRail() {
  const leftOpen = usePanels((s) => s.leftOpen);
  const group = usePanels((s) => s.group);

  return (
    <nav className="g-rail" aria-label="Your design tools">
      {ITEMS.map(({ id, label, Icon, name }) => {
        const active = leftOpen && group === id;
        return (
          <button
            key={id}
            id={railIdFor(id)}
            type="button"
            className="g-rail-btn"
            aria-label={name}
            aria-expanded={active}
            aria-controls="g-tools"
            data-active={active || undefined}
            onClick={() => toggleToolsGroup(id)}
          >
            <Icon />
            <span aria-hidden="true">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
