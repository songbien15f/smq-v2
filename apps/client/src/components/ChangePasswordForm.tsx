'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field } from '@sq/ui';
import type { ApiResult } from '@sq/contracts';

export function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const response = await fetch('/api/account/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    });
    const result = (await response.json()) as ApiResult<{ changed: boolean }>;

    if (!result.ok) {
      setError(result.message);
      const details: Record<string, string> = {};
      for (const detail of result.details ?? []) details[detail.path] = detail.message;
      setFieldErrors(details);
      setBusy(false);
      return;
    }

    router.push('/quotes');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-sq-3" noValidate>
      {error !== null && (
        <div role="alert" className="rounded-md border border-sq-danger/30 bg-sq-danger/10 px-sq-2 py-sq-2 text-sq-body text-sq-danger">
          {error}
        </div>
      )}

      <Field
        id="currentPassword"
        label="Current password"
        type="password"
        autoComplete="current-password"
        required
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        error={fieldErrors.currentPassword}
      />
      <Field
        id="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 12 characters. Long beats complicated."
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        error={fieldErrors.newPassword}
      />
      <Field
        id="confirmPassword"
        label="Repeat the new password"
        type="password"
        autoComplete="new-password"
        required
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        error={fieldErrors.confirmPassword}
      />

      <Button type="submit" variant="primary" loading={busy}>
        Save the new password
      </Button>
      <p className="text-sq-micro text-sq-ink-muted">
        Saving signs out every other device on this account.
      </p>
    </form>
  );
}
