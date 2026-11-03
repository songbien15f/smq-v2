'use client';

/**
 * Choose a password from a link.
 *
 * Used by both public pages that carry a token — `/reset` for a forgotten password and `/join` for
 * an accepted invitation — because the two do the same thing with a different grant: take a token
 * and two matching passwords, then arrive signed in.
 *
 * ## The token comes from the fragment, not the query
 *
 * `#token=…` never reaches a server access log and is not sent as `Referer` when the page loads a
 * resource, which is the same reason a customer share link uses one. The cost is that the token can
 * only be read in the browser, so this component is a client component and the matching pages
 * render nothing sensitive on the server.
 *
 * ## No token means no form
 *
 * A page reached without a fragment is a link somebody truncated. Rendering the form anyway would
 * let them type a new password into a request that is guaranteed to fail, so the component says the
 * link is dead and offers nothing to click.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field } from '@sq/ui';
import type { ApiResult } from '@sq/contracts';

export interface TokenPasswordFormProps {
  /** Where to post: `/auth/reset/confirm` or `/auth/join/confirm`. */
  endpoint: string;
  /** Where to land on success. Both flows sign the person in, so both go to the workspace. */
  onSuccessRedirect: string;
}

/** Read `#token=…` from the fragment. */
function tokenFromFragment(): string | null {
  const raw = window.location.hash.replace(/^#/, '');
  if (raw === '') return null;
  const value = new URLSearchParams(raw).get('token');
  return value === null || value.trim() === '' ? null : value.trim();
}

export function TokenPasswordForm({ endpoint, onSuccessRedirect }: TokenPasswordFormProps) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // The fragment is only available after hydration, so this cannot be a render-time read.
  useEffect(() => {
    setToken(tokenFromFragment());
    setReady(true);
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    if (token === null) {
      setBusy(false);
      setError('That link is no longer valid. Ask for a new one.');
      return;
    }

    try {
      const response = await fetch(`/api/sq/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      const result = (await response.json()) as ApiResult<unknown>;

      if (!result.ok) {
        setError(result.message);
        const details: Record<string, string> = {};
        for (const detail of result.details ?? []) details[detail.path] = detail.message;
        setFieldErrors(details);
        const first = result.details?.[0]?.path;
        if (first !== undefined) document.getElementById(first)?.focus();
        return;
      }

      // Drop the token from the address bar before navigating: it is spent, and leaving it in
      // history means the browser's back button would offer a dead link.
      window.history.replaceState({}, '', window.location.pathname);
      router.push(onSuccessRedirect);
      router.refresh();
    } catch {
      setError('The server could not be reached. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return null;

  if (token === null) {
    return (
      <div role="alert" className="text-sq-body text-sq-danger">
        That link is no longer valid. Ask for a new one.
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex w-full flex-col gap-sq-3" noValidate>
      <div>
        <h1 className="text-sq-title font-semibold">Choose a password</h1>
        <p className="mt-1 text-sq-body text-sq-ink-muted">
          At least 12 characters. You will be signed in when you save it.
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
        id="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldErrors.password}
      />

      <Field
        id="confirmPassword"
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        required
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        error={fieldErrors.confirmPassword}
      />

      <Button type="submit" variant="primary" loading={busy}>
        Set password
      </Button>
    </form>
  );
}
