'use client';

/**
 * Suspending a company, and putting it back.
 *
 * ## Why suspending is not "deleting with a flag"
 *
 * The API revokes every seat and every live session in the same transaction. That is the whole
 * point: a company that stops paying must stop working now, not when its people next sign in — and
 * a screen that only flipped a status column would look like it had done something while everybody
 * carried on quoting.
 *
 * ## Why it asks for a reason
 *
 * The reason is written to the audit log beside the acting staff member. Suspending a customer's
 * whole workspace is the most disruptive thing this control plane can do, and the question asked
 * weeks later is always "why was this done" — which a status column cannot answer.
 *
 * ## Why the confirmation is typed rather than a yes/no
 *
 * A dialog that says "are you sure" is dismissed by reflex. Typing the company's name is the
 * smallest thing that makes a person read which company they are about to cut off, and this
 * directory is a list of similar-looking names.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Panel } from '@sq/ui';
import { api } from '@/lib/adminApi';

export interface CompanyStatusProps {
  tenantId: string;
  name: string;
  /** `active` or `suspended`, as the API reports it. */
  status: string;
  /** How many people are signed in right now — what a suspension would end. */
  seatsInUse: number;
}

export function CompanyStatus({ tenantId, name, status, seatsInUse }: CompanyStatusProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const suspended = status === 'suspended';

  const apply = async (next: 'active' | 'suspended'): Promise<void> => {
    if (next === 'suspended' && confirmName.trim() !== name) {
      setMessage({ tone: 'danger', text: 'Type the company name exactly to confirm.' });
      return;
    }

    setBusy(true);
    setMessage(null);

    const result = await api<{ status: string }>(`admin/companies/${tenantId}/status`, {
      method: 'PATCH',
      body: {
        status: next,
        // An empty reason is omitted rather than sent as `''`: the contract takes it as optional,
        // and an empty string would be written to the audit log as a reason that says nothing.
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      },
    });

    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.message });
      return;
    }

    setMessage({
      tone: 'ok',
      text:
        next === 'suspended'
          ? `${name} is suspended. Every seat and session has been ended.`
          : `${name} is active again. Its people can sign in.`,
    });
    setReason('');
    setConfirmName('');
    // The page is a server component reading the company row; without this the pill above would
    // still say Active after a suspension.
    router.refresh();
  };

  return (
    <Panel
      title="Access"
      description={
        suspended
          ? 'This company cannot sign in. Nothing has been deleted.'
          : 'Ending access takes effect immediately, not at the next sign-in.'
      }
    >
      <div className="flex flex-col gap-sq-3">
        {!suspended && (
          <>
            <p className="text-sq-body text-sq-ink-muted">
              Suspending ends <strong className="text-sq-ink">{seatsInUse}</strong>{' '}
              {seatsInUse === 1 ? 'session' : 'sessions'} and every seat. People mid-quote lose their
              work in progress; saved revisions and sent documents are untouched.
            </p>
            <Field
              id="suspend-reason"
              label="Why"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Subscription lapsed — invoice 1042 unpaid"
              hint="Written to the audit log beside your name. Optional, but nobody remembers later."
            />
            <Field
              id="suspend-confirm"
              label={`Type ${name} to confirm`}
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              autoComplete="off"
              hint="A list of similar company names is easy to act on by mistake."
            />
          </>
        )}

        {message !== null && (
          <p
            role={message.tone === 'danger' ? 'alert' : 'status'}
            className={message.tone === 'danger' ? 'text-sq-body text-sq-danger' : 'text-sq-body text-sq-ink'}
          >
            {message.text}
          </p>
        )}

        <div>
          {suspended ? (
            <Button variant="primary" loading={busy} onClick={() => void apply('active')}>
              Make active again
            </Button>
          ) : (
            <Button
              loading={busy}
              disabled={confirmName.trim() !== name}
              onClick={() => void apply('suspended')}
            >
              Suspend this company
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
