'use client';

/**
 * A single media-query hook for the layout shell.
 *
 * `useSyncExternalStore` is used deliberately: it gives React a stable
 * subscription and, critically, a separate *server* snapshot. On the server (and
 * during hydration) there is no `window`, so the hook reports `false` — the
 * mobile layout — and the first client render matches the server HTML. The
 * effect subscription then re-renders once with the real answer, so a desktop
 * visitor sees the sidebar without a hydration mismatch.
 *
 * jsdom has no `matchMedia` at all, so every branch that touches it is guarded;
 * a test environment therefore resolves the query to `false` rather than
 * throwing.
 */

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Tailwind's `lg` breakpoint, the single source of truth for the layout switch.
 *
 * `lg` rather than `md`: between 768 and 1023 px the two viewports already share
 * one cell, so a permanent control sidebar would squeeze the plan below 400 px.
 * Below `lg` the controls live in a drawer instead. The shell's rail uses the
 * same breakpoint, so the two never disagree about which layout is showing.
 */
export const DESKTOP_QUERY = '(min-width: 1024px)';

/** True when `window.matchMedia` is usable in the current environment. */
function canMatch(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!canMatch()) return () => {};
      const media = window.matchMedia(query);
      // `addEventListener` is the modern API; the deprecated `addListener` is the
      // only one Safari < 14 understands.
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', onStoreChange);
        return () => media.removeEventListener('change', onStoreChange);
      }
      media.addListener(onStoreChange);
      return () => media.removeListener(onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (!canMatch()) return false;
    return window.matchMedia(query).matches;
  }, [query]);

  // Server / hydration snapshot: always the mobile layout.
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
