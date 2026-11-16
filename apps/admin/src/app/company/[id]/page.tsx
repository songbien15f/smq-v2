import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { CompanyRow, Page, SessionView } from '@sq/contracts';
import { ActionLink, date, Panel, Stat, StatusPill } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { companyState } from '@/lib/companyState';
import { ShellFrame } from '@/components/ShellFrame';
import { CompanyLimits } from '@/components/CompanyLimits';
import { CompanyStatus } from '@/components/CompanyStatus';

/**
 * One company.
 *
 * Everything that changes a company lives here rather than on the directory: what it has paid for
 * (seats and end date), its own price list, and — last, under its own heading — ending its access.
 * Suspending is the most disruptive action in the control plane, so it is the furthest from the top
 * and still asks for the company's name to be typed.
 *
 * There is no single-company read in the API, so the row comes from the same list the directory reads
 * (`limit=200`, the directory's own ceiling). Adding `GET /admin/companies/:id` would be the tidier
 * shape once there are more companies than that; until then this keeps the two pages showing the same
 * numbers. The URL accepts the slug as well as the id, so a link typed by hand works.
 *
 * Members are not listed: the admin API has no route that reads one company's people (only the count).
 */
/** The company's name in the tab, so three open companies are three tabs a person can tell apart. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const [{ id }, companies] = await Promise.all([
    params,
    serverFetch<Page<CompanyRow>>('/admin/companies?limit=200'),
  ]);
  const wanted = decodeURIComponent(id);
  const company = companies.ok
    ? companies.data.items.find((entry) => entry.id === wanted || entry.slug === wanted)
    : undefined;
  return { title: company?.name ?? 'Company' };
}

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const [{ id }, companies] = await Promise.all([
    params,
    serverFetch<Page<CompanyRow>>('/admin/companies?limit=200'),
  ]);
  const wanted = decodeURIComponent(id);

  const frame = (children: React.ReactNode) => (
    <ShellFrame session={session.data} current="/company">
      <div className="flex max-w-4xl flex-col gap-sq-4">
        <a href="/company" className="w-fit text-sq-body text-sq-ink-muted no-underline hover:text-sq-ink">
          ‹ Companies
        </a>
        {children}
      </div>
    </ShellFrame>
  );

  if (!companies.ok) {
    return frame(
      <Panel title="Could not load the company">
        <p className="text-sq-body text-sq-danger">
          {companies.code === 'forbidden'
            ? 'Your role cannot see the companies. Ask for platform support access.'
            : companies.message}
        </p>
      </Panel>,
    );
  }

  const company = companies.data.items.find((entry) => entry.id === wanted || entry.slug === wanted);
  if (company === undefined) notFound();

  const state = companyState(company);
  const canCreate = session.data.capabilities.includes('platform:companies');
  const canEditLimits = session.data.capabilities.includes('platform:seats');

  return frame(
    <>
      <header className="flex flex-col gap-sq-1">
        <div className="flex flex-wrap items-center gap-sq-2">
          <h1 className="text-sq-title font-semibold">{company.name}</h1>
          <StatusPill tone={state.tone} label={state.label} />
        </div>
        <p className="text-sq-body text-sq-ink-muted">
          Code <span className="font-mono text-sq-ink">{company.code ?? '—'}</span> · slug{' '}
          <span className="font-mono">{company.slug}</span> · created {date(company.createdAt)}
        </p>
      </header>

      <Panel title="Overview">
        <div className="grid gap-sq-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Seats in use"
            value={`${company.seatsInUse} / ${company.seats}`}
            hint="Devices holding a seat, of those purchased"
            tone={state.key === 'full' ? 'attention' : 'neutral'}
          />
          <Stat label="People" value={String(company.memberCount)} />
          <Stat label="Quotes" value={String(company.quoteCount)} />
          <Stat
            label="Subscription ends"
            value={company.subscriptionEndsAt === null ? 'No end date' : date(company.subscriptionEndsAt)}
            tone={state.key === 'ended' ? 'attention' : 'neutral'}
          />
        </div>
      </Panel>

      {canEditLimits ? (
        <CompanyLimits
          tenantId={company.id}
          seats={company.seats}
          seatsInUse={company.seatsInUse}
          subscriptionEndsAt={company.subscriptionEndsAt}
        />
      ) : (
        <Panel title="Seats and subscription">
          <p className="text-sq-body text-sq-ink-muted">
            Changing seats or the end date needs the seats capability.
          </p>
        </Panel>
      )}

      <Panel
        title="Prices"
        description="Its overrides of the price book, and its own custom items."
        actions={
          <ActionLink href={`/prices?company=${encodeURIComponent(company.id)}`}>Open its prices</ActionLink>
        }
      >
        <p className="text-sq-body text-sq-ink-muted">
          Edited on the company prices screen, opened on {company.name}.
        </p>
      </Panel>

      {canCreate && (
        <CompanyStatus
          tenantId={company.id}
          name={company.name}
          status={company.status}
          seatsInUse={company.seatsInUse}
        />
      )}
    </>,
  );
}
