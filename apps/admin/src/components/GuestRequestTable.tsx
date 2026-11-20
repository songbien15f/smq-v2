'use client';

/**
 * The guest-request queue: what visitors designed on the website's guest page and sent.
 *
 * Filtered on the page rather than by a new request, because the list is short (the newest 200) and
 * the counts in the chips come from the whole table. New is the default view — it is the work.
 */

import { useState } from 'react';
import { DataTable, dateTime, StatusPill } from '@sq/ui';
import {
  STATUS_LABEL,
  STATUS_TONE,
  sizeText,
  type GuestRequestList,
  type GuestRequestStatus,
} from '@/lib/guestRequests';

type Filter = GuestRequestStatus | 'all';
const FILTERS: Filter[] = ['new', 'transferred', 'declined', 'spam', 'all'];

export function GuestRequestTable({ list, initialFilter }: { list: GuestRequestList; initialFilter: Filter }) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const visible = filter === 'all' ? list.items : list.items.filter((row) => row.status === filter);
  const total = Object.values(list.counts).reduce((sum, n) => sum + n, 0);
  const countOf = (key: Filter) => (key === 'all' ? total : list.counts[key]);

  return (
    <div className="flex flex-col">
      <div
        role="group"
        aria-label="Filter by status"
        className="flex flex-wrap gap-sq-1 border-b border-sq-line px-sq-3 py-sq-2"
      >
        {FILTERS.map((key) => {
          const selected = filter === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setFilter(key);
                window.history.replaceState(null, '', key === 'new' ? window.location.pathname : `?status=${key}`);
              }}
              className={[
                'inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border px-sq-2 text-sq-body',
                'transition-colors duration-sq-fast',
                selected
                  ? 'border-sq-brand bg-sq-brand text-white'
                  : 'border-sq-line bg-sq-surface text-sq-ink hover:bg-sq-ground',
              ].join(' ')}
            >
              {key === 'all' ? 'All' : STATUS_LABEL[key]}
              <span className={`sq-numeric text-sq-micro ${selected ? 'text-white/80' : 'text-sq-ink-muted'}`}>
                {countOf(key)}
              </span>
            </button>
          );
        })}
      </div>

      <DataTable
        rows={visible}
        rowKey={(row) => row.id}
        caption={`Guest requests, ${visible.length} shown`}
        empty={
          filter === 'new'
            ? 'Nothing new. A request sent from the guest page lands here.'
            : `No request is ${filter === 'all' ? 'stored yet' : `marked ${STATUS_LABEL[filter].toLowerCase()}`}.`
        }
        columns={[
          {
            key: 'number',
            header: 'Request',
            render: (row) => (
              <a
                href={`/guest-requests/${encodeURIComponent(row.number)}`}
                className="font-mono font-medium text-sq-ink no-underline hover:underline"
              >
                {row.number}
              </a>
            ),
          },
          {
            key: 'contact',
            header: 'Contact',
            render: (row) => (
              <div className="flex flex-col">
                <span className="text-sq-ink">{row.name || '—'}</span>
                <span className="text-sq-micro text-sq-ink-muted">{row.email}</span>
              </div>
            ),
          },
          {
            key: 'building',
            header: 'Building',
            render: (row) => (
              <div className="flex flex-col">
                <span className="text-sq-ink">{row.typeName || '—'}</span>
                <span className="text-sq-micro text-sq-ink-muted">{sizeText(row)}</span>
              </div>
            ),
          },
          {
            key: 'site',
            header: 'Site',
            render: (row) => [row.suburb, row.state].filter((part) => part !== '').join(' ') || '—',
          },
          {
            key: 'status',
            header: 'Status',
            render: (row) => (
              <div className="flex flex-wrap items-center gap-sq-1">
                <StatusPill tone={STATUS_TONE[row.status]} label={STATUS_LABEL[row.status]} />
                {row.reviewFlags.length > 0 && <StatusPill tone="attention" label="Check" />}
              </div>
            ),
          },
          {
            key: 'sent',
            header: 'Sent',
            render: (row) => dateTime(row.createdAt),
            cellClassName: 'text-sq-micro text-sq-ink-muted whitespace-nowrap',
          },
        ]}
      />
    </div>
  );
}
