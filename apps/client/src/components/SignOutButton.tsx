'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@sq/ui';

/** Sign out. Releases the seat on the server, then reloads. */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="ghost"
      loading={busy}
      className="text-white hover:bg-sq-brand-hover"
      onClick={async () => {
        setBusy(true);
        try {
          await fetch('/api/session', { method: 'DELETE' });
          router.push('/');
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      Sign out
    </Button>
  );
}
