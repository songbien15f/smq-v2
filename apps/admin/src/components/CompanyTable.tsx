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
import { date, StatusPill } from '@sq/ui';
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
        <div className="max-h-[calc(100vh-15rem)] overflow-auto">
          <table className="w-full border-collapse text-sq-body">
            <caption className="sr-only">
              Companies, {visible.length} of {companies.length} shown
            </caption>
            <thead className="sticky top-0 z-10 bg-sq-surface shadow-[inset_0_-1px_0_var(--color-sq-line)]">
              <tr className="text-left text-sq-micro text-sq-ink-muted">
                <th scope="col" className="px-sq-3 py-sq-2 font-medium">Company</th>
                <th scope="col" className="px-sq-3 py-sq-2 font-medium">Code</th>
                <th scope="col" className="px-sq-3 py-sq-2 font-medium">State</th>
                <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">Seats in use</th>
                <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">People</th>
                <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">Quotes</th>
                <th scope="col" className="px-sq-3 py-sq-2 font-medium">Subscription ends</th>
                <th scope="col" className="px-sq-3 py-sq-2 font-medium">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((company) => {
                const state = companyState(company);
                const href = `/company/${encodeURIComponent(company.id)}`;
                return (
                  <tr
                    key={company.id}
                    className="h-9 border-b border-sq-line last:border-0 even:bg-sq-ground/40 hover:bg-sq-brand/5"
                  >
                    <td className="px-sq-3 py-1.5">
                      <a href={href} className="font-medium text-sq-ink no-underline hover:underline">
                        {company.name}
                      </a>
                      <span className="ml-sq-2 text-sq-micro text-sq-ink-muted">{company.slug}</span>
                    </td>
                    <td className="px-sq-3 py-1.5 font-mono text-sq-micro text-sq-ink">{company.code ?? '—'}</td>
                    <td className="px-sq-3 py-1.5 whitespace-nowrap">
                      <StatusPill tone={state.tone} label={state.label} />
                    </td>
                    <td
                      className={`sq-numeric px-sq-3 py-1.5 whitespace-nowrap ${
                        state.key === 'full' ? 'font-semibold text-sq-attention' : ''
                      }`}
                    >
                      {company.seatsInUse} / {company.seats}
                    </td>
                    <td className="sq-numeric px-sq-3 py-1.5">{company.memberCount}</td>
                    <td className="sq-numeric px-sq-3 py-1.5">{company.quoteCount}</td>
                    <td
                      className={`px-sq-3 py-1.5 whitespace-nowrap ${
                        state.key === 'ended' ? 'font-medium text-sq-attention' : 'text-sq-ink-muted'
                      }`}
                    >
                      {company.subscriptionEndsAt === null ? 'No end date' : date(company.subscriptionEndsAt)}
                    </td>
                    <td className="px-sq-3 py-1.5 text-right">
                      <a
                        href={href}
                        aria-label={`Open ${company.name}`}
                        className="inline-flex min-h-8 items-center rounded-md px-sq-2 text-sq-body font-medium text-sq-brand no-underline hover:bg-sq-ground"
                      >
                        Open ›
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
