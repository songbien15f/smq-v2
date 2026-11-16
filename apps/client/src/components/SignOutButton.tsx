'use client';

/**
 * Sign out, and the deliberate act of giving the seat back.
 *
 * ## Two different intentions, two controls
 *
 * A seat belongs to a device (DECISIONS D3), so an ordinary sign-out **keeps** the seat with this
 * browser: a person who signs out at lunch and back in afterwards should not have to find a free seat
 * twice. That is the common case, and it is the default.
 *
 * The other case is real and opposite: somebody at a shared machine, or finishing with the product,
 * wants the seat gone. Putting both behind one button would make the default wrong for one of those
 * people, so it is a second, named choice — and it says what it does before it does it.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@sq/ui';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState<'out' | 'release' | null>(null);

  const signOut = async (releaseDevice: boolean): Promise<void> => {
    if (releaseDevice) {
      const ok = window.confirm(
        'Sign out and free this device?\n\n' +
          'Your seat becomes available to a colleague straight away, and you will need a free seat ' +
          'to sign in on this browser again.',
      );
      if (!ok) return;
    }
    setBusy(releaseDevice ? 'release' : 'out');
    try {
      await fetch('/api/session', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(releaseDevice ? { releaseDevice: true } : {}),
      });
      router.push('/');
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <span className="flex items-center gap-sq-1">
      <Button
        variant="ghost"
        loading={busy === 'out'}
        className="text-white hover:bg-sq-brand-hover"
        onClick={() => void signOut(false)}
      >
        Sign out
      </Button>
      {/*
        Quieter than "Sign out": it is the rarer intention, and the one that costs somebody a seat. A
        person who means it will find it; a person who does not will not hit it by accident.
      */}
      <button
        type="button"
        onClick={() => void signOut(true)}
        disabled={busy !== null}
        className="cursor-pointer rounded-md px-sq-1 py-sq-1 text-sq-micro text-white/70 underline-offset-2 hover:text-white hover:underline disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy === 'release' ? 'Freeing…' : 'Free this device'}
      </button>
    </span>
  );
}
