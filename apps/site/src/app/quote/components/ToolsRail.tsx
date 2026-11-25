'use client';

/**
 * The tools rail: the always-visible tab strip for "Your design", at the left edge of the stage
 * (tablet and desktop; a phone keeps the drawer and its word tabs instead).
 *
 * ## A tab set, not three buttons
 *
 * The card beside the rail shows exactly one group, so the rail is that card's tab strip:
 * `role="tablist"`, each icon a `role="tab"` with `aria-selected` and `aria-controls` pointing at the
 * group's panel. Arrow keys move between tabs and select as they go, which is what a screen reader
 * announces as "tab, 1 of 3".
 *
 * A press on the tab that is already showing **closes** the card — the rail itself never disappears, so
 * there is always a way back.
 *
 * ## The problem dot
 *
 * A group that contains a validation problem gets an orange dot, with the count in the accessible name
 * ("Size and structure — 1 problem"). The card cannot show one group's error under another group's tab,
 * so this is how a person finds it.
 *
 * Doors stays a tab even on a type that locks doors (a carport): the group is still there, saying why
 * there are no doors, and hiding the tab would remove the explanation.
 */

import { railIdFor, toggleToolsGroup, usePanels, type ToolsGroupId } from '../panels';
import { GROUP_TABS, groupForIssuePath, panelIdFor } from './ControlAccordion';
import { IconDoor, IconPaintRoller, IconRuler } from './icons';

const ICONS = { 'g-group-size': IconRuler, 'g-group-colours': IconPaintRoller, 'g-group-doors': IconDoor };

/** Problems per group, from the same `validateGuestDesign` paths the panels report. */
export function problemCounts(issues: readonly { path: string }[]): Record<ToolsGroupId, number> {
  const counts: Record<ToolsGroupId, number> = { 'g-group-size': 0, 'g-group-colours': 0, 'g-group-doors': 0 };
  for (const issue of issues) counts[groupForIssuePath(issue.path)] += 1;
  return counts;
}

export function ToolsRail({ counts }: { counts: Record<ToolsGroupId, number> }) {
  const leftOpen = usePanels((s) => s.leftOpen);
  const group = usePanels((s) => s.group);

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>, index: number) => {
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    const backward = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
    if (!forward && !backward && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const n = GROUP_TABS.length;
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? n - 1 : (index + (forward ? 1 : -1) + n) % n;
    const target = GROUP_TABS[next]!;
    // Selection follows focus: the card shows the group the person is looking at.
    toggleToolsGroup(target.id);
    document.getElementById(railIdFor(target.id))?.focus();
  };

  return (
    <nav className="g-rail" aria-label="Your design tools" role="tablist" aria-orientation="vertical">
      {GROUP_TABS.map((tab, index) => {
        const Icon = ICONS[tab.id];
        const active = leftOpen && group === tab.id;
        const problems = counts[tab.id];
        const label =
          problems === 0 ? tab.name : `${tab.name} — ${problems} ${problems === 1 ? 'problem' : 'problems'}`;
        return (
          <button
            key={tab.id}
            id={railIdFor(tab.id)}
            type="button"
            role="tab"
            className="g-rail-btn"
            aria-label={label}
            aria-selected={active}
            aria-controls={panelIdFor(tab.id)}
            tabIndex={active ? 0 : -1}
            data-active={active || undefined}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => toggleToolsGroup(tab.id)}
          >
            <Icon />
            <span aria-hidden="true">{tab.short}</span>
            {problems === 0 ? null : <span className="g-rail-problem" aria-hidden="true" />}
          </button>
        );
      })}
    </nav>
  );
}
