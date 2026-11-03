'use client';

/**
 * Seats across every company.
 *
 * ## Why a cross-company table
 *
 * The company page can already change one company's seats. What it cannot answer is the question a
 * vendor actually asks on a Monday: *who is out of seats right now?* A saturated company refuses its
 * own staff at sign-in, and the only way to find that today is to open each company in turn.
 *
 * ## Why the "in use" figure is not the seat count
 *
 * A seat is a **live session**, so a crashed browser holds one until it is revoked or the session
 * expires. That is why a company can be at 5 of 5 with three people at their desks, and why this
 * screen shows both numbers rather than a percentage — `2 / 5` and `5 / 5` mean different things even
 * though only the second is a problem.
 */

import { useState } from 'react';
import { Button, Panel, StatusPill } from '@sq/ui';
import { api } from '@/lib/adminApi';

export interface SeatRow {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  seats: number;
  seatsInUse: number;
  subscriptionEndsAt: string | null;
  memberCount: number;
}

/** A company whose every seat is held, or whose subscription has run out. */
function needsAttention(row: SeatRow): boolean {
  if (row.seatsInUse >= row.seats) return true;
  return row.subscriptionEndsAt !== null && Date.parse(row.subscriptionEndsAt) < Date.now();
}

export function SeatManager({ initial }: { initial: SeatRow[] }) {
  const [rows, setRows] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const save = async (row: SeatRow): Promise<void> => {
    const raw = drafts[row.id] ?? String(row.seats);
    const seats = Number(raw);

    if (!Number.isInteger(seats) || seats < 1 || seats > 500) {
      setMessage({ tone: 'danger', text: 'Seats must be a whole number between 1 and 500.' });
      return;
    }

    setBusy(row.id);
    setMessage(null);

    const result = await api<{ seats: number | null }>(`admin/companies/${row.id}`, {
      method: 'PATCH',
      body: { seats },
    });

    setBusy(null);
    if (result.ok) {
      // The API answers with the new limit; the in-use count does not change, because lowering a
      // limit never evicts anybody already working.
      setRows((current) => current.map((entry) => (entry.id === row.id ? { ...entry, seats } : entry)));
      setDrafts((current) => ({ ...current, [row.id]: '' }));
      setMessage({
        tone: 'ok',
        text: `${row.name}: ${seats} seat(s). The new limit applies from the next sign-in.`,
      });
    } else {
      setMessage({ tone: 'danger', text: result.message });
    }
  };

  const attention = rows.filter(needsAttention);

  return (
    <div className="flex flex-col gap-sq-4">
      {message !== null && (
        <p
          role={message.tone === 'danger' ? 'alert' : 'status'}
          className={message.tone === 'danger' ? 'text-sq-body text-sq-danger' : 'text-sq-body text-sq-ink'}
        >
          {message.text}
        </p>
      )}

      {attention.length > 0 && (
        <Panel title={`${attention.length} need attention`} description="Out of seats, or the subscription has ended.">
          <ul className="flex list-disc flex-col gap-1 pl-sq-4 text-sq-body text-sq-ink">
            {attention.map((row) => (
              <li key={row.id}>
                <strong className="font-medium">{row.name}</strong>
                {row.seatsInUse >= row.seats && ` — every one of ${row.seats} seats is held, so a sign-in is refused.`}
                {row.subscriptionEndsAt !== null &&
                  Date.parse(row.subscriptionEndsAt) < Date.now() &&
                  ` — the subscription ended on ${row.subscriptionEndsAt.slice(0, 10)}.`}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Every company" description="Seats are live sessions, so 'in use' can exceed the people at their desks." padded={false}>
        {rows.length === 0 ? (
          <p className="px-sq-3 py-sq-4 text-sq-body text-sq-ink-muted">
            No companies. This installation has not been provisioned.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sq-body">
              <thead>
                <tr className="border-b border-sq-line text-left text-sq-micro text-sq-ink-muted">
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Company</th>
                  <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">People</th>
                  <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">In use</th>
                  <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">Seats</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Subscription</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">State</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const saturated = row.seatsInUse >= row.seats;
                  const expired = row.subscriptionEndsAt !== null && Date.parse(row.subscriptionEndsAt) < Date.now();

                  return (
                    <tr key={row.id} className="border-b border-sq-line last:border-0">
                      <td className="px-sq-3 py-sq-2">
                        <span className="block font-medium text-sq-ink">{row.name}</span>
                        <span className="block text-sq-micro text-sq-ink-muted">{row.slug}</span>
                      </td>
                      <td className="sq-numeric px-sq-3 py-sq-2 text-right">{row.memberCount}</td>
                      <td
                        className={[
                          'sq-numeric px-sq-3 py-sq-2 text-right',
                          saturated ? 'font-semibold text-sq-attention' : '',
                        ].join(' ')}
                      >
                        {row.seatsInUse}
                      </td>
                      <td className="px-sq-3 py-sq-2 text-right">
                        <input
                          aria-label={`Seats for ${row.name}`}
                          type="number"
                          min="1"
                          max="500"
                          value={drafts[row.id] ?? String(row.seats)}
                          onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: event.target.value }))}
                          className="w-20 rounded-md border border-sq-line bg-sq-surface px-sq-1 py-1 text-right text-sq-body"
                        />
                      </td>
                      <td className="px-sq-3 py-sq-2 text-sq-ink-muted">
                        {row.subscriptionEndsAt === null ? 'No end date' : row.subscriptionEndsAt.slice(0, 10)}
                        {expired && <span className="block text-sq-micro text-sq-danger">ended</span>}
                      </td>
                      <td className="px-sq-3 py-sq-2">
                        <StatusPill
                          tone={row.status === 'active' ? (saturated || expired ? 'attention' : 'ok') : 'danger'}
                          label={
                            row.status === 'active'
                              ? saturated
                                ? 'Full'
                                : expired
                                  ? 'Expired'
                                  : 'Active'
                              : 'Suspended'
                          }
                        />
                      </td>
                      <td className="px-sq-3 py-sq-2">
                        <Button loading={busy === row.id} onClick={() => void save(row)}>
                          Save
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-sq-micro text-sq-ink-muted">
        Lowering a seat count never signs anybody out: the seats already held stay held, and the new
        limit applies from the next sign-in.
      </p>
    </div>
  );
}
