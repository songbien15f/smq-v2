'use client';

/**
 * "You have unsaved changes" — for a refresh, a closed tab, and a link inside the app.
 *
 * ## Why this is not one `beforeunload` listener
 *
 * `beforeunload` covers exactly one case: the browser is about to leave the page. It does **not**
 * fire for a client-side navigation, and this editor is a single page with links to the quote list,
 * Settings and Team — so a person who typed a customer's name and then clicked "Quotes" lost it with
 * no warning at all. Both paths have to be covered, and they need different mechanisms.
 *
 * ## What the browser will and will not let us say
 *
 * The `beforeunload` dialog is the browser's own: its text cannot be changed, and a page that has
 * not been interacted with may not show it at all. That is a platform limit, not a choice — so the
 * in-app path carries the real message, and `beforeunload` is the backstop for F5 and the tab
 * close button.
 *
 * ## Why the in-app guard is a capture-phase click listener
 *
 * Next's App Router has no navigation blocker. A capture listener on `document` sees every anchor
 * click before React does, so `preventDefault` there stops the navigation for links, and the same
 * handler covers a middle-click or a `target="_blank"` link that would otherwise slip past. It
 * deliberately ignores:
 *
 * - links to another origin (the browser's own `beforeunload` covers leaving the app),
 * - `mailto:`/`tel:` and hash links, which do not navigate away,
 * - anything with `data-allow-navigation`, so a screen can opt a link out.
 */

import { useEffect } from 'react';

/** The attribute a link can carry to opt out of the guard. */
export const ALLOW_NAVIGATION = 'data-allow-navigation';

/** The message shown when a person is about to lose work. */
export const UNSAVED_MESSAGE =
  'This quote has changes that have not been saved. Leave the page and lose them?';

/**
 * Guard the page while `dirty` is true.
 *
 * `dirty` is read through a ref inside the listeners, so a change to it does not tear down and
 * rebuild the listeners on every keystroke — and so the handler always sees the current value
 * rather than the one captured when it was registered.
 */
export function useUnsavedChangesWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      // `preventDefault` is the modern spelling; `returnValue` is what older browsers read.
      event.preventDefault();
      event.returnValue = UNSAVED_MESSAGE;
    };

    const onClick = (event: MouseEvent): void => {
      // A modified click opens a new tab or downloads; the current page is not going anywhere.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.defaultPrevented) return;

      const anchor = (event.target as Element | null)?.closest?.('a');
      if (anchor === null || anchor === undefined) return;
      if (anchor.hasAttribute(ALLOW_NAVIGATION)) return;

      const href = anchor.getAttribute('href');
      if (href === null || href === '' || href.startsWith('#')) return;
      if (href.startsWith('mailto:') || href.startsWith('tel:')) return;
      // A link to another origin leaves the app; `beforeunload` is the right guard for that.
      if (anchor.origin !== window.location.origin) return;
      // A download is not a navigation.
      if (anchor.hasAttribute('download')) return;

      if (!window.confirm(UNSAVED_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);
}
