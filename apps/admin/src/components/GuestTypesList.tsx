'use client';

/**
 * The Guest building types: the list, and the two quick actions the list owns.
 *
 * ## What the list does, and what the form does
 *
 * Enabling, disabling and ordering happen here because they are one click and their result is visible
 * in the table. Everything else — names, limits, doors, colours — belongs to the editor at
 * `/guest-types/<id>`, which is a page of its own: a form with six sections inside a table row would
 * be unreadable on the phone this screen is sometimes opened on.
 *
 * ## Why "all off" asks first
 *
 * Switching every type off is legal and leaves the Guest page with no cards at all (`loadBuildingTypes`
 * answers an empty list when every row is disabled). That is a reasonable thing to do for an hour and
 * a catastrophic thing to do by accident, so the last one is confirmed before it happens.
 *
 * ## Why the id is shown
 *
 * It is what a deep link (`?type=…`), a saved draft and a sent request all point at, and it is the one
 * thing on this screen that can never be changed (Q5). Showing it is how somebody answering a support
 * call knows which type the customer is looking at.
 */

import { useState } from 'react';
import type { GuestBuildingTypeAdminRow } from '@sq/contracts';
import { Button, DataTable, date, Panel, StatusPill, type DataColumn } from '@sq/ui';
import { api } from '@/lib/adminApi';

/** `15000` → `15 m`; `1800` → `1.8 m`. */
function metres(mm: number): string {
  return `${Number((mm / 1000).toFixed(2))} m`;
}

