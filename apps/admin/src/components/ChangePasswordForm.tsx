'use client';

/**
 * Choosing a password, for a newly provisioned platform administrator.
 *
 * ## Why this screen had to exist
 *
 * `SignInForm` navigates here when the session says `mustChangePassword`, and the route did not
 * exist — so **every newly created platform administrator landed on a 404** immediately after their
 * first sign-in. A temporary password that cannot be replaced is a password that stays in force.
 *
 * ## Why the current password is asked for again
 *
 * The session already proves who this is. Asking again is what stops an unattended browser from
 * being used to set a password the owner does not know — the one attack a change-password screen
 * exists to prevent.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field } from '@sq/ui';
import { api } from '@/lib/adminApi';

export function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const result = await api<{ changed: boolean }>('auth/password', {
      method: 'POST',
      body: { currentPassword, newPassword, confirmPassword },
    });

    if (!result.ok) {
      setError(result.message);
      const details: Record<string, string> = {};
      for (const detail of result.details ?? []) details[detail.path] = detail.message;
      setFieldErrors(details);
      setBusy(false);
      return;
    }

    router.push('/company');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-sq-3" noValidate>
      {error !== null && (
        <div
          role="alert"
          className="rounded-md border border-sq-danger/30 bg-sq-danger/10 px-sq-2 py-sq-2 text-sq-body text-sq-danger"
        >
          {error}
        </div>
      )}

      <Field
        id="current-password"
        label="Current password"
        type="password"
        autoComplete="current-password"
        required
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        {...(fieldErrors.currentPassword === undefined ? {} : { error: fieldErrors.currentPassword })}
      />
      <Field
        id="new-password"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        hint="At least 12 characters. Length beats punctuation."
        {...(fieldErrors.newPassword === undefined ? {} : { error: fieldErrors.newPassword })}
      />
      <Field
        id="confirm-password"
        label="New password again"
        type="password"
        autoComplete="new-password"
        required
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        {...(fieldErrors.confirmPassword === undefined ? {} : { error: fieldErrors.confirmPassword })}
      />

      <div>
        <Button type="submit" variant="primary" loading={busy}>
          Set the password
        </Button>
      </div>
    </form>
  );
}
