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
 * A seat belongs to a **device** — one browser profile, for one person (DECISIONS D3) — not to a
 * session. Signing out keeps it; it comes back when the company revokes the device under Team →
 * Devices, or when the device goes unused for `DEVICE_IDLE_DAYS` (14 by default). That is why a
 * company can be at 5 of 5 with three people at their desks — someone on a laptop and a tablet holds
 * two — and why this screen shows both numbers rather than a percentage: `2 / 5` and `5 / 5` mean
 * different things even though only the second is a problem.
 */

import { useState } from 'react';
import { Button, count, DataTable, date, Panel, StatusPill } from '@sq/ui';
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

function isExpired(row: SeatRow): boolean {
  return row.subscriptionEndsAt !== null && Date.parse(row.subscriptionEndsAt) < Date.now();
}

/** A company whose every seat is held, or whose subscription has run out. */
function needsAttention(row: SeatRow): boolean {
  return row.seatsInUse >= row.seats || isExpired(row);
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
                  ` — the subscription ended on ${date(row.subscriptionEndsAt)}.`}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Every company" description="A seat is one browser of one person, so 'in use' counts devices, not people." padded={false}>
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          caption="Seats for every company"
          empty="No companies. This installation has not been provisioned."
          columns={[
            {
              key: 'company',
              header: 'Company',
              render: (row) => (
                <>
                  <span className="block font-medium text-sq-ink">{row.name}</span>
                  <span className="block text-sq-micro text-sq-ink-muted">{row.slug}</span>
                </>
              ),
            },
            { key: 'people', header: 'People', numeric: true, render: (row) => count(row.memberCount) },
            {
              key: 'inUse',
              header: 'In use',
              numeric: true,
              render: (row) => count(row.seatsInUse),
              cellClassName: (row) => (row.seatsInUse >= row.seats ? 'font-semibold text-sq-attention' : ''),
            },
            {
              key: 'seats',
              header: 'Seats',
              numeric: true,
              render: (row) => (
                <input
                  aria-label={`Seats for ${row.name}`}
                  type="number"
                  min="1"
                  max="500"
                  value={drafts[row.id] ?? String(row.seats)}
                  onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: event.target.value }))}
                  className="w-20 rounded-md border border-sq-line bg-sq-surface px-sq-1 py-1 text-right text-sq-body"
                />
              ),
            },
            {
              key: 'subscription',
              header: 'Subscription',
              render: (row) => (
                <>
                  {row.subscriptionEndsAt === null ? 'No end date' : date(row.subscriptionEndsAt)}
                  {isExpired(row) && <span className="block text-sq-micro text-sq-danger">ended</span>}
                </>
              ),
              cellClassName: 'whitespace-nowrap text-sq-ink-muted',
            },
            {
              key: 'state',
              header: 'State',
              render: (row) => {
                const saturated = row.seatsInUse >= row.seats;
                const expired = isExpired(row);
                return (
                  <StatusPill
                    tone={row.status === 'active' ? (saturated || expired ? 'attention' : 'ok') : 'danger'}
                    label={
                      row.status === 'active' ? (saturated ? 'Full' : expired ? 'Expired' : 'Active') : 'Suspended'
                    }
                  />
                );
              },
            },
            {
              key: 'change',
              header: 'Change',
              render: (row) => (
                <Button loading={busy === row.id} onClick={() => void save(row)}>
                  Save
                </Button>
              ),
            },
          ]}
        />
      </Panel>

      <p className="text-sq-micro text-sq-ink-muted">
        Lowering a seat count never signs anybody out: devices that already hold a seat keep it, and a
        new browser is refused until the company is back under its limit. A seat comes back when the
        company revokes a device under Team → Devices, or after 14 days unused.
      </p>
    </div>
  );
}
