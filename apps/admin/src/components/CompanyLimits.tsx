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
import { Button, date, Field, Panel } from '@sq/ui';
import { api } from '@/lib/adminApi';

export interface CompanyLimitsProps {
  tenantId: string;
  seats: number;
  seatsInUse: number;
  subscriptionEndsAt: string | null;
}

/**
 * An ISO instant as the `date` input wants it (`YYYY-MM-DD`, local), or `''`.
 *
 * A subscription is sold by the day, so the screen asks for a date, not a time. A `datetime-local`
 * input also rendered in the browser's own order (`mm/dd/yyyy --:-- --` on a US-configured browser)
 * inside an `en-AU` app.
 */
function toDateInput(iso: string | null): string {
  if (iso === null) return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

/** The last moment of a picked day, local time: "ends 30 June" means it still works on 30 June. */
function endOfDay(day: string): string {
  return new Date(`${day}T23:59:59`).toISOString();
}

export function CompanyLimits({ tenantId, seats, seatsInUse, subscriptionEndsAt }: CompanyLimitsProps) {
  const [seatValue, setSeatValue] = useState(String(seats));
  const [endsAt, setEndsAt] = useState(toDateInput(subscriptionEndsAt));
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
        subscriptionEndsAt: endsAt === '' ? null : endOfDay(endsAt),
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
            hint={`${seatsInUse} held by signed-in devices.`}
          />
          <Field
            id="limits-ends"
            label="Subscription ends"
            type="date"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            // The picker draws the date in the browser's own order (a US browser shows mm/dd/yyyy), so
            // the hint repeats it in the app's format — 03/04 must not be read two ways.
            hint={endsAt === '' ? 'No end date. Pick a day to set one.' : `Ends at the end of ${date(endOfDay(endsAt))}.`}
          />
        </div>

        {lowered && (
          <p className="text-sq-micro text-sq-attention">
            Fewer seats than are in use. Nobody is signed out — devices that already hold a seat keep
            it, and a new browser is refused until enough seats come back.
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
