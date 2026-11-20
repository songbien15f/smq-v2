import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { GuestRequestTable } from '@/components/GuestRequestTable';
import type { GuestRequestList, GuestRequestStatus } from '@/lib/guestRequests';

export const metadata: Metadata = { title: 'Guest requests' };

const STATUSES: readonly (GuestRequestStatus | 'all')[] = ['new', 'transferred', 'declined', 'spam', 'all'];

/**
 * What visitors designed on the website's guest page and sent (`guest_requests`).
 *
 * Each request is also mailed to the notification address, but the table is the record: with mail
 * unset or a message lost, this screen is the only place the request is seen.
 */
export default async function GuestRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const [{ status }, list] = await Promise.all([
    searchParams,
    serverFetch<GuestRequestList>('/admin/guest-requests?limit=200'),
  ]);
  const initialFilter = STATUSES.find((s) => s === status) ?? 'new';

  return (
    <ShellFrame session={session.data} current="/guest-requests">
      <div className="flex flex-col gap-sq-4">
        <div>
          <h1 className="text-sq-title font-semibold">Guest requests</h1>
          <p className="text-sq-body text-sq-ink-muted">
            Buildings designed on the website&rsquo;s guest page and sent for a quote. Newest first.
          </p>
        </div>

        {!list.ok ? (
          <Panel title="Could not load guest requests">
            <p className="text-sq-body text-sq-danger">
              {list.code === 'forbidden' ? 'Your role cannot see guest requests.' : list.message}
            </p>
          </Panel>
        ) : (
          <Panel padded={false}>
            <GuestRequestTable list={list.data} initialFilter={initialFilter} />
          </Panel>
        )}
      </div>
    </ShellFrame>
  );
}
