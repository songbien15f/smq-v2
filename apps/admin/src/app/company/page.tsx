import { redirect } from 'next/navigation';
import type { CompanyRow, Page, SessionView } from '@sq/contracts';
import { date, Panel, Stat, StatusPill } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { CompanyLimits } from '@/components/CompanyLimits';

/**
 * The company.
 *
 * Singular, because there is exactly one. The list this replaces was the licence server's
 * multi-company control plane, and keeping a "companies" screen for a single row would invite
 * somebody to add a create button to it — which the API would refuse, leaving a feature that
 * looks broken rather than one that is absent.
 *
 * What is left is what an account manager actually needs on a support call: the seats, how
 * many are in use, and when the subscription ends.
 */
export default async function CompanyPage() {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const companies = await serverFetch<Page<CompanyRow>>('/admin/companies?limit=2');

  if (!companies.ok) {
    return (
      <ShellFrame account={<SignOutButton />} capabilities={session.data.capabilities} current="/company">
        <Panel title="Could not load the company">
          <p className="text-sq-body text-sq-danger">
            {companies.code === 'forbidden'
              ? 'Your role cannot see the company. Ask for platform support access.'
              : companies.message}
          </p>
        </Panel>
      </ShellFrame>
    );
  }

  const company = companies.data.items[0];

  if (company === undefined) {
    return (
      <ShellFrame account={<SignOutButton />} capabilities={session.data.capabilities} current="/company">
        <Panel title="No company yet">
          <p className="text-sq-body text-sq-ink-muted">
            This installation has not been provisioned. Run the installer before serving traffic:
          </p>
          <pre className="mt-sq-2 overflow-x-auto rounded-md bg-sq-ground p-sq-2 text-sq-micro">
            COMPANY_NAME=&quot;…&quot; COMPANY_ADMIN_EMAIL=&quot;…&quot; COMPANY_ADMIN_PASSWORD=&quot;…&quot; pnpm
            install:company
          </pre>
        </Panel>
      </ShellFrame>
    );
  }

  const saturated = company.seatsInUse >= company.seats;
  const expired =
    company.subscriptionEndsAt !== null && Date.parse(company.subscriptionEndsAt) < Date.now();

  return (
    <ShellFrame account={<SignOutButton />} capabilities={session.data.capabilities} current="/company">
      <div className="flex flex-col gap-sq-4">
        <div className="flex flex-wrap items-end justify-between gap-sq-2">
          <div>
            <h1 className="text-sq-title font-semibold">{company.name}</h1>
            <p className="text-sq-body text-sq-ink-muted">
              {company.slug} · signed in as {session.data.email}
            </p>
          </div>
          <StatusPill
            tone={company.status === 'active' ? 'ok' : 'danger'}
            label={company.status === 'active' ? 'Active' : 'Suspended'}
          />
        </div>

        <div className="grid gap-sq-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Seats" value={String(company.seats)} hint="Purchased" />
          <Stat
            label="In use"
            value={String(company.seatsInUse)}
            hint="Live sessions"
            tone={saturated ? 'attention' : 'neutral'}
          />
          <Stat label="People" value={String(company.memberCount)} />
          <Stat label="Quotes" value={String(company.quoteCount)} />
        </div>

        {(saturated || expired) && (
          <Panel title="Needs attention">
            <ul className="flex list-disc flex-col gap-1 pl-sq-4 text-sq-body text-sq-ink">
              {saturated && (
                <li>
                  Every seat is in use. A person signing in now will be refused with “every seat in this
                  company is in use” — close a session, or add seats.
                </li>
              )}
              {expired && (
                <li>
                  The subscription ended on {date(company.subscriptionEndsAt as string)}. The company still
                  signs in; nothing in this build enforces the end date yet.
                </li>
              )}
            </ul>
          </Panel>
        )}

        <Panel title="Subscription">
          <dl className="grid gap-sq-2 sm:grid-cols-2">
            <div>
              <dt className="text-sq-micro text-sq-ink-muted">Ends</dt>
              <dd className="text-sq-body">
                {company.subscriptionEndsAt === null ? 'No end date' : date(company.subscriptionEndsAt)}
              </dd>
            </div>
            <div>
              <dt className="text-sq-micro text-sq-ink-muted">Created</dt>
              <dd className="text-sq-body">{date(company.createdAt)}</dd>
            </div>
          </dl>
        </Panel>

        {/*
          The two numbers a vendor sells. `companyLimitsRequest` existed in the contracts and no
          route used it, so seats could only be changed by editing the database — the one figure a
          licence is priced on had no screen.
        */}
        {session.data.capabilities.includes('platform:seats') && (
          <CompanyLimits
            tenantId={company.id}
            seats={company.seats}
            seatsInUse={company.seatsInUse}
            subscriptionEndsAt={company.subscriptionEndsAt}
          />
        )}

        <p className="text-sq-micro text-sq-ink-muted">
          A second company is refused by the API, not merely hidden here: this installation runs for one
          company on one database.
        </p>
      </div>
    </ShellFrame>
  );
}
