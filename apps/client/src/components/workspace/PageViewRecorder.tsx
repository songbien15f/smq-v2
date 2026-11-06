'use client';

/**
 * Records that a screen was opened.
 *
 * ## Why this exists
 *
 * `POST /usage/page-view` was built and **never called** — `grep usage/page-view` over all three
 * apps returned nothing. So `usage_events` only ever held the events other routes wrote, and the
 * admin's "Screens opened" row was permanently 0. This is the second half of a defect that had
 * already been "fixed" once: the table started being written, but not by the page views that were
 * supposed to be its main source.
 *
 * ## Why it is deliberately quiet
 *
 * A page view is not something an operator should ever see fail. There is no error state, no retry
 * and no toast: the request is fire-and-forget, and a rejected promise is swallowed. A screen that
 * shows "could not record that you opened this" is worse than a missing row.
 *
 * ## Why it sends the pathname and not a page name
 *
 * The route is the fact. A label ("Quote editor") has to be maintained per page and drifts the first
 * time somebody renames a screen; the path is already correct by construction. The API truncates it
 * to 120 characters, which is enough to tell `/quotes/<uuid>/edit` from `/settings`.
 *
 * ## Why a ref and not an effect dependency
 *
 * `usePathname` changes on every navigation, and the effect must run once **per path** — a re-render
 * with the same path must not send a second event. The ref holds the last path sent.
 */

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

export function PageViewRecorder(): null {
  const pathname = usePathname();
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (pathname === null || pathname === lastSent.current) return;
    lastSent.current = pathname;

    /*
     * `keepalive` lets the request finish if the person navigates away immediately — a report of
     * "this screen was opened" is worthless if it is cancelled by the very next click. `no-store`
     * because a cached 200 would count one view per cache, not per person.
     */
    void fetch('/api/sq/usage/page-view', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ route: pathname }),
      cache: 'no-store',
      keepalive: true,
    }).catch(() => {
      // Silent on purpose: see the module comment.
    });
  }, [pathname]);

  return null;
}
