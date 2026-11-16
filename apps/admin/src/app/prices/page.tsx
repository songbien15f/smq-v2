import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { Page, SessionView } from '@sq/contracts';
import { Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { PriceOverridesPanel } from '@/components/PriceOverridesPanel';
import { CompanyPicker } from '@/components/CompanyPicker';
import { companyLabel } from '@/lib/companyState';

export const metadata: Metadata = { title: 'Company prices' };

/**
 * A company's own prices.
 *
 * The price list import writes these rows; until this screen nothing could read them back, and until
 * the evaluate route was wired they did not affect a quote either. Both halves exist now.
 *
 * The company comes from the URL (`?company=<id or slug>`), so the company page can link straight here.
 */
interface Version {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  note: string | null;
  rowCount: number;
  rows: { rowKey: string; unitCostCents: number; codeOverride: string | null; updatedAt: string }[];
}

export default async function PricesPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const params = await searchParams;
  const companies = await serverFetch<Page<{ id: string; name: string; slug: string; code: string | null }>>('/admin/companies?limit=200');
  const list = companies.ok ? companies.data.items : [];

  // The named company, or the first one. A URL that names a company that does not exist falls back
  // rather than erroring: an operator following a stale link should land somewhere useful.
  const selected = list.find((entry) => entry.id === params.company || entry.slug === params.company) ?? list[0];

  const overrides =
    selected === undefined
      ? null
      : await serverFetch<{ versions: Version[]; custom: unknown[] }>(
          `/admin/companies/${selected.id}/prices/overrides`,
        );

  return (
    <ShellFrame session={session.data} current="/prices">
      <div className="flex flex-col gap-sq-4">
        <div>
          <h1 className="text-sq-title font-semibold">Prices</h1>
          <p className="text-sq-body text-sq-ink-muted">
            {selected === undefined
              ? 'Each company’s own prices, applied over the shared book.'
              : `${companyLabel(selected)}: its own prices, applied over the shared book.`}
          </p>
        </div>

        {list.length > 1 && (
          <CompanyPicker action="/prices" companies={list} selectedId={selected?.id} />
        )}

        {selected === undefined ? (
          <Panel title="No company yet">
            <p className="text-sq-body text-sq-ink-muted">
              This installation has not been provisioned, so there are no prices to show.
            </p>
          </Panel>
        ) : overrides === null || !overrides.ok ? (
          <Panel title="Could not load the prices">
            <p className="text-sq-body text-sq-danger">
              {overrides !== null && overrides.code === 'forbidden'
                ? 'Your role cannot see this company’s prices.'
                : overrides !== null
                  ? overrides.message
                  : 'The request did not complete.'}
            </p>
          </Panel>
        ) : (
          <PriceOverridesPanel tenantId={selected.id} initial={overrides.data} />
        )}
      </div>
    </ShellFrame>
  );
}