export function GuestTypesList({
  initial,
  siteOrigin,
}: {
  initial: readonly GuestBuildingTypeAdminRow[];
  siteOrigin: string;
}) {
  const [rows, setRows] = useState<readonly GuestBuildingTypeAdminRow[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [confirmAllOff, setConfirmAllOff] = useState(false);

  const usingDefaults = rows.length > 0 && rows.every((row) => row.source === 'default');
  const enabledCount = rows.filter((row) => row.enabled).length;

  const reload = async (): Promise<void> => {
    const refreshed = await api<{ items: GuestBuildingTypeAdminRow[] }>('admin/guest-types');
    if (refreshed.ok) setRows(refreshed.data.items);
    else setMessage({ tone: 'danger', text: refreshed.message });
  };

  /** PATCH one field, then re-read. A 409 means somebody else saved; the message says so. */
  const patch = async (row: GuestBuildingTypeAdminRow, body: { enabled?: boolean; sortOrder?: number }) => {
    setBusy(row.id);
    setMessage(null);
    const result = await api<{ version: number }>(`admin/guest-types/${row.id}`, { method: 'PATCH', body });
    setBusy(null);
    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.message });
      if (result.code === 'conflict') await reload();
      return;
    }
    await reload();
  };

  const toggle = async (row: GuestBuildingTypeAdminRow) => {
    if (row.enabled && enabledCount === 1) {
      setConfirmAllOff(true);
      return;
    }
    await patch(row, { enabled: !row.enabled });
  };

  /**
   * Move a row one place.
   *
   * The whole order is sent, not a pair of sort orders: a swap done as two PATCHes leaves the list
   * briefly holding two equal orders if the second call fails, and the API's reorder writes the new
   * sequence in one transaction.
   */
  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const ordered = rows.map((row) => row.id);
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved!);
    setBusy('reorder');
    setMessage(null);
    const result = await api<{ ids: string[] }>('admin/guest-types/reorder', {
      method: 'POST',
      body: { ids: ordered },
    });
    setBusy(null);
    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.message });
      return;
    }
    await reload();
  };

  const columns: DataColumn<GuestBuildingTypeAdminRow>[] = [
    {
      key: 'order',
      header: 'Order',
      numeric: true,
      render: (row) => {
        const index = rows.findIndex((r) => r.id === row.id);
        return (
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              aria-label={`Move ${row.name} up`}
              disabled={index === 0 || busy !== null}
              onClick={() => void move(index, -1)}
              className="min-h-8 min-w-8 rounded-md border border-sq-line text-sq-ink-muted disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${row.name} down`}
              disabled={index === rows.length - 1 || busy !== null}
              onClick={() => void move(index, 1)}
              className="min-h-8 min-w-8 rounded-md border border-sq-line text-sq-ink-muted disabled:opacity-40"
            >
              ↓
            </button>
            <span className="tabular-nums text-sq-ink-muted">{row.sortOrder}</span>
          </span>
        );
      },
    },
    {
      key: 'name',
      header: 'Name',
      render: (row) => (
        <span className="flex flex-col">
          <a href={`/guest-types/${row.id}`} className="font-medium text-sq-ink underline-offset-2 hover:underline">
            {row.name}
          </a>
          {row.description === '' ? null : (
            <span className="text-sq-micro text-sq-ink-muted">{row.description}</span>
          )}
        </span>
      ),
    },
    {
      key: 'id',
      header: 'Id',
      render: (row) => <code className="text-sq-micro text-sq-ink-muted">{row.id}</code>,
    },
    {
      key: 'kind',
      header: 'Kind',
      render: (row) => (row.config.mode === 'enquiry' ? 'Enquiry only' : 'Design'),
    },
    {
      key: 'enclosure',
      header: 'Frame',
      render: (row) => (row.config.enclosure === 'roof_only' ? 'Roof only' : 'Enclosed'),
    },
    {
      key: 'width',
      header: 'Width',
      numeric: true,
      render: (row) => `${metres(row.config.limits.span.min)}–${metres(row.config.limits.span.max)}`,
    },
    {
      key: 'state',
      header: 'State',
      render: (row) => {
        if (row.invalid !== undefined) return <StatusPill tone="danger" label="Not shown on Guest" />;
        if (!row.enabled) return <StatusPill tone="neutral" label="Off" />;
        return <StatusPill tone="ok" label="Live" />;
      },
    },
    {
      key: 'version',
      header: 'Version',
      numeric: true,
      render: (row) => (
        <span className="flex flex-col items-end">
          <span className="tabular-nums">{row.version}</span>
          <span className="text-sq-micro text-sq-ink-muted">
            {row.source === 'default' || row.updatedAt === null ? 'code default' : date(row.updatedAt)}
          </span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      hideHeader: true,
      render: (row) => (
        <span className="flex flex-wrap items-center gap-sq-1">
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void toggle(row)}
            aria-label={`${row.enabled ? 'Switch off' : 'Switch on'} ${row.name}`}
          >
            {row.enabled ? 'Switch off' : 'Switch on'}
          </Button>
          <a
            href={`${siteOrigin}/quote?type=${encodeURIComponent(row.id)}`}
            target="_blank"
            rel="noreferrer"
            className="text-sq-micro text-sq-ink-muted underline-offset-2 hover:underline"
          >
            Open on Guest page
          </a>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-sq-3">
      {usingDefaults ? (
        <Panel title="Using the six types built into the product">
          <p className="text-sq-body text-sq-ink-muted">
            The database has no types yet, so the Guest page is served the six compiled into the
            application. <strong>Saving any change copies all six into the database first</strong>, and from
            then on the database is what the Guest page reads.
          </p>
        </Panel>
      ) : null}

      {rows.some((row) => row.invalid !== undefined) ? (
        <div role="alert" className="rounded-md border border-sq-danger px-sq-3 py-sq-2 text-sq-body text-sq-danger">
          A stored type could not be read, so the Guest page is skipping it. Open it and save a valid
          configuration.
        </div>
      ) : null}

      {message === null ? null : (
        <p role="status" className={`text-sq-body ${message.tone === 'danger' ? 'text-sq-danger' : 'text-sq-ink'}`}>
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-sq-2">
        <p className="text-sq-body text-sq-ink-muted">
          {enabledCount} of {rows.length} live on the Guest page.
        </p>
        <a
          href="/guest-types/new"
          className="inline-flex min-h-11 items-center rounded-md bg-sq-ink px-sq-3 text-sq-body font-medium text-sq-surface"
        >
          Add a type
        </a>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        caption="Guest building types, in the order the Guest page offers them"
        empty="No building types yet."
      />

      {confirmAllOff ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-sq-4" role="dialog" aria-modal="true" aria-labelledby="all-off-title">
          <div className="w-full max-w-md rounded-lg bg-sq-surface p-sq-4 shadow-lg">
            <h2 id="all-off-title" className="text-sq-subtitle font-semibold text-sq-ink">
              Switch off the last type?
            </h2>
            <p className="mt-sq-2 text-sq-body text-sq-ink-muted">
              The Guest page will then show <strong>no building types at all</strong>, so nobody can start a
              request until one is switched back on.
            </p>
            <div className="mt-sq-3 flex justify-end gap-sq-2">
              <Button variant="secondary" onClick={() => setConfirmAllOff(false)}>
                Keep it on
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmAllOff(false);
                  const last = rows.find((row) => row.enabled);
                  if (last !== undefined) void patch(last, { enabled: false });
                }}
              >
                Switch it off
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
