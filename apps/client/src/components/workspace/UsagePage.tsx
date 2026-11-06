'use client';

/**
 * The company's own activity: how much of the product this business is actually using.
 *
 * ## Why a company sees its own numbers
 *
 * The vendor's dashboard answers "is this customer worth renewing". This screen answers a different
 * question, for a different reader: an owner asking "how much quoting are we doing, and is anybody
 * actually opening the screens we paid for". Same table, scoped by the session rather than by a
 * parameter — a company cannot read another company's counts by editing a URL.
 *
 * ## Why three columns and not a chart
 *
 * A total alone says the product *has* been used; the 7- and 30-day columns say whether it is used
 * **now**. A company that wrote forty quotes last year and three this month is a different
 * conversation from one writing forty a month, and a chart would need a legend to say what two
 * numbers say in a row.
 *
 * ## Why the recent list carries no customer data
 *
 * The records are deliberately thin: that something happened, and when. No quote number, no customer
 * name, no price. A screen that showed them would be a second copy of the quote list with a weaker
 * access rule, and the event row does not contain them in the first place — so this panel could not
 * show them even if it wanted to.
 */

import { useEffect, useState } from 'react';
import { Panel, Stat } from '@sq/ui';
import { api } from '@/lib/sq';

interface UsageRow {
  kind: string;
  total: number;
  last7: number;
  last30: number;
}

/** One recorded event, as the API reports it. `detail` is a small JSON string, or `null`. */
interface RecentRow {
  id: string;
  at: string;
  kind: string;
  userId: string | null;
  detail: string | null;
}

/**
 * How a kind reads on screen.
 *
 * The API also answers `/usage/kinds`, and this list is intentionally local: those are the ids, and
 * this is the English. A screen that rendered raw ids would show `quote_created` to a shed owner.
 * A kind the API adds later falls through to its id rather than disappearing, which is the failure
 * that looks like "analytics stopped working".
 */
const KIND_LABEL: Record<string, string> = {
  quote_created: 'Quotes created',
  revision_saved: 'Revisions saved',
  mail_sent: 'Quotes emailed',
  page_view: 'Screens opened',
};

/** The route a page-view row names, as something a person recognises. */
function routeLabel(detail: string | null): string {
  if (detail === null) return '—';
  try {
    const parsed = JSON.parse(detail) as { route?: unknown };
    return typeof parsed.route === 'string' && parsed.route !== '' ? parsed.route : '—';
  } catch {
    return '—';
  }
}

export function UsagePage() {
  const [summary, setSummary] = useState<UsageRow[]>([]);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await api<{ scope: string; summary: UsageRow[]; recent: RecentRow[] }>(
        'usage?limit=50',
      );
      if (cancelled) return;
      setLoading(false);
      if (result.ok) {
        setSummary(result.data.summary);
        setRecent(result.data.recent);
        setError(null);
      } else {
        setError(result.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <Panel title="Activity">
        <p className="text-sq-body text-sq-ink-muted">Reading the record…</p>
      </Panel>
    );
  }

  if (error !== null) {
    return (
      <Panel title="Activity">
        <p role="alert" className="text-sq-body text-sq-danger">
          {error}
        </p>
      </Panel>
    );
  }

  const total = summary.reduce((sum, row) => sum + row.total, 0);
  const last30 = summary.reduce((sum, row) => sum + row.last30, 0);
  const last7 = summary.reduce((sum, row) => sum + row.last7, 0);

  return (
    <div className="flex flex-col gap-sq-4">
      <div className="grid gap-sq-4 sm:grid-cols-3">
        <Stat label="All time" value={String(total)} hint="Everything recorded" />
        <Stat label="Last 30 days" value={String(last30)} />
        <Stat label="Last 7 days" value={String(last7)} />
      </div>

      <Panel
        title="By kind"
        description="What the company has done, over the whole history and the two windows that matter."
        padded={false}
      >
        {summary.length === 0 ? (
          <p className="px-sq-3 py-sq-4 text-sq-body text-sq-ink-muted">
            Nothing recorded yet. Saving a quote, saving a revision or emailing one appears here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sq-body">
              <thead>
                <tr className="border-b border-sq-line text-left text-sq-micro text-sq-ink-muted">
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">What</th>
                  <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">All time</th>
                  <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">Last 30 days</th>
                  <th scope="col" className="px-sq-3 py-sq-2 text-right font-medium">Last 7 days</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={row.kind} className="border-b border-sq-line last:border-0">
                    <td className="px-sq-3 py-sq-2">{KIND_LABEL[row.kind] ?? row.kind}</td>
                    <td className="sq-numeric px-sq-3 py-sq-2 text-right">{row.total}</td>
                    <td className="sq-numeric px-sq-3 py-sq-2 text-right">{row.last30}</td>
                    <td className="sq-numeric px-sq-3 py-sq-2 text-right">{row.last7}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Recent" description="The last events, newest first." padded={false}>
        {recent.length === 0 ? (
          <p className="px-sq-3 py-sq-4 text-sq-body text-sq-ink-muted">No events yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sq-body">
              <thead>
                <tr className="border-b border-sq-line text-left text-sq-micro text-sq-ink-muted">
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">When</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">What</th>
                  <th scope="col" className="px-sq-3 py-sq-2 font-medium">Where</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.id} className="border-b border-sq-line last:border-0">
                    <td className="sq-numeric px-sq-3 py-sq-2 text-sq-ink-muted">
                      {row.at.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-sq-3 py-sq-2">{KIND_LABEL[row.kind] ?? row.kind}</td>
                    {/* Only a page view carries a route. Every other kind has nothing to add. */}
                    <td className="px-sq-3 py-sq-2 text-sq-micro text-sq-ink-muted">
                      {row.kind === 'page_view' ? routeLabel(row.detail) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
