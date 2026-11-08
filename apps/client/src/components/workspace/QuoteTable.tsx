'use client';

/**
 * The quote list as a dense table, with B's two good ideas grafted on.
 *
 * ## The chips filter locally
 *
 * The list is already fetched whole (≤50 rows), so filtering by status needs no round trip — a
 * server-side filter would be the same answer one request slower, and stale the moment a quote
 * changes state in another tab. The counts on the chips come from the same array the rows do, so a
 * chip can never claim a number the table does not show.
 *
 * ## The whole row is the target, and the number is text
 *
 * A quote number in a table is 14–17 px tall — under the 24 CSS px WCAG 2.2 floor for a web target,
 * and awkward to hit even with a mouse. So the row itself is the link: an anchor stretched over the
 * row with `absolute inset-0`, and the number rendered as ordinary text inside it. That is the
 * standard "stretched link" pattern — one tab stop, one accessible name, and the entire 48 px row
 * width is clickable.
 *
 * The accessible name is written out (`Open Q-2026-0009 for Jane Citizen`) because an anchor with no
 * text of its own would otherwise be announced as nothing.
 *
 * ## "All" means the live quotes, and "Deleted" is its own chip
 *
 * A deleted quote is out of use — the row exists so the record of what a customer was sent survives.
 * It used to render inside "All", so a working list carried dead rows (measured 2026-11-08: 5 of 27,
 * $126,856.85 of contract value) and the numbers on the chips described a list nobody works from.
 * `All` now excludes them, and a `Deleted N` chip appears **only when there are some** — so the record
 * stays reachable without a permanent chip advertising a state most companies never have.
 *
 * The search box filters the current chip's rows on number, customer and suburb. It is here rather
 * than on the server because the list is already fetched whole (≤50 rows): a round trip would be the
 * same answer, one request later, and stale the moment another tab saves.
 */

import { useMemo, useState } from 'react';
import type { QuoteListItem } from '@sq/contracts';
import { money, date, Panel, StatusPill } from '@sq/ui';

/** A status reading order that puts the living states first and the dead ones last. */
const ORDER = ['draft', 'issued', 'accepted', 'declined', 'expired', 'deleted'] as const;

/** The statuses that mean "not in use". Their rows exist for the audit trail, not the work. */
function isDead(status: string): boolean {
  return status === 'deleted';
}

/**
 * The colour of a row's spine, by status. The word is still shown; the colour only leads the eye.
 *
 * A CSS value rather than a class, because it is painted as an `inset` box-shadow on the first cell
 * and the cell must **not** be a positioning context — the stretched anchor below is positioned
 * against the row, and a `relative` `<td>` would trap it inside one cell. That is exactly the bug
 * this replaced: the link covered 246 px of a 1174 px row.
 */
function spineFor(status: string): string {
  if (status === 'accepted') return 'var(--color-sq-ok)';
  if (status === 'issued') return 'var(--color-sq-info)';
  if (status === 'declined' || status === 'expired') return 'var(--color-sq-danger)';
  return 'color-mix(in srgb, var(--color-sq-ink-muted) 35%, transparent)';
}

function toneFor(status: string): 'ok' | 'attention' | 'danger' | 'info' | 'neutral' {
  if (status === 'accepted') return 'ok';
  if (status === 'declined' || status === 'expired') return 'danger';
  if (status === 'issued') return 'info';
  return 'neutral';
}

