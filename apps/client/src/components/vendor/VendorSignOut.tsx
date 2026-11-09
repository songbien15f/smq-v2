'use client';

/**
 * Sign out of the dashboard.
 *
 * A POST, not a link: the cookie is `HttpOnly`, so only a response can clear it — and a GET that
 * changes state is a link somebody can be tricked into following. This posts, then reloads so the
 * guard sends the visitor to the login page.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function VendorSignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const signOut = async (): Promise<void> => {
    setBusy(true);
    await fetch('/api/vendor/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/dashboard/login');
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-sq-line px-sq-3 text-sq-body font-medium text-sq-ink transition-colors duration-sq-fast hover:bg-sq-ground disabled:opacity-60"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
