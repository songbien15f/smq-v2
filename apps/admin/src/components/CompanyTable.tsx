'use client';

/**
 * The company directory, as a table.
 *
 * It used to be one tall card per company, each carrying its own seat editor and suspend control, so
 * ten companies were ten screens of scrolling and the one out of seats was found by reading every
 * card. A vendor's questions here are "which company?" and "which ones need me?", and both are a scan
 * down a column — so each company is one row, the editing lives on the company's own page, and the
 * filter answers the second question directly.
 *
 * The search and filter are mirrored into the URL (`?q=` and `?state=`), so "the companies that need
 * attention" is a link an operator can bookmark or send, and the back button returns to the same view.
 */

import { useMemo, useState } from 'react';
import type { CompanyRow } from '@sq/contracts';
import { count, DataTable, date, StatusPill } from '@sq/ui';
import {
  COMPANY_FILTERS as FILTERS,
  companyState,
  matchesCompanyFilter as matchesFilter,
  type CompanyFilter,
} from '@/lib/companyState';

function matchesQuery(company: CompanyRow, query: string): boolean {
  if (query === '') return true;
  const needle = query.toLowerCase();
  return (
    company.name.toLowerCase().includes(needle) ||
    company.slug.toLowerCase().includes(needle) ||
    (company.code ?? '').toLowerCase().includes(needle)
  );
}

/** Says which of the two narrowed the list to nothing, so the operator knows which one to undo. */
function emptyMessage(query: string, filter: CompanyFilter): string {
  const label = FILTERS.find((entry) => entry.key === filter)?.label ?? filter;
  if (query === '') return `No company is under “${label}”.`;
  if (filter === 'all') return `No company is called or coded “${query}”.`;
  return `No company under “${label}” is called or coded “${query}”.`;
}

/** Keeps the address bar in step without a navigation, so typing does not re-render the server page. */
function writeUrl(query: string, filter: CompanyFilter): void {
  const params = new URLSearchParams();
  if (query !== '') params.set('q', query);
  if (filter !== 'all') params.set('state', filter);
  const search = params.toString();
  window.history.replaceState(null, '', search === '' ? window.location.pathname : `?${search}`);
}

export interface CompanyTableProps {
  companies: CompanyRow[];
  initialQuery?: string;
  initialFilter?: CompanyFilter;
}

function companyHref(company: CompanyRow): string {
  return `/company/${encodeURIComponent(company.id)}`;
}

export function CompanyTable({ companies, initialQuery = '', initialFilter = 'all' }: CompanyTableProps) {
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<CompanyFilter>(initialFilter);

  const counts = useMemo(() => {
    const result: Record<CompanyFilter, number> = { all: 0, attention: 0, active: 0, suspended: 0 };
    for (const company of companies) {
      for (const { key } of FILTERS) if (matchesFilter(company, key)) result[key] += 1;
    }
    return result;
  }, [companies]);

  const trimmed = query.trim();
  const visible = companies.filter((company) => matchesFilter(company, filter) && matchesQuery(company, trimmed));

  return (
    <section className="flex flex-col rounded-lg border border-sq-line bg-sq-surface">
      <div className="flex flex-wrap items-center justify-between gap-sq-2 border-b border-sq-line px-sq-3 py-sq-2">
        <div role="group" aria-label="Filter by state" className="flex flex-wrap gap-sq-1">
          {FILTERS.map(({ key, label }) => {
            const selected = filter === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setFilter(key);
                  writeUrl(trimmed, key);
                }}
                className={[
                  'inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border px-sq-2 text-sq-body',
                  'transition-colors duration-sq-fast',
                  selected
                    ? 'border-sq-brand bg-sq-brand text-white'
                    : 'border-sq-line bg-sq-surface text-sq-ink hover:bg-sq-ground',
                ].join(' ')}
              >
                {label}
                <span
                  className={`sq-numeric text-sq-micro ${selected ? 'text-white/80' : 'text-sq-ink-muted'}`}
                >
                  {counts[key]}
                </span>
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-sq-2 text-sq-micro text-sq-ink-muted">
          <span className="sr-only">Search companies</span>
          <input
            type="search"
            value={query}
            placeholder="Search name, code or slug"
            onChange={(event) => {
              setQuery(event.target.value);
              writeUrl(event.target.value.trim(), filter);
            }}
            className="min-h-9 w-64 max-w-full rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body text-sq-ink placeholder:text-sq-ink-muted"
          />
        </label>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-start gap-sq-2 px-sq-3 py-sq-6">
          <p className="text-sq-body font-semibold text-sq-ink">No company matches.</p>
          <p className="text-sq-body text-sq-ink-muted">
            {emptyMessage(trimmed, filter)}
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setFilter('all');
              writeUrl('', 'all');
            }}
            className="cursor-pointer text-sq-body font-medium text-sq-brand underline underline-offset-2"
          >
            Show every company
          </button>
        </div>
      ) : (
        <DataTable
          rows={visible}
          rowKey={(company) => company.id}
          caption={`Companies, ${visible.length} of ${companies.length} shown`}
          columns={[
            {
              key: 'company',
              header: 'Company',
              render: (company) => (
                <>
                  <a href={companyHref(company)} className="font-medium text-sq-ink no-underline hover:underline">
                    {company.name}
                  </a>
                  <span className="ml-sq-2 text-sq-micro text-sq-ink-muted">{company.slug}</span>
                </>
              ),
            },
            {
              key: 'code',
              header: 'Code',
              render: (company) => company.code ?? '—',
              cellClassName: 'font-mono text-sq-micro text-sq-ink',
            },
            {
              key: 'state',
              header: 'State',
              render: (company) => {
                const state = companyState(company);
                return <StatusPill tone={state.tone} label={state.label} />;
              },
              cellClassName: 'whitespace-nowrap',
            },
            {
              key: 'seats',
              header: 'Seats in use',
              numeric: true,
              render: (company) => `${count(company.seatsInUse)} / ${count(company.seats)}`,
              cellClassName: (company) =>
                `whitespace-nowrap ${companyState(company).key === 'full' ? 'font-semibold text-sq-attention' : ''}`,
            },
            { key: 'people', header: 'People', numeric: true, render: (company) => count(company.memberCount) },
            { key: 'quotes', header: 'Quotes', numeric: true, render: (company) => count(company.quoteCount) },
            {
              key: 'ends',
              header: 'Subscription ends',
              render: (company) =>
                company.subscriptionEndsAt === null ? 'No end date' : date(company.subscriptionEndsAt),
              cellClassName: (company) =>
                `whitespace-nowrap ${
                  companyState(company).key === 'ended' ? 'font-medium text-sq-attention' : 'text-sq-ink-muted'
                }`,
            },
            {
              key: 'open',
              header: 'Open',
              hideHeader: true,
              render: (company) => (
                <a
                  href={companyHref(company)}
                  aria-label={`Open ${company.name}`}
                  className="inline-flex min-h-8 items-center rounded-md px-sq-2 text-sq-body font-medium text-sq-brand no-underline hover:bg-sq-ground"
                >
                  Open ›
                </a>
              ),
              cellClassName: 'text-right',
            },
          ]}
        />
      )}
    </section>
  );
}
