import { redirect } from 'next/navigation';
import type { CompanyRow, Page, SessionView } from '@sq/contracts';
import { date, Panel, Stat, StatusPill } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { CompanyLimits } from '@/components/CompanyLimits';
import { CompanyCreator } from '@/components/CompanyCreator';

/**
 * The companies.
 *
 * Plural, because there can be many: converting the licence server's control plane means the vendor
 * holds one row per paying shed company. The single-company days — when this page said "the company"
 * and cut the list to `limit=2` then read `items[0]` — are gone, along with the note that claimed the
 * API refused a second company.
 *
 * A page editing one company's seats already exists at `/seats`; this page is the directory plus the
 * screens that do not fit a row — the subscription end date, and creating the next company.
 */
export default async function CompanyPage() {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const companies = await serverFetch<Page<CompanyRow>>('/admin/companies?limit=200');

  if (!companies.ok) {
    return (
      <ShellFrame account={<SignOutButton />} capabilities={session.data.capabilities} current="/company">
        <Panel title="Could not load the companies">
          <p className="text-sq-body text-sq-danger">
            {companies.code === 'forbidden'
              ? 'Your role cannot see the companies. Ask for platform support access.'
              : companies.message}
          </p>
        </Panel>
      </ShellFrame>
    );
  }

  const canCreate = session.data.capabilities.includes('platform:companies');
  const canEditLimits = session.data.capabilities.includes('platform:seats');

  return (
    <ShellFrame account={<SignOutButton />} capabilities={session.data.capabilities} current="/company">
      <div className="flex flex-col gap-sq-4">
        <div className="flex flex-wrap items-end justify-between gap-sq-2">
          <div>
            <h1 className="text-sq-title font-semibold">Companies</h1>
            <p className="text-sq-body text-sq-ink-muted">
              Every shed company on this installation, and its subscription.
            </p>
          </div>
          {canCreate && <CompanyCreator />}
        </div>

        {companies.data.items.length === 0 && (
          <Panel title="No company yet" description="Nothing has been provisioned.">
            <p className="text-sq-body text-sq-ink-muted">
              Create the first company above, or run the installer from a terminal.
            </p>
          </Panel>
        )}

        {companies.data.items.map((company) => {
          const saturated = company.seatsInUse >= company.seats;
          const expired =
            company.subscriptionEndsAt !== null && Date.parse(company.subscriptionEndsAt) < Date.now();

          return (
            <Panel key={company.id} title={company.name} description={`${company.slug} · code ${company.code ?? '—'}`}>
              <div className="flex flex-col gap-sq-4">
                <div className="flex flex-wrap items-center justify-between gap-sq-2">
                  <StatusPill
                    tone={company.status === 'active' ? (saturated || expired ? 'attention' : 'ok') : 'danger'}
                    label={
                      company.status === 'active'
                        ? saturated
                          ? 'Every seat in use'
                          : expired
                            ? 'Subscription ended'
                            : 'Active'
                        : 'Suspended'
                    }
                  />
                  <span className="text-sq-micro text-sq-ink-muted">
                    Created {date(company.createdAt)}
                  </span>
                </div>

                <div className="grid gap-sq-3 sm:grid-cols-2 lg:grid-cols-4">
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

                <dl className="flex flex-col gap-sq-1 text-sq-body">
                  <div className="flex justify-between gap-sq-2">
                    <dt className="text-sq-micro text-sq-ink-muted">Subscription ends</dt>
                    <dd>{company.subscriptionEndsAt === null ? 'No end date' : date(company.subscriptionEndsAt)}</dd>
                  </div>
                </dl>

                {/* The two numbers a vendor sells, editable without leaving the directory. */}
                {canEditLimits && (
                  <CompanyLimits
                    tenantId={company.id}
                    seats={company.seats}
                    seatsInUse={company.seatsInUse}
                    subscriptionEndsAt={company.subscriptionEndsAt}
                  />
                )}
              </div>
            </Panel>
          );
        })}
      </div>
    </ShellFrame>
  );
}