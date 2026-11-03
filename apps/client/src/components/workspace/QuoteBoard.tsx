'use client';

/**
 * The quote list as a board: each quote is a card, and the contract price is what the eye lands on.
 *
 * ## Why cards instead of a table
 *
 * A table answers "find Q-2026-0004 fast", which matters at a hundred rows. A salesperson deciding
 * which of nine jobs to chase answers "which is the biggest, which are about to close" — and that
 * is a comparison of *figures*, so the figure is twice the size of the name. Direction B is the
 * right shape for a short list and the wrong one for a hundred rows, which is exactly why it was a
 * direction to choose and not an obvious default.
 *
 * ## The chips filter locally
 *
 * The list is already fetched whole (≤50 rows), so filtering by status needs no round trip. A
 * server-side filter would be the same answer a request slower, and a stale one the moment a quote
 * changes state in another tab.
 */

import { useState } from 'react';
import type { QuoteListItem } from '@sq/contracts';
import { money, ActionLink, StatusPill } from '@sq/ui';

/** A status reading order that puts the living states first and the dead ones last. */
const ORDER = ['draft', 'issued', 'accepted', 'declined', 'expired'] as const;

function toneFor(status: string): 'ok' | 'attention' | 'danger' | 'info' | 'neutral' {
  if (status === 'accepted') return 'ok';
  if (status === 'declined' || status === 'expired') return 'danger';
  if (status === 'issued') return 'info';
  return 'neutral';
}

/** "today" · "yesterday" · "3 days ago" — enough to order the list, never a promise of precision. */
function relativeToToday(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function QuoteBoard({ items }: { items: QuoteListItem[] }) {
  const [filter, setFilter] = useState<string>('');

  const present = ORDER.filter((status) => items.some((q) => q.status === status));
  const shown = filter === '' ? items : items.filter((q) => q.status === filter);

  const counts: Record<string, number> = { '': items.length };
  for (const status of present) counts[status] = items.filter((q) => q.status === status).length;

  return (
    <div className="flex flex-col gap-sq-6">
      <div className="flex flex-wrap items-center gap-sq-2">
        <button
          type="button"
          onClick={() => setFilter('')}
          className={[
            'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-sq-4 text-sq-body font-semibold transition-colors duration-sq-fast',
            filter === '' ? 'border-sq-brand bg-sq-brand text-white' : 'border-sq-line bg-sq-surface text-sq-ink-muted hover:bg-sq-ground',
          ].join(' ')}
        >
          All <span className="sq-numeric font-semibold">{counts['']}</span>
        </button>
        {present.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilter(status)}
            className={[
              'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-sq-4 text-sq-body font-semibold transition-colors duration-sq-fast',
              filter === status ? 'border-sq-brand bg-sq-brand text-white' : 'border-sq-line bg-sq-surface text-sq-ink-muted hover:bg-sq-ground',
            ].join(' ')}
          >
            <span className="capitalize">{status}</span> <span className="sq-numeric font-semibold">{counts[status]}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sq-body text-sq-ink-muted">No quotes with that status.</p>
      ) : (
        <div className="grid grid-cols-1 gap-sq-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((quote) => (
            <article
              key={quote.id}
              className="group flex flex-col gap-sq-3 rounded-sq-lg border border-sq-line bg-sq-surface p-sq-4 shadow-sm transition-[box-shadow,transform,border-color] duration-sq-base hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_10px_25px_-12px_rgba(7,24,50,0.35)]"
            >
              <div className="flex items-start justify-between gap-sq-2">
                <a
                  href={`/quotes/${quote.id}`}
                  className="sq-numeric inline-flex min-h-6 items-center text-sq-micro font-semibold text-sq-ink-muted hover:text-sq-brand"
                >
                  {quote.number}
                </a>
                <StatusPill tone={toneFor(quote.status)} label={quote.status} />
              </div>

              <a href={`/quotes/${quote.id}`} className="no-underline">
                <h2 className="text-sq-title font-semibold tracking-tight text-sq-ink group-hover:text-sq-brand">
                  {quote.customerName || 'Unnamed customer'}
                </h2>
                <p className="mt-0.5 text-sq-body text-sq-ink-muted">{quote.siteSuburb || 'No site yet'}</p>
              </a>

              <div className="mt-auto border-t border-sq-line/70 pt-sq-3">
                <span className="text-sq-micro font-semibold uppercase tracking-wider text-sq-ink-muted">Contract</span>
                <b className="sq-numeric mt-0.5 block text-sq-display font-semibold tracking-tight text-sq-ink">
                  {quote.contractCents === null ? '—' : money(quote.contractCents)}
                </b>
                {quote.incomplete && <span className="text-sq-micro font-medium text-sq-attention">unpriced lines — do not send</span>}
              </div>

              <div className="flex items-center gap-sq-3 text-sq-micro text-sq-ink-muted">
                <span className="sq-numeric">rev {quote.revision || 0}</span>
                <span aria-hidden="true">·</span>
                <span>{relativeToToday(quote.updatedAt)}</span>
              </div>
            </article>
          ))}

          <ActionLink
            href="/quotes/new"
            className="min-h-[220px] items-center justify-center rounded-sq-lg border border-dashed border-slate-300 !bg-transparent font-semibold text-sq-ink-muted hover:!bg-sq-brand/5 hover:text-sq-brand"
          >
            + Start a quote
          </ActionLink>
        </div>
      )}
    </div>
  );
}