export function QuoteTable({ items }: { items: QuoteListItem[] }) {
  const [filter, setFilter] = useState<string>('');
  const [query, setQuery] = useState('');

  /** The living rows. `All` counts these, not the whole array — see the module comment. */
  const live = useMemo(() => items.filter((quote) => !isDead(quote.status)), [items]);
  const dead = useMemo(() => items.filter((quote) => isDead(quote.status)), [items]);

  const present = ORDER.filter((status) =>
    status === 'deleted' ? dead.length > 0 : live.some((q) => q.status === status),
  );

  const byStatus = filter === '' ? live : filter === 'deleted' ? dead : live.filter((q) => q.status === filter);

  const needle = query.trim().toLowerCase();
  const shown =
    needle === ''
      ? byStatus
      : byStatus.filter((quote) =>
          [quote.number, quote.customerName, quote.siteSuburb]
            .filter((part): part is string => typeof part === 'string')
            .some((part) => part.toLowerCase().includes(needle)),
        );

  const counts: Record<string, number> = { '': live.length };
  for (const status of present) {
    counts[status] = status === 'deleted' ? dead.length : live.filter((q) => q.status === status).length;
  }

  return (
    <div className="flex flex-col gap-sq-4">
      <div className="flex flex-wrap items-center gap-sq-2">
        <button
          type="button"
          onClick={() => setFilter('')}
          aria-pressed={filter === ''}
          className={[
            'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-sq-4 text-sq-body font-semibold transition-colors duration-sq-fast',
            filter === '' ? 'border-sq-brand bg-sq-brand text-white' : 'border-sq-line bg-sq-surface text-sq-ink-muted hover:bg-sq-ground',
          ].join(' ')}
        >
          All <span className="sq-numeric">{counts['']}</span>
        </button>
        {present.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilter(status)}
            aria-pressed={filter === status}
            className={[
              'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-sq-4 text-sq-body font-semibold capitalize transition-colors duration-sq-fast',
              filter === status ? 'border-sq-brand bg-sq-brand text-white' : 'border-sq-line bg-sq-surface text-sq-ink-muted hover:bg-sq-ground',
            ].join(' ')}
          >
            {status} <span className="sq-numeric">{counts[status]}</span>
          </button>
        ))}
        {filter !== '' && (
          <button
            type="button"
            onClick={() => setFilter('')}
            className="min-h-11 cursor-pointer px-sq-2 text-sq-body font-medium text-sq-ink-muted underline"
          >
            Clear
          </button>
        )}

        {/*
          Search, at the end of the chip row so it does not push the filters aside. Not a chip and not
          a panel: one input with a label a screen reader can announce, sized for a quote number.
        */}
        <div className="ml-auto flex min-w-0 items-center gap-sq-1">
          <label htmlFor="quote-search" className="sr-only">
            Search quotes by number, customer or site
          </label>
          <input
            id="quote-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Number, customer, site"
            className="min-h-11 w-full max-w-56 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body text-sq-ink placeholder:text-sq-ink-muted/70"
          />
        </div>
      </div>

      <Panel padded={false}>
        {shown.length === 0 ? (
          <p className="px-sq-4 py-sq-6 text-sq-body text-sq-ink-muted">
            {needle !== ''
              ? `No quotes match “${query.trim()}”.`
              : filter === 'deleted'
                ? 'No deleted quotes.'
                : 'No quotes with that status.'}
          </p>
        ) : (
          <>
            {/*
              Cards below `sm`, the table above it.

              A six-column table on a 390 px screen is a horizontal scroll with two columns visible at
              a time: the operator cannot see a quote's customer and its price together, which is the
              only comparison the screen exists for. A card shows all four facts at once — who, where,
              how far along, how much — in one glance, and each card is a 100 px tap target instead of
              a 48 px row.

              Same data, same links, same filter state: the table is not replaced, it is what the width
              allows. Nothing is computed twice — both render from `shown`.
            */}
            <ul className="flex flex-col gap-sq-2 p-sq-3 sm:hidden">
              {shown.map((quote) => (
                <li key={quote.id}>
                  <a
                    href={`/quotes/${quote.id}`}
                    aria-label={`Open ${quote.number}${quote.customerName ? ` for ${quote.customerName}` : ''}`}
                    className="block rounded-sq-lg border border-sq-line bg-sq-surface no-underline shadow-sm transition-colors duration-sq-fast hover:bg-sq-ground/60 focus-visible:bg-sq-ground/60"
                    style={{ boxShadow: `inset 3px 0 0 ${spineFor(quote.status)}, 0 1px 2px rgb(15 23 42 / 0.06)` }}
                  >
                    <div className="flex flex-col gap-sq-2 py-sq-2 pl-sq-4 pr-sq-3">
                      {/* Identity and state: the two facts that classify the card. */}
                      <div className="flex items-center justify-between gap-sq-2">
                        <span className="sq-numeric text-sq-micro font-medium text-sq-brand">{quote.number}</span>
                        <StatusPill tone={toneFor(quote.status)} label={quote.status} />
                      </div>

                      {/* Who it is for — the largest thing, because that is how a person looks for it. */}
                      <p className="text-sq-body-lg font-semibold leading-snug text-sq-ink">
                        {quote.customerName || 'No customer name'}
                      </p>

                      {quote.siteSuburb !== '' && (
                        <p className="-mt-sq-1 text-sq-micro text-sq-ink-muted">{quote.siteSuburb}</p>
                      )}

                      {/* The money, with what produced it underneath — one comparison per card. */}
                      <div className="flex items-end justify-between gap-sq-2 border-t border-sq-line/70 pt-sq-2">
                        <span className="text-sq-micro text-sq-ink-muted">
                          {quote.revision > 0 ? `rev ${quote.revision}` : 'not saved'} · {date(quote.updatedAt)}
                        </span>
                        <span className="flex flex-col items-end gap-0.5">
                          <span className="sq-numeric text-sq-title font-semibold tracking-tight text-sq-ink">
                            {quote.contractCents === null ? '—' : money(quote.contractCents)}
                          </span>
                          {quote.incomplete && (
                            <span className="text-sq-micro font-medium text-sq-attention">unpriced lines</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </a>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full border-collapse text-sq-body">
              <thead>
                <tr className="border-b border-sq-line text-left text-sq-micro uppercase tracking-wider text-sq-ink-muted">
                  <th scope="col" className="px-sq-3 py-sq-2 pl-sq-4 font-semibold">Number</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-semibold">Customer</th>
                  <th scope="col" className="hidden px-sq-3 py-sq-2 font-semibold sm:table-cell">Site</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-semibold">Status</th>
                  <th scope="col" className="hidden px-sq-3 py-sq-2 text-right font-semibold sm:table-cell">Rev</th>
                  <th scope="col" className="px-sq-3 py-sq-2 pr-sq-4 text-right font-semibold">Contract</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((quote) => (
                  /*
                   * `relative` on the row is what the stretched anchor below positions against, so the
                   * link covers the full row rather than the one cell it is written in.
                   */
                  <tr
                    key={quote.id}
                    className="group relative cursor-pointer border-b border-sq-line/70 last:border-0 hover:bg-sq-ground/70 focus-within:bg-sq-ground/70"
                  >
                    <td
                      className="h-12 px-sq-3 pl-sq-4 font-medium"
                      style={{ boxShadow: `inset 3px 0 0 ${spineFor(quote.status)}` }}
                    >
                      {/* Decorative: the row is the target, so this is text, not a second link. */}
                      <span className="sq-numeric text-sq-brand">{quote.number}</span>
                      <a
                        href={`/quotes/${quote.id}`}
                        aria-label={`Open ${quote.number}${quote.customerName ? ` for ${quote.customerName}` : ''}`}
                        className="absolute inset-0"
                      >
                        <span className="sr-only">Open quote</span>
                      </a>
                    </td>
                    <td className="px-sq-3">{quote.customerName || '—'}</td>
                    <td className="hidden px-sq-3 text-sq-ink-muted sm:table-cell">{quote.siteSuburb || '—'}</td>
                    <td className="px-sq-3">
                      <StatusPill tone={toneFor(quote.status)} label={quote.status} />
                    </td>
                    <td className="sq-numeric hidden px-sq-3 sm:table-cell">{quote.revision || '—'}</td>
                    {/* The figure the row exists for: larger than body text, so the eye lands on it first. */}
                    <td className="px-sq-3 pr-sq-4 text-right">
                      <span className="sq-numeric text-sq-title font-semibold tracking-tight text-sq-ink">
                        {quote.contractCents === null ? '—' : money(quote.contractCents)}
                      </span>
                      {quote.incomplete && (
                        <span className="mt-0.5 block text-sq-micro font-medium text-sq-attention">unpriced lines</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}