'use client';

/**
 * Sign in.
 *
 * Three behaviours worth naming:
 *
 * - The form posts to this app's own `/api/session` route, not directly to the API,
 *   so the session cookie is set on this origin and the browser never needs to send
 *   credentials cross-origin.
 * - Errors appear above the fields **and** under them, and focus moves to the first
 *   invalid field — a message at the top of a form with no focus move is a message a
 *   keyboard user has to hunt for.
 * - The submit button is disabled while a request is in flight, so a double-click is
 *   not two sign-ins. On a seat-limited account that second sign-in would take the
 *   last seat from a colleague.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, StatusPill } from '@sq/ui';
import type { ApiResult, SessionView } from '@sq/contracts';

export function SignInForm({ next }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const result = (await response.json()) as ApiResult<SessionView>;

      if (!result.ok) {
        setError(result.message);
        const details: Record<string, string> = {};
        for (const detail of result.details ?? []) details[detail.path] = detail.message;
        setFieldErrors(details);
        // Move focus to the first field with a problem.
        const firstPath = result.details?.[0]?.path;
        if (firstPath !== undefined) {
          document.getElementById(firstPath)?.focus();
        }
        return;
      }

      if (result.data.mustChangePassword) {
        router.push('/change-password');
        return;
      }
      router.push(next ?? '/quotes');
      router.refresh();
    } catch {
      setError('The server could not be reached. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-sq-3" noValidate>
      <div>
        <h1 className="text-sq-title font-semibold">Sign in</h1>
        <p className="mt-1 text-sq-body text-sq-ink-muted">
          Sign in with your vendor email address.
        </p>
      </div>

      {error !== null && (
        <div
          role="alert"
          className="rounded-md border border-sq-danger/30 bg-sq-danger/10 px-sq-2 py-sq-2 text-sq-body text-sq-danger"
        >
          {error}
        </div>
      )}

      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={fieldErrors.email}
      />

      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldErrors.password}
      />

      <Button type="submit" variant="primary" loading={busy}>
        Sign in
      </Button>

      <p className="text-sq-micro text-sq-ink-muted">
        <StatusPill tone="neutral" label="Seats are limited" /> Signing out releases your seat for a
        colleague.
      </p>
    </form>
  );
}
