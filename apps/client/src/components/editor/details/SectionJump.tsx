'use client';

/**
 * Chips that jump to a group on Quote details.
 *
 * ## Why
 *
 * Step 1 is one long column of six collapsible groups. An operator fixing "Site address" while the
 * customer is on the phone scrolled past Customer, scrolled back, and lost their place; on a phone the
 * column is several screens tall. A row of six chips in the sticky header is a table of contents that
 * also says which groups still need something.
 *
 * ## How it reaches a group
 *
 * Each `Group` carries an `id` and listens for `OPEN_GROUP_EVENT`; a collapsed group (Delivery is
 * collapsed by default) opens itself, then this component scrolls to it and moves focus to its title
 * button. No shared state and no ref plumbing: the groups live in six files and the header lives in
 * `QuoteEditor`, so a window event is the narrowest thing that connects them.
 */

import type { DraftIssue } from '../validation';

/** Dispatched on `window` with the group's `id` as `detail`. */
export const OPEN_GROUP_EVENT = 'sq:open-group';

interface Section {
  id: string;
  label: string;
  /** The issue paths that count against this group — the same lists the groups themselves use. */
  paths: readonly string[];
}

const SECTIONS: readonly Section[] = [
  {
    id: 'group-customer',
    label: 'Client',
    paths: ['customer-firstName', 'customer-lastName', 'customer-email', 'customer-address'],
  },
  { id: 'group-site', label: 'Site', paths: ['site-address'] },
  { id: 'group-delivery', label: 'Delivery', paths: ['site-deliveryAcknowledged'] },
  { id: 'group-design', label: 'Design', paths: ['design-stateCode', 'design-cantilever'] },
  {
    id: 'group-shed',
    label: 'Shed',
    paths: ['shed-span', 'shed-length', 'shed-height', 'shed-bays', 'shed-nomBaySpacing', 'shed-roofPitchDeg'],
  },
  { id: 'group-colour', label: 'Colours', paths: [] },
];

/** Colour issues are keyed `colours-<role>`, one per role, so they are matched by prefix. */
function countFor(section: Section, issuesByPath: Map<string, DraftIssue>): number {
  if (section.id === 'group-colour') {
    let count = 0;
    for (const path of issuesByPath.keys()) if (path.startsWith('colours-')) count += 1;
    return count;
  }
  return section.paths.filter((path) => issuesByPath.has(path)).length;
}

/**
 * Where the sticky header ends once it is stuck: its `top` offset plus its height.
 *
 * Measured rather than a `scroll-margin` constant because the header's height changes with the width
 * (the Save reason wraps) and it sits under the price strip below `xl`, and a fixed margin left the
 * group's title hidden under it by 49 px at 1440.
 */
function stuckHeaderBottom(from: HTMLElement): number {
  const header = from.closest<HTMLElement>('.sticky');
  if (header === null) return 0;
  return (parseFloat(getComputedStyle(header).top) || 0) + header.getBoundingClientRect().height;
}

function jumpTo(id: string, from: HTMLElement): void {
  window.dispatchEvent(new CustomEvent(OPEN_GROUP_EVENT, { detail: id }));
  // Two frames: the first lets a collapsed group render its body, the second measures the result.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const section = document.getElementById(id);
      if (section === null) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const top = window.scrollY + section.getBoundingClientRect().top - stuckHeaderBottom(from) - 8;
      window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
      section.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus({ preventScroll: true });
    }),
  );
}

export function SectionJump({ issuesByPath }: { issuesByPath: Map<string, DraftIssue> }) {
  return (
    <nav aria-label="Jump to a section" className="flex w-full gap-x-sq-1 overflow-x-auto">
      {SECTIONS.map((section) => {
        const count = countFor(section, issuesByPath);
        return (
          <button
            key={section.id}
            type="button"
            onClick={(event) => jumpTo(section.id, event.currentTarget)}
            aria-label={count > 0 ? `${section.label}, ${count} ${count === 1 ? 'item needs' : 'items need'} attention` : section.label}
            className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-md px-sq-2 text-sq-micro font-medium text-sq-ink-muted transition-colors duration-sq-fast hover:bg-sq-ground hover:text-sq-ink"
          >
            {section.label}
            {count > 0 && (
              <span aria-hidden="true" className="grid h-4 min-w-4 place-items-center rounded-full bg-sq-attention px-1 text-sq-micro font-semibold leading-none text-white">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
