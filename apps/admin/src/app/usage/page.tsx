import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { DataTable, Panel, count } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';

export const metadata: Metadata = { title: 'Usage' };

/**
 * Usage: what the product is being used for, across every company.
 *
 * ## Why three columns and not a total
 *
 * A total alone says the product has been used; it does not say whether it is being used **now**. A
 * company that wrote forty quotes last year and none this month is a renewal conversation, and the
 * 7- and 30-day columns are what make that visible without a chart nobody reads.
 *
 * ## Why this is its own page
 *
 * It shared `/platform` with releases and the template catalogue under the one nav label "Usage", so
 * a person looking for templates had no way to know they were here. The table needs no state, so the
 * page is a server render with no client code.
 */

interface UsageRow {
  kind: string;
  total: number;
  last7: number;
  last30: number;
}

/** How a usage kind reads. */
const KIND_LABEL: Record<string, string> = {
  quote_created: 'Quotes created',
  revision_saved: 'Revisions saved',
  mail_sent: 'Quotes emailed',
  page_view: 'Screens opened',
};

export default async function UsagePage() {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const allowed = session.data.capabilities.includes('platform:audit');
  // `summary`, not `items`: the route answers `{ scope, summary, recent }`. Reading `.items` crashed
  // this screen for every platform admin once (2026-11-06).
  const usage = allowed ? await serverFetch<{ scope: string; summary: UsageRow[] }>('/admin/usage') : null;

  return (
    <ShellFrame session={session.data} current="/usage">
      <div className="flex flex-col gap-sq-4">
        <div>
          <h1 className="text-sq-title font-semibold">Usage</h1>
          <p className="text-sq-body text-sq-ink-muted">What the product is being used for, across every company.</p>
        </div>

        {usage === null ? (
          <Panel title="Not available to your role">
            <p className="text-sq-body text-sq-ink-muted">Usage figures need the audit capability.</p>
          </Panel>
        ) : !usage.ok ? (
          <Panel title="Could not load usage">
            <p role="alert" className="text-sq-body text-sq-danger">
              {usage.message}
            </p>
          </Panel>
        ) : (
          <Panel padded={false}>
            <DataTable
              rows={usage.data.summary}
              rowKey={(row) => row.kind}
              caption="Usage by kind: all time, last 30 days and last 7 days"
              empty="Nothing recorded yet. A quote saved or emailed will appear here."
              columns={[
                { key: 'kind', header: 'What', render: (row) => KIND_LABEL[row.kind] ?? row.kind },
                { key: 'total', header: 'All time', numeric: true, render: (row) => count(row.total) },
                { key: 'last30', header: 'Last 30 days', numeric: true, render: (row) => count(row.last30) },
                { key: 'last7', header: 'Last 7 days', numeric: true, render: (row) => count(row.last7) },
              ]}
            />
          </Panel>
        )}
      </div>
    </ShellFrame>
  );
}
