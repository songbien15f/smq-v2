import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { CompanyRow, Page, SessionView } from '@sq/contracts';
import { Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SeatManager, type SeatFilter } from '@/components/SeatManager';

export const metadata: Metadata = { title: 'Seats' };

/**
 * Seats across every company: who is out of seats or past their end date, without opening each
 * company in turn. Read-only — each row links to the company page, where seats are changed.
 *
 * The filter lives in the URL (`?show=attention`) so the overview can link straight to it.
 */
export default async function SeatsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const [{ show }, companies] = await Promise.all([
    searchParams,
    serverFetch<Page<CompanyRow>>('/admin/companies?limit=200'),
  ]);
  const filter: SeatFilter = show === 'attention' ? 'attention' : 'all';

  return (
    <ShellFrame session={session.data} current="/seats">
      <div className="flex flex-col gap-sq-4">
        <div>
          <h1 className="text-sq-title font-semibold">Seats</h1>
          <p className="text-sq-body text-sq-ink-muted">
            How many devices each company has signed in on, and how many seats it has paid for. Seats are
            changed on each company&apos;s page.
          </p>
        </div>

        {!companies.ok ? (
          <Panel title="Could not load the companies">
            <p className="text-sq-body text-sq-danger">
              {companies.code === 'forbidden' ? 'Your role cannot see the companies.' : companies.message}
            </p>
          </Panel>
        ) : (
          <SeatManager
            companies={companies.data.items}
            filter={filter}
            canEdit={session.data.capabilities.includes('platform:seats')}
          />
        )}
      </div>
    </ShellFrame>
  );
}
