'use client';

/**
 * The nav below 1024px: a menu button in the top bar that opens the same sidebar as a modal drawer.
 *
 * A native `<dialog>` opened with `showModal()` gives the parts a drawer must not get wrong for free —
 * focus moves into it and stays there, Escape closes it, the page behind is inert — so nothing here
 * re-implements them. The nav links are plain anchors, so following one loads the next page and the
 * drawer is gone with the old one.
 */

import { useRef } from 'react';
import { CloseIcon } from '@sq/ui';
import { NavIcon } from './NavIcons';

export function NavDrawer({ brand, children }: { brand: React.ReactNode; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();

  return (
    <>
      <button
        type="button"
        aria-label="Open navigation"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
        className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-sq-ink transition-colors duration-sq-fast hover:bg-sq-ground lg:hidden"
      >
        <NavIcon name="menu" />
      </button>

      <dialog
        ref={dialog}
        aria-label="Navigation"
        // A click on the dialog element itself is a click on the backdrop: the panel fills its box.
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        className="sq-on-brand m-0 h-dvh max-h-dvh w-72 max-w-[85vw] bg-sq-brand p-0 text-white backdrop:bg-sq-ink/50"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between pl-sq-3 pr-sq-1">
            {brand}
            <button
              type="button"
              aria-label="Close navigation"
              onClick={close}
              className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
            >
              <CloseIcon size={18} />
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}
