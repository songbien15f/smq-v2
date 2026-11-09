'use client';

/**
 * The visits table: one row per sitting, expandable into what was done.
 *
 * ## Why this is a client component when the rest of the dashboard is server-rendered
 *
 * The expansion is local interaction — open one row, see its history — and it must not cost a page
 * reload. Sending a request per expand would turn a cheap disclosure into a round trip, and folding
 * the whole history into the page as hidden markup would triple the payload for rows nobody opens.
 * The data is already on the page; this only decides what is shown.
 *
 * ## Why the address is masked until clicked
 *
 * The operator asked to see the address and asked for it to be hidden until wanted. Both are
 * satisfied by a `<details>`-shaped reveal rather than a tooltip: a tooltip is unreachable on a
 * touch screen and disappears on scroll, and this is a value a person may need to read out.
 *
 * The masked form is what the API sent (`203.0.113.xx`); the full one is beside it. **Neither** is
 * rendered from the ciphertext here — decryption happens on the server, and this component only
 * chooses which of the two strings to show.
 */

import { Fragment, useState } from 'react';
import type { VisitRow } from '@/lib/vendorUsage';

/** `4m 12s`, `38s`, `2h 05m`. */
function duration(ms: number): string {
  if (ms <= 0) return '—';
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/** `2026-11-09 18:44`. */
function when(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return '—';
  const d = new Date(parsed);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `18:44:07` — the seconds matter inside a visit. */
function timeOnly(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return '—';
  const d = new Date(parsed);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** One address cell: masked, with the full value one click away. */
function Address({ masked, full }: { masked: string | null; full: string | null }) {
  const [revealed, setRevealed] = useState(false);

  if (masked === null && full === null) {
    return <span className="text-sq-ink-muted">—</span>;
  }

  /*
   * No full value to reveal: the row was written with a key that has since been rotated, so the
   * address is unreadable. Saying so is better than showing a placeholder that looks like a bug.
   */
  if (full === null) {
    return (
      <span className="font-mono text-sq-micro text-sq-ink-muted" title="The stored address cannot be decrypted with this key.">
        {masked ?? '—'}
        <span className="ml-sq-1 text-sq-attention">unreadable</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setRevealed((value) => !value)}
      aria-expanded={revealed}
      title={revealed ? 'Hide the last four characters' : 'Show the whole address'}
      className="cursor-pointer rounded px-sq-1 font-mono text-sq-micro text-sq-ink underline decoration-sq-line decoration-dotted underline-offset-2 hover:bg-sq-ground"
    >
      {revealed ? full : masked}
    </button>
  );
}

export function VisitTable({ visits }: { visits: VisitRow[] }) {
  const [open, setOpen] = useState<string | null>(null);

  if (visits.length === 0) {
    return (
      <p className="px-sq-3 py-sq-4 text-sq-body text-sq-ink-muted">
        No visit has been recorded yet. A visit is a signed-in session; the first one appears the next
        time somebody opens a screen.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sq-body">
        <thead>
          <tr className="border-b border-sq-line text-left text-sq-micro uppercase tracking-wider text-sq-ink-muted">
            <th scope="col" className="px-sq-3 py-sq-2 font-semibold">When</th>
            <th scope="col" className="px-sq-3 py-sq-2 font-semibold">Address</th>
            <th scope="col" className="px-sq-3 py-sq-2 font-semibold">Signed in as</th>
            <th scope="col" className="px-sq-3 py-sq-2 text-right font-semibold">Actions</th>
            <th scope="col" className="px-sq-3 py-sq-2 text-right font-semibold">Active for</th>
            <th scope="col" className="px-sq-3 py-sq-2 font-semibold">Last action</th>
            <th scope="col" className="w-8 px-sq-3 py-sq-2">
              <span className="sr-only">History</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visits.map((visit) => {
            const expanded = open === visit.sessionId;
            return (
              /*
               * The key belongs on the fragment: a map's direct child is what React reconciles, and a
               * bare `<>` cannot carry one — so the pair (row + its history) would be keyed by
               * position and reopening a different row would animate against the wrong data.
               */
              <Fragment key={visit.sessionId}>
                <tr className="border-b border-sq-line/70">
                  <td className="sq-numeric px-sq-3 py-sq-2 text-sq-micro">{when(visit.startedAt)}</td>
                  <td className="px-sq-3 py-sq-2">
                    <Address masked={visit.ipMasked} full={visit.ipFull} />
                  </td>
                  <td className="px-sq-3 py-sq-2">
                    {visit.actors.length === 0 ? (
                      <span className="text-sq-ink-muted">—</span>
                    ) : (
                      visit.actors.join(', ')
                    )}
                    {visit.tenant !== null && (
                      <span className="block text-sq-micro text-sq-ink-muted">{visit.tenant}</span>
                    )}
                  </td>
                  <td className="sq-numeric px-sq-3 py-sq-2">{visit.actions}</td>
                  <td className="sq-numeric px-sq-3 py-sq-2">{duration(visit.durationMs)}</td>
                  <td className="sq-numeric px-sq-3 py-sq-2 text-sq-micro text-sq-ink-muted">{timeOnly(visit.lastAt)}</td>
                  <td className="px-sq-2 py-sq-2">
                    {/*
                      A button with `aria-expanded`, not a `<details>`: the row above it carries the
                      columns, and a `<details>` cannot span them without a second table.
                    */}
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : visit.sessionId)}
                      aria-expanded={expanded}
                      aria-label={
                        expanded
                          ? `Hide what was done in the visit at ${when(visit.startedAt)}`
                          : `Show what was done in the visit at ${when(visit.startedAt)}`
                      }
                      className="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded text-sq-ink-muted hover:bg-sq-ground"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        aria-hidden="true"
                        className={`transition-transform duration-sq-fast ${expanded ? 'rotate-90' : ''}`}
                      >
                        <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </td>
                </tr>

                {expanded && (
                  <tr className="border-b border-sq-line/70 bg-sq-ground/60">
                    <td colSpan={7} className="px-sq-3 py-sq-2">
                      <p className="mb-sq-2 text-sq-micro font-medium uppercase tracking-wider text-sq-ink-muted">
                        What was done in this visit
                      </p>
                      <ol className="flex flex-col gap-sq-1">
                        {visit.events.map((event, index) => (
                          <li key={`${event.at}-${index}`} className="flex flex-wrap items-baseline gap-sq-2 text-sq-body">
                            <span className="sq-numeric text-sq-micro text-sq-ink-muted">{timeOnly(event.at)}</span>
                            <span className="text-sq-ink">{event.action}</span>
                            {event.detail !== null && (
                              <code className="font-mono text-sq-micro text-sq-ink-muted">{event.detail}</code>
                            )}
                          </li>
                        ))}
                      </ol>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
