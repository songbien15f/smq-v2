'use client';

/**
 * The two numbers a vendor actually sells: how many seats, and when the subscription ends.
 *
 * ## Why this is a component and not a form in the page
 *
 * The page is a server component that reads the company once. Editing needs a request, a pending
 * state and an error message — three things a server render cannot hold. So the read stays on the
 * server and only the write lives here.
 *
 * ## Why lowering the seat count does not evict anybody
 *
 * The API applies a new limit to the *next* sign-in. Evicting a salesperson mid-quote to satisfy a
 * billing change is the kind of surprise that loses a customer over a rounding error, so the screen
 * says what will happen rather than implying an immediate effect.
 */

import { useState } from 'react';
import { Button, Field, Panel } from '@sq/ui';
import { api } from '@/lib/adminApi';

export interface CompanyLimitsProps {
  tenantId: string;
  seats: number;
  seatsInUse: number;
  subscriptionEndsAt: string | null;
}

/** An ISO instant as the `datetime-local` input wants it, or `''`. */
function toLocalInput(iso: string | null): string {
  if (iso === null) return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  // `toISOString` is UTC; the input is local, so the offset has to be removed deliberately.
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function CompanyLimits({ tenantId, seats, seatsInUse, subscriptionEndsAt }: CompanyLimitsProps) {
  const [seatValue, setSeatValue] = useState(String(seats));
  const [endsAt, setEndsAt] = useState(toLocalInput(subscriptionEndsAt));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const save = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);

    const parsedSeats = Number(seatValue);
    if (!Number.isInteger(parsedSeats) || parsedSeats < 1 || parsedSeats > 500) {
      setBusy(false);
      setMessage({ tone: 'danger', text: 'Seats must be a whole number between 1 and 500.' });
      return;
    }

    const result = await api<{ seats: number | null }>(`admin/companies/${tenantId}`, {
      method: 'PATCH',
      body: {
        seats: parsedSeats,
        // An empty input means "no end date", which is a value the API accepts explicitly.
        subscriptionEndsAt: endsAt === '' ? null : new Date(endsAt).toISOString(),
      },
    });

    setBusy(false);
    setMessage(
      result.ok
        ? { tone: 'ok', text: 'Saved. The new limit applies from the next sign-in.' }
        : { tone: 'danger', text: result.message },
    );
  };

  const lowered = Number(seatValue) < seatsInUse;

  return (
    <Panel title="Seats and subscription" description="What this company has paid for.">
      <div className="flex flex-col gap-sq-3">
        <div className="grid gap-sq-3 sm:grid-cols-2">
          <Field
            id="limits-seats"
            label="Seats"
            type="number"
            inputMode="numeric"
            min={1}
            max={500}
            value={seatValue}
            onChange={(event) => setSeatValue(event.target.value)}
            hint={`${seatsInUse} in use right now.`}
          />
          <Field
            id="limits-ends"
            label="Subscription ends"
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            hint="Leave empty for no end date."
          />
        </div>

        {lowered && (
          <p className="text-sq-micro text-sq-attention">
            Fewer seats than are in use. Nobody is signed out — the people already working keep
            their seats, and the new limit applies from the next sign-in.
          </p>
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
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>
    </Panel>
  );
}
