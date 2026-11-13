'use client';

/**
 * A panel that opens to the right of the form column, beside the field that asked for it.
 *
 * The desktop's flyouts (`UcShowBuildingParameterss`, `UcAdjustBaySize`) open beside the form. A panel
 * that hangs under its field instead covers the fields below it, which is a problem while it is open
 * for a long time (review 2026-11-13 UI/UX item 1, WCAG 2.2 "focus not obscured"). This one opens over
 * the plan, which on Step 1 is a preview with nothing to type into.
 *
 * ## How it is placed
 *
 * It is rendered **inside a `relative` wrapper** — its parent element is the anchor. The wrapper sits in
 * the form column (`data-editor-column="form"`), so the flyout's left edge is the column's right edge
 * plus a gap. Vertically it starts level with the anchor and is pulled up only as far as needed to end
 * inside the window. An arrow points back at `arrowTargetRef`. Measured once per opening: re-measuring
 * on scroll would make it jump while the operator reads it.
 *
 * ## Below `lg` (a phone)
 *
 * There is no room beside a one-column form. `phone="sheet"` makes it a bottom sheet over the page
 * (for something the operator asked for and will leave the page to act on); `phone="inline"` keeps it
 * in the flow under its anchor, which suits a panel that can also open by itself.
 *
 * Whether it is open is the caller's: mount it only while open (focus management stays with the
 * caller too, since "which field takes focus" and "what gets focus back" differ per panel).
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { CloseIcon } from '@sq/ui';

const GAP = 12;
const ARROW = 12;

export function SideFlyout({
  id,
  titleId = `${id}-title`,
  title,
  closeLabel,
  onClose,
  arrowTargetRef,
  phone,
  children,
}: {
  id: string;
  /** Defaults to `<id>-title`. */
  titleId?: string;
  title: string;
  closeLabel: string;
  onClose: () => void;
  /** The control the arrow points at (the one that opened this). */
  arrowTargetRef: RefObject<HTMLElement | null>;
  phone: 'sheet' | 'inline';
  children: ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** Desktop placement relative to the anchor; `null` on a phone or before the first measure. */
  const [place, setPlace] = useState<{ left: number; top: number; arrowTop: number } | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchorElement = outerRef.current?.parentElement ?? null;
    if (panel === null || anchorElement === null || !window.matchMedia('(min-width: 1024px)').matches) return;
    const anchor = anchorElement.getBoundingClientRect();
    const column = anchorElement.closest('[data-editor-column="form"]')?.getBoundingClientRect();
    const left = (column === undefined ? anchor.width : column.right - anchor.left) + GAP;
    const height = panel.getBoundingClientRect().height;
    const overflow = anchor.top + height - (window.innerHeight - GAP);
    const top = overflow > 0 ? -Math.min(overflow, Math.max(0, anchor.top - GAP)) : 0;
    const target = arrowTargetRef.current?.getBoundingClientRect();
    const targetCentre = target === undefined ? 40 : target.top + target.height / 2 - anchor.top;
    const arrowTop = Math.min(Math.max(targetCentre - top - ARROW / 2, GAP), height - 2 * ARROW);
    setPlace({ left, top, arrowTop });
  }, [arrowTargetRef]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // A field that used Escape itself (a list closing) marks it handled.
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sheet = phone === 'sheet';

  return (
    <div
      ref={outerRef}
      className={[
        sheet ? 'fixed inset-0 z-40 flex flex-col justify-end' : 'relative',
        'lg:absolute lg:inset-auto lg:left-full lg:top-0 lg:z-30 lg:block lg:w-[360px] lg:max-w-[calc(100vw-2rem)]',
      ].join(' ')}
      style={place === null ? undefined : { left: place.left, top: place.top }}
    >
      {/* The backdrop does not close the sheet: the only ways out are ✕ and Escape. */}
      {sheet && <div aria-hidden="true" className="absolute inset-0 bg-sq-ink/30 lg:hidden" />}

      {/* Desktop only: the arrow pointing back at its control. A rotated square showing its left and
          bottom edges; it sits outside the scrolling panel so the panel's overflow cannot clip it. */}
      {place !== null && (
        <span
          aria-hidden="true"
          style={{ top: place.arrowTop }}
          className="absolute -left-[6px] z-10 hidden h-3 w-3 rotate-45 border-b border-l border-sq-line bg-sq-surface lg:block"
        />
      )}

      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-labelledby={titleId}
        className={[
          'relative flex flex-col gap-sq-2 overflow-y-auto overscroll-contain border border-sq-line bg-sq-surface p-sq-3 shadow-lg',
          'lg:max-h-[min(80vh,640px)] lg:rounded-lg lg:pb-sq-3',
          sheet
            ? 'max-h-[85vh] rounded-t-lg pb-[calc(var(--spacing-sq-3)+env(safe-area-inset-bottom,0px))]'
            : 'rounded-lg',
        ].join(' ')}
      >
        <div className="flex items-center justify-between gap-sq-2">
          <h4 id={titleId} className="text-sq-body font-semibold text-sq-ink">
            {title}
          </h4>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-sq-ink-muted hover:bg-sq-ground hover:text-sq-ink"
          >
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
