'use client';

/**
 * The enquiry queue.
 *
 * ## Why "handled" is a toggle rather than a delete
 *
 * An enquiry is a lead. Deleting one destroys the record that somebody asked and nobody answered —
 * which is the only thing that makes the queue trustworthy. Marking it handled keeps the history and
 * moves it out of the way, and the queue sorts unhandled first so the next one to answer is at the
 * top.
 *
 * ## Why the message is shown in full
 *
 * A truncated message is a message somebody has to go and look up. The row is a person's own words
 * about a shed; it is short by nature and it is the whole point of the screen.
 */

import { useState } from 'react';
import { Button, Panel, StatusPill } from '@sq/ui';
import { api } from '@/lib/adminApi';

export interface Enquiry {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  source: string;
  handled: boolean;
  createdAt: string;
}

function when(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso.slice(0, 16).replace('T', ' ');
  return parsed.toISOString().slice(0, 16).replace('T', ' ');
}

export function EnquiryList({ initial }: { initial: Enquiry[] }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (enquiry: Enquiry): Promise<void> => {
    setBusy(enquiry.id);
    setError(null);

    const result = await api<{ handled: boolean }>(`admin/enquiries/${enquiry.id}`, {
      method: 'PATCH',
      body: { handled: !enquiry.handled },
    });

    setBusy(null);
    if (result.ok) {
      setItems((current) =>
        current.map((row) => (row.id === enquiry.id ? { ...row, handled: !enquiry.handled } : row)),
      );
    } else {
      setError(result.message);
    }
  };

  const open = items.filter((item) => !item.handled);
  const done = items.filter((item) => item.handled);

  return (
    <div className="flex flex-col gap-sq-4">
      {error !== null && (
        <p role="alert" className="text-sq-body text-sq-danger">
          {error}
        </p>
      )}

      <Panel
        title={`Waiting (${open.length})`}
        description="People who asked about a shed and have not been answered."
        padded={false}
      >
        {open.length === 0 ? (
          <p className="px-sq-3 py-sq-4 text-sq-body text-sq-ink-muted">
            Nothing waiting. An enquiry from the website lands here.
          </p>
        ) : (
          <ul className="flex flex-col">
            {open.map((enquiry) => (
              <li key={enquiry.id} className="flex flex-col gap-sq-2 border-b border-sq-line px-sq-3 py-sq-3 last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-sq-2">
                  <div>
                    <span className="text-sq-body font-medium text-sq-ink">{enquiry.name}</span>
                    <a
                      href={`mailto:${enquiry.email}`}
                      className="ml-sq-2 text-sq-body text-sq-brand underline underline-offset-2"
                    >
                      {enquiry.email}
                    </a>
                    {enquiry.phone !== null && enquiry.phone !== '' && (
                      <a
                        href={`tel:${enquiry.phone}`}
                        className="ml-sq-2 text-sq-body text-sq-ink-muted underline underline-offset-2"
                      >
                        {enquiry.phone}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-sq-2">
                    <StatusPill tone="info" label={enquiry.source} />
                    <span className="text-sq-micro text-sq-ink-muted">{when(enquiry.createdAt)}</span>
                  </div>
                </div>
                <p className="whitespace-pre-line text-sq-body text-sq-ink">{enquiry.message}</p>
                <div>
                  <Button loading={busy === enquiry.id} onClick={() => void toggle(enquiry)}>
                    Mark handled
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {done.length > 0 && (
        <Panel title={`Handled (${done.length})`} description="Kept as a record, not deleted." padded={false}>
          <ul className="flex flex-col">
            {done.map((enquiry) => (
              <li
                key={enquiry.id}
                className="flex flex-wrap items-center justify-between gap-sq-2 border-b border-sq-line px-sq-3 py-sq-2 last:border-0"
              >
                <span className="text-sq-body text-sq-ink-muted">
                  {enquiry.name} · {enquiry.email} · {when(enquiry.createdAt)}
                </span>
                <Button loading={busy === enquiry.id} onClick={() => void toggle(enquiry)}>
                  Put back
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
