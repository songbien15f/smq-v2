'use client';

/**
 * The workspace menu on a phone: one icon, and a panel it opens.
 *
 * ## Why this replaced a strip of links
 *
 * Below `lg` both chromes used to spread their links in a row: `Quotes Settings Team Activity` plus
 * the account control. On a 390 px screen that is the whole first row of every page given to
 * navigation — measured at 264 px of links plus an 79 px sign-out, all of it scrolling sideways when
 * it did not fit. The screens it sat above are the ones that need the width: a quote list and a
 * drawing.
 *
 * So the links go behind one button. What stays visible is the brand, the button, and whichever
 * single control matters on that screen — the rest is one tap away.
 *
 * ## Why a disclosure and not a dialog
 *
 * A modal would trap focus and need an overlay, a close-on-Escape contract and a scroll lock, all for
 * a list of four links. A disclosure is a `button` with `aria-expanded` and a panel: the anchors work
 * without JavaScript, Escape closes it, a tap outside closes it, and nothing steals focus that was not
 * asked for. The panel is part of the page, so the browser's back button behaves normally.
 *
 * ## Why the markup is duplicated rather than shared
 *
 * The desktop arrangement is a **vertical rail** in the workspace and a **horizontal row** in the
 * editor, because the editor draws its own chrome to keep the width for the plan. Only the phone
 * version is identical, so only the phone version lives here; call sites keep their own desktop list
 * and hide it below `lg`.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export interface WorkspaceMenuProps {
  /** The links this role may reach, from `navFor`. */
  links: readonly { href: string; label: string }[];
  /** Rendered at the foot of the panel: the account control, the company name. */
  footer?: React.ReactNode;
  /** Distinguishes two menus on one page, if that ever happens. */
  id?: string;
}

export function WorkspaceMenu({ links, footer, id = 'workspace-menu' }: WorkspaceMenuProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  /*
   * Navigating closes the panel.
   *
   * Without this the menu stayed open over the new page — the anchors are real links, so the render
   * that follows is a new route with the disclosure still expanded around a list the person had
   * already chosen from.
   */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      // Focus goes back to the control that opened the panel, never to the top of the document.
      toggle.current?.focus();
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (root.current === null) return;
      if (event.target instanceof Node && root.current.contains(event.target)) return;
      setOpen(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    /*
     * `static` on mobile, so the panel is positioned against the **bar** rather than this button.
     *
     * Anchored to the button it overflowed the viewport: the button sits ~141 px in (after the brand),
     * and a 256 px panel starting there ends at 397 px on a 390 px screen — 13 px of horizontal scroll
     * on every page with the menu open. The bar is the right box: its left edge is the page margin, so
     * the panel always fits. `relative` moves to the bar at the call sites, where it costs nothing.
     */
    <div ref={root} className="lg:hidden">
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        /*
         * The name says what the button *does*, not what it looks like. "Menu" alone does not say
         * which menu; a screen reader announces "Open workspace menu" and the state comes from
         * `aria-expanded`.
         */
        aria-label={open ? 'Close workspace menu' : 'Open workspace menu'}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-white transition-colors duration-sq-fast hover:bg-white/10"
      >
        {/* Two states of one glyph, drawn rather than swapped, so the button keeps its size. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          {open ? (
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              fill="none"
            />
          ) : (
            <path
              d="M3 5.5h14M3 10h14M3 14.5h14"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              fill="none"
            />
          )}
        </svg>
      </button>

      {open && (
        <div
          id={`${id}-panel`}
          className="absolute left-0 right-0 top-full z-40 mt-px rounded-b-lg border-x border-b border-white/15 bg-sq-brand p-sq-2 shadow-lg"
        >
          {/*
            `Workspace menu` rather than `Workspace`: the editor also renders a desktop row labelled
            `Workspace`, and two landmarks with one name is a document a screen reader announces twice
            with no way to tell them apart — and it broke a test that could not pick one. They are two
            different things: one is a row of links, the other is the phone's closed list.
          */}
          <nav aria-label="Workspace menu">
            <ul className="flex flex-col">
              {links.map((link) => {
                const here = pathname === link.href;
                return (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      aria-current={here ? 'page' : undefined}
                      className={[
                        'flex min-h-11 items-center rounded-md px-sq-2 text-sq-body no-underline transition-colors duration-sq-fast',
                        here ? 'bg-white/15 font-medium text-white' : 'text-white/85 hover:bg-white/10',
                      ].join(' ')}
                    >
                      {link.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>

          {footer !== undefined && (
            <div className="mt-sq-2 border-t border-white/15 pt-sq-2">{footer}</div>
          )}
        </div>
      )}
    </div>
  );
}
