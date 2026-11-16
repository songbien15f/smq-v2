import { redirect } from 'next/navigation';
import type { CompanyRow, Page, SessionView } from '@sq/contracts';
import { ActionLink, EmptyState, Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { isCompanyFilter } from '@/lib/companyState';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { CompanyTable } from '@/components/CompanyTable';

/**
 * The companies.
 *
 * Plural, because there can be many: converting the licence server's control plane means the vendor
 * holds one row per paying shed company.
 *
 * This page is the directory and nothing else — one row per company, searchable and filterable. The
 * screens that change a company (its seats, its end date, suspending it) are on the company's own page,
 * `/company/[id]`, and creating one is `/company/new`. They used to stack here, one tall card per
 * company with its editors open, which made the list unreadable past three companies and put a suspend
 * control a scroll away from every row.
 */
export default async function CompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string }>;
}) {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const [params, companies] = await Promise.all([
    searchParams,
    serverFetch<Page<CompanyRow>>('/admin/companies?limit=200'),
  ]);

  const canCreate = session.data.capabilities.includes('platform:companies');

  return (
    <ShellFrame account={<SignOutButton />} capabilities={session.data.capabilities} current="/company">
      <div className="flex flex-col gap-sq-4">
        <div className="flex flex-wrap items-end justify-between gap-sq-2">
          <div>
            <h1 className="text-sq-title font-semibold">Companies</h1>
            <p className="text-sq-body text-sq-ink-muted">
              Every shed company on this installation. Open one to change its seats, its subscription or its
              access.
            </p>
          </div>
          {canCreate && (
            <ActionLink variant="primary" href="/company/new">
              New company
            </ActionLink>
          )}
        </div>

        {!companies.ok ? (
          <Panel title="Could not load the companies">
            <p className="text-sq-body text-sq-danger">
              {companies.code === 'forbidden'
                ? 'Your role cannot see the companies. Ask for platform support access.'
                : companies.message}
            </p>
          </Panel>
        ) : companies.data.items.length === 0 ? (
          <EmptyState
            title="No company yet"
            body={
              canCreate
                ? 'Nothing has been provisioned. Create the first company, or run the installer from a terminal.'
                : 'Nothing has been provisioned. Someone with the companies capability can create the first one.'
            }
            action={
              canCreate ? (
                <ActionLink variant="primary" href="/company/new">
                  Create the first company
                </ActionLink>
              ) : undefined
            }
          />
        ) : (
          <CompanyTable
            companies={companies.data.items}
            initialQuery={params.q ?? ''}
            initialFilter={isCompanyFilter(params.state) ? params.state : 'all'}
          />
        )}
      </div>
    </ShellFrame>
  );
}
