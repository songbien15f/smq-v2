'use client';

import { useMemo, useState } from 'react';
import { Button, DataTable, dateTime, type DataColumn } from '@sq/ui';

/**
 * The audit table, with a filter, a CSV of what is shown, and a way to copy a target's full id.
 *
 * ## Why the filter runs in the browser
 *
 * `GET /admin/audit` takes a `limit` and nothing else — no actor, action or date filter and no
 * cursor. Filtering the newest 200 rows here answers the question support actually asks ("what did
 * this person change last week?") without an API change; the page says plainly that older rows are
 * not loaded, rather than letting an empty filter result read as "never happened".
 *
 * ## Why the id has a copy button
 *
 * The target id is a 36-character uuid. Truncated to fit the column it could not be selected whole,
 * and the only thing anyone does with it is paste it into a search or a ticket.
 */

export interface AuditRow {
  id: string;
  at: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function downloadCsv(rows: readonly AuditRow[]): void {
  const header = ['at', 'actor', 'action', 'target_type', 'target_id', 'summary'];
  const lines = [
    header.join(','),
    ...rows.map((row) =>
      [row.at, row.actorEmail, row.action, row.targetType, row.targetId, row.summary].map(csvCell).join(','),
    ),
  ];
  // A byte-order mark so Excel reads the file as UTF-8 and a company name with a diacritic survives.
  const blob = new Blob(['﻿', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(id).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      title={id}
      className="inline-flex min-h-6 cursor-pointer items-center gap-1 rounded px-1 font-mono text-sq-micro text-sq-ink-muted hover:bg-sq-brand/5 hover:text-sq-ink"
    >
      <span>{id.slice(0, 8)}…</span>
      <span className="font-sans text-sq-brand" aria-live="polite">
        {copied ? 'Copied' : 'Copy'}
      </span>
      <span className="sr-only">full id {id}</span>
    </button>
  );
}

const SELECT =
  'min-h-11 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body text-sq-ink focus-visible:border-sq-brand';

export function AuditLog({ rows, limit }: { rows: AuditRow[]; limit: number }) {
  const [text, setText] = useState('');
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');

  const actors = useMemo(() => [...new Set(rows.map((row) => row.actorEmail))].sort(), [rows]);
  const actions = useMemo(() => [...new Set(rows.map((row) => row.action))].sort(), [rows]);

  const visible = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (actor === '' || row.actorEmail === actor) &&
        (action === '' || row.action === action) &&
        (needle === '' ||
          row.summary.toLowerCase().includes(needle) ||
          row.targetId.toLowerCase().includes(needle) ||
          row.targetType.toLowerCase().includes(needle)),
    );
  }, [rows, text, actor, action]);

  const filtered = text !== '' || actor !== '' || action !== '';

  const columns: DataColumn<AuditRow>[] = [
    {
      key: 'at',
      header: 'When',
      render: (row) => dateTime(row.at),
      cellClassName: 'whitespace-nowrap text-sq-ink-muted',
    },
    { key: 'who', header: 'Who', render: (row) => row.actorEmail },
    { key: 'action', header: 'Action', render: (row) => row.action, cellClassName: 'font-mono text-sq-micro text-sq-ink-muted' },
    {
      key: 'what',
      header: 'What',
      render: (row) => (
        <>
          {row.summary}
          <span className="flex flex-wrap items-center gap-1 text-sq-micro text-sq-ink-muted">
            {row.targetType} <CopyId id={row.targetId} />
          </span>
        </>
      ),
    },
  ];

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-end gap-sq-2 border-b border-sq-line px-sq-3 py-sq-2">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sq-micro font-medium text-sq-ink">
          Search
          <input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Summary or id"
            className={SELECT}
          />
        </label>
        <label className="flex flex-col gap-1 text-sq-micro font-medium text-sq-ink">
          Who
          <select value={actor} onChange={(event) => setActor(event.target.value)} className={SELECT}>
            <option value="">Everyone</option>
            {actors.map((email) => (
              <option key={email} value={email}>
                {email}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sq-micro font-medium text-sq-ink">
          Action
          <select value={action} onChange={(event) => setAction(event.target.value)} className={SELECT}>
            <option value="">Every action</option>
            {actions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="secondary" disabled={visible.length === 0} onClick={() => downloadCsv(visible)}>
          Download CSV
        </Button>
      </div>

      <p className="px-sq-3 py-sq-1 text-sq-micro text-sq-ink-muted" aria-live="polite">
        {filtered ? `${visible.length} of ${rows.length} shown` : `${rows.length} shown`}
        {rows.length >= limit && ` · only the newest ${limit} are loaded, so an older change will not appear here`}
      </p>

      <DataTable
        rows={visible}
        columns={columns}
        rowKey={(row) => row.id}
        caption={`Audit log, ${visible.length} entries`}
        empty={
          <>
            Nothing matches.{' '}
            <button
              type="button"
              onClick={() => {
                setText('');
                setActor('');
                setAction('');
              }}
              className="cursor-pointer font-medium text-sq-brand underline underline-offset-2"
            >
              Clear the filter
            </button>
          </>
        }
      />
    </div>
  );
}
