'use client';

/**
 * A panel that slides in from the right at `lg` and rises from the bottom below it.
 *
 * Used twice: the price breakdown (modal: it dims the page at every width) and the Assistant at
 * 1024–1279 px / on a phone (`modalAtLg={false}`: the spec wants the form still usable beside it, so at
 * `lg` there is no backdrop; below `lg` it is a sheet and does dim the page).
 *
 * Esc closes it, focus moves to the panel on open and back to whatever opened it on close.
 * z-index follows the spec order: side flyout (40) above the drawers (35) above the price strip (30).
 */

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  /** Modal at every width (price details) or only below `lg` (assistant). */
  modalAtLg: boolean;
  /** Hidden from this width up: the assistant is a column at `xl`. */
  hideFrom?: 'xl';
  /** Where focus goes on close when the opener left the page while the drawer was open (the phone button). */
  fallbackFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export function Drawer({ open, onClose, label, modalAtLg, hideFrom, fallbackFocus, children }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // The phone button is removed in the same render that opens the drawer, so the active element is
      // already `body` by now: that is "nothing", not an opener.
      const back = returnTo.current;
      const opener = back && back !== document.body && back.isConnected ? back : fallbackFocus?.current;
      opener?.focus({ preventScroll: true });
    };
  }, [open, onClose, fallbackFocus]);

  if (!open) return null;
  const hide = hideFrom === 'xl' ? ' xl:hidden' : '';

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-[35] bg-sq-ink/40${modalAtLg ? '' : ' lg:hidden'}${hide}`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={modalAtLg ? 'true' : undefined}
        aria-label={label}
        tabIndex={-1}
        className={`fixed inset-x-0 bottom-0 z-[35] flex h-[85dvh] flex-col overflow-hidden rounded-t-lg border border-sq-line bg-sq-surface shadow-xl outline-none lg:inset-x-auto lg:right-0 lg:top-0 lg:h-dvh lg:w-[380px] lg:rounded-none lg:border-y-0 lg:border-r-0${hide}`}
      >
        {children}
      </div>
    </>
  );
}
