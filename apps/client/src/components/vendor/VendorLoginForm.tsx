'use client';

/**
 * The dashboard's sign-in form.
 *
 * Its only job is the POST and the message back. The success path navigates with
 * `router.replace` rather than `push`: the login page must not be a Back destination once the
 * session exists, or Back lands on a form that immediately redirects forward again.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field } from '@sq/ui';

export function VendorLoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/vendor/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = (await response.json()) as { ok: boolean; message?: string };

      if (!response.ok || !body.ok) {
        setError(body.message ?? 'That password is not right.');
        setBusy(false);
        return;
      }

      router.replace('/dashboard');
      router.refresh();
    } catch {
      setError('The server could not be reached.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-sq-3">
      <Field
        id="vendor-password"
        label="Dashboard password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      {error !== null && (
        <p role="alert" className="rounded-md border border-sq-danger/30 bg-sq-danger/5 p-sq-2 text-sq-body text-sq-danger">
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" loading={busy} disabled={password === ''}>
        {busy ? 'Checking…' : 'Open the dashboard'}
      </Button>
    </form>
  );
}
