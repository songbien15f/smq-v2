'use client';

/**
 * "I have forgotten my password."
 *
 * Two fields, and the company code comes first for the same reason it does at sign-in: the address
 * is only meaningful inside one company.
 *
 * ## The answer never changes
 *
 * Whatever happens, the form is replaced by one sentence: *if that email belongs to a person at
 * that company, we have sent them a link*. That is not politeness, it is the whole design — a page
 * that said "no such address" would let anybody test whether a competitor's estimator works here.
 * A misconfigured mail server is the one exception, and it answers before the lookup because it
 * describes the server rather than the address.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Button, Field } from '@sq/ui';
import type { ApiResult } from '@sq/contracts';

export function ForgotPasswordForm() {
  const [companyCode, setCompanyCode] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch('/api/sq/auth/reset/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyCode: companyCode.trim().toUpperCase(),
          email: email.trim().toLowerCase(),
        }),
      });
      const result = (await response.json()) as ApiResult<{ sent: true }>;

      if (!result.ok) {
        setError(result.message);
        const details: Record<string, string> = {};
        for (const detail of result.details ?? []) details[detail.path] = detail.message;
        setFieldErrors(details);
        const first = result.details?.[0]?.path;
        if (first !== undefined) document.getElementById(first)?.focus();
        return;
      }

      setSent(true);
    } catch {
      setError('The server could not be reached. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="flex w-full flex-col gap-sq-3">
        <h1 className="text-sq-title font-semibold">Check your email</h1>
        <p role="status" className="text-sq-body text-sq-ink">
          If that email belongs to a person at that company, we have sent them a link to choose a new
          password. It expires in an hour.
        </p>
        <p className="text-sq-body text-sq-ink-muted">
          The message names your company code and username, so keep it — those are what you type at
          sign-in.
        </p>
        <Link href="/" className="text-sq-body text-sq-brand underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex w-full flex-col gap-sq-3" noValidate>
      <div>
        <h1 className="text-sq-title font-semibold">Forgot your password?</h1>
        <p className="mt-1 text-sq-body text-sq-ink-muted">
          Enter your company code and the email on your account. We will send a link to choose a new
          password.
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
        id="companyCode"
        label="Company code"
        type="text"
        autoComplete="organization"
        autoCapitalize="characters"
        spellCheck={false}
        required
        value={companyCode.toUpperCase()}
        onChange={(event) => setCompanyCode(event.target.value)}
        error={fieldErrors.companyCode}
      />

      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={fieldErrors.email}
      />

      <Button type="submit" variant="primary" loading={busy}>
        Send the link
      </Button>

      <Link href="/" className="text-sq-micro text-sq-ink-muted underline">
        Back to sign in
      </Link>
    </form>
  );
}
