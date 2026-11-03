'use client';

/**
 * The enquiry form.
 *
 * ## Why this exists now
 *
 * The landing page said "the enquiry form is wired to the API's public enquiry route … the endpoint
 * exists and is rate-limited". Neither half was true: there was no POST route and nothing had ever
 * written to the table. A page that promises a form and does not have one is discovered by the
 * person typing into it, so the copy and the code are now the same thing.
 *
 * ## Why the honeypot is invisible and not hidden
 *
 * `display: none` and `type="hidden"` are both detectable by a script. A field positioned off-screen
 * inside a wrapper marked `aria-hidden` is filled by a bot that reads the DOM and skipped by a
 * person who never sees it. The API answers a filled honeypot exactly like a real enquiry, so the
 * script learns nothing about which field gave it away.
 *
 * ## Why success replaces the form
 *
 * A second submission from the same person is a duplicate lead, and the rate limit would refuse it
 * with a message that reads like a failure. Replacing the form with one sentence is both honest and
 * the end of the interaction.
 */

import { useState } from 'react';
import { Button, Field } from '@sq/ui';

const API = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3060/api/v1';

type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string };

export function EnquiryForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [trap, setTrap] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setState({ kind: 'sending' });

    try {
      const response = await fetch(`${API}/enquiries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          ...(phone.trim() === '' ? {} : { phone }),
          message,
          source: 'contact',
          ...(trap === '' ? {} : { company: trap }),
        }),
      });

      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (payload.ok) setState({ kind: 'sent' });
      else setState({ kind: 'error', message: payload.message ?? 'That did not send. Try again.' });
    } catch {
      setState({ kind: 'error', message: 'The message could not be sent. Check your connection.' });
    }
  };

  if (state.kind === 'sent') {
    return (
      <div role="status" className="rounded-lg border border-sq-line bg-sq-surface p-sq-4">
        <h3 className="text-sq-body font-semibold text-sq-ink">Thank you — that reached us.</h3>
        <p className="mt-sq-1 text-sq-body text-sq-ink-muted">
          We will reply to {email}. If it is urgent, ring the number on the quote you were sent.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-sq-3" noValidate>
      {state.kind === 'error' && (
        <div
          role="alert"
          className="rounded-md border border-sq-danger/30 bg-sq-danger/10 px-sq-2 py-sq-2 text-sq-body text-sq-danger"
        >
          {state.message}
        </div>
      )}

      <div className="grid gap-sq-3 sm:grid-cols-2">
        <Field
          id="enquiry-name"
          label="Your name"
          required
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Field
          id="enquiry-email"
          label="Email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <Field
        id="enquiry-phone"
        label="Phone"
        type="tel"
        autoComplete="tel"
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        hint="Optional, but it is usually faster."
      />

      <label htmlFor="enquiry-message" className="flex flex-col gap-sq-1">
        <span className="text-sq-micro font-medium text-sq-ink">
          About the shed
          <span className="ml-1 text-sq-danger" aria-hidden="true">*</span>
          <span className="sr-only"> (required)</span>
        </span>
        <textarea
          id="enquiry-message"
          required
          rows={5}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Width, length, wall height, roof pitch, and where the doors go."
          className="min-h-28 rounded-md border border-sq-line bg-sq-surface px-sq-2 py-sq-1 text-sq-body text-sq-ink"
        />
      </label>

      {/*
        The honeypot. Off-screen rather than hidden, inside an `aria-hidden` wrapper so a screen
        reader never announces it and a person tabbing through never reaches it.
      */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="enquiry-company">Company</label>
        <input
          id="enquiry-company"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          value={trap}
          onChange={(event) => setTrap(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-sq-2">
        <Button type="submit" variant="primary" loading={state.kind === 'sending'}>
          Send the enquiry
        </Button>
        <span className="text-sq-micro text-sq-ink-muted">
          We use it to reply to you. Nothing else.
        </span>
      </div>
    </form>
  );
}
