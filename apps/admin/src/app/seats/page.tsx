import { redirect } from 'next/navigation';
import type { CompanyRow, Page, SessionView } from '@sq/contracts';
import { Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { SeatManager } from '@/components/SeatManager';

/**
 * Seats across every company.
 *
 * The company page can change one company's seats; this answers the question that page cannot — who
 * is out of seats right now — without opening each company in turn.
 */
export default async function SeatsPage() {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const companies = await serverFetch<Page<CompanyRow>>('/admin/companies?limit=200');

  return (
    <ShellFrame account={<SignOutButton />} capabilities={session.data.capabilities} current="/seats">
      <div className="flex flex-col gap-sq-4">
        <div>
          <h1 className="text-sq-title font-semibold">Seats</h1>
          <p className="text-sq-body text-sq-ink-muted">
            How many live sessions each company holds, and how many it has paid for.
          </p>
        </div>

        {!companies.ok ? (
          <Panel title="Could not load the companies">
            <p className="text-sq-body text-sq-danger">
              {companies.code === 'forbidden'
                ? 'Your role cannot see the companies.'
                : companies.message}
            </p>
          </Panel>
        ) : (
          <SeatManager initial={companies.data.items} />
        )}
      </div>
    </ShellFrame>
  );
}
