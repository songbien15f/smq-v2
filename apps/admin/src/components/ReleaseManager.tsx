'use client';

/**
 * Record a release, and list the ones before it.
 *
 * ## Why a release is a record and not a distribution
 *
 * The licence server published a desktop installer with a force-update flag. A web product has no
 * installer — everyone is on the deployed build the moment it ships. What a support call needs is
 * "what is this running, and what changed", and that is a row.
 */

import { useState } from 'react';
import { Button, DataTable, date, Field, Panel, StatusPill } from '@sq/ui';
import { api } from '@/lib/adminApi';

export interface ReleaseRow {
  id: string;
  label: string;
  engineVersion: number;
  priceBookHash: string | null;
  note: string;
  current: boolean;
  createdAt: string;
  createdBy: string | null;
}

export function ReleaseManager({ initial }: { initial: ReleaseRow[] }) {
  const [rows, setRows] = useState(initial);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const publish = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (label.trim() === '') return;
    setBusy(true);
    setMessage(null);

    const result = await api<{ id: string; label: string }>('admin/releases', {
      method: 'POST',
      body: { label: label.trim(), note: note.trim(), makeCurrent: true },
    });

    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.message });
      return;
    }
    setMessage({ tone: 'ok', text: `Release ${result.data.label} recorded and marked current.` });
    setLabel('');
    setNote('');
    // Re-read rather than splice: the new row cleared every other `current`, and a local edit would
    // leave two rows looking current.
    const refreshed = await api<{ items: ReleaseRow[] }>('admin/releases');
    if (refreshed.ok) setRows(refreshed.data.items);
  };

  return (
    <div className="flex flex-col gap-sq-4">
      <Panel title="Record a release" description="Marks it current. The one before it stays in the list below.">
        <form onSubmit={(event) => void publish(event)} className="flex flex-col gap-sq-3">
          <div className="grid gap-sq-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            <Field
              id="release-label"
              label="Label"
              required
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="2026.11.1"
              hint="What a person calls this release."
            />
            <Field
              id="release-note"
              label="What changed"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              hint="One line a support call can read."
            />
          </div>
          {message !== null && (
            <p
              role={message.tone === 'danger' ? 'alert' : 'status'}
              className={message.tone === 'danger' ? 'text-sq-body text-sq-danger' : 'text-sq-body text-sq-ink'}
            >
              {message.text}
            </p>
          )}
          <div>
            <Button type="submit" variant="primary" loading={busy} disabled={label.trim() === ''}>
              Record this release
            </Button>
          </div>
        </form>
      </Panel>

      <Panel title="Releases" padded={false}>
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          caption="Releases, newest first"
          empty="None recorded yet. Record the build this server is running, so a support call can name it."
          columns={[
            { key: 'label', header: 'Label', render: (row) => row.label, cellClassName: 'font-mono font-medium' },
            {
              key: 'engine',
              header: 'Engine',
              render: (row) => `v${row.engineVersion}`,
              cellClassName: 'font-mono text-sq-ink-muted',
            },
            { key: 'note', header: 'What changed', render: (row) => row.note || '—' },
            {
              key: 'recorded',
              header: 'Recorded',
              render: (row) => date(row.createdAt),
              cellClassName: 'whitespace-nowrap text-sq-ink-muted',
            },
            {
              key: 'state',
              header: 'State',
              render: (row) =>
                row.current ? <StatusPill tone="ok" label="Current" /> : <span className="text-sq-ink-muted">Earlier</span>,
            },
          ]}
        />
      </Panel>
    </div>
  );
}
