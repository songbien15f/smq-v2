'use client';

/**
 * Whether this editor shows the Assistant column.
 *
 * The spec makes it a per-company switch ("tenant flag off falls back to the old three-column layout").
 * There is no such setting yet, so two stand-ins decide it: the build-time `NEXT_PUBLIC_SQ_ASSISTANT=1`,
 * and `?assistant=1` / `?assistant=0` on the address, which wins over the build setting so a layout can be
 * looked at without a rebuild. The URL is read after mount (the server cannot see it), so a page opened
 * with `?assistant=1` paints the old layout for one frame; acceptable for a preview switch, and the reason
 * the real switch should come from the session instead.
 */

import { useEffect, useState } from 'react';

export function useAssistantEnabled(): boolean {
  const [enabled, setEnabled] = useState(process.env.NEXT_PUBLIC_SQ_ASSISTANT === '1');
  useEffect(() => {
    try {
      const flag = new URLSearchParams(window.location.search).get('assistant');
      if (flag === '1') setEnabled(true);
      if (flag === '0') setEnabled(false);
    } catch {
      /* no address to read: keep the build setting */
    }
  }, []);
  return enabled;
}
