import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import type { GuestBuildingTypesAdminResponse } from '@sq/contracts';
import { Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { GuestTypesList } from '@/components/GuestTypesList';

export const metadata: Metadata = { title: 'Guest building types' };

/**
 * The building types the Guest page offers.
 *
 * The list is a server render on purpose: it is a short, rarely changing catalogue, and the first
 * paint should not be a spinner. Everything that *changes* it (enable, order) is a client component
 * that calls the API and re-reads this page.
 *
 * While the table is empty the API answers the six types compiled into `@sq/core`, and this page says
 * so — because the first save copies all six into the database, and an operator who does not know
 * that would be surprised to see rows appear.
 */
export default async function GuestTypesPage() {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const allowed = session.data.capabilities.includes('platform:templates');
  const types = allowed ? await serverFetch<GuestBuildingTypesAdminResponse>('/admin/guest-types') : null;

  return (
    <ShellFrame session={session.data} current="/guest-types">
      <div className="flex flex-col gap-sq-4">
        <div>
          <h1 className="text-sq-title font-semibold">Guest building types</h1>
          <p className="text-sq-body text-sq-ink-muted">
            What a visitor can choose on the public quote page. Switching one off hides it; nothing here is
            deleted, because requests already sent point at these ids.
          </p>
        </div>

        {types === null ? (
          <Panel title="Not available to your role">
            <p className="text-sq-body text-sq-ink-muted">
              The Guest building types need the templates capability.
            </p>
          </Panel>
        ) : !types.ok ? (
          <Panel title="Could not load the building types">
            <p role="alert" className="text-sq-body text-sq-danger">
              {types.message}
            </p>
          </Panel>
        ) : (
          <GuestTypesList initial={types.data.items} siteOrigin={types.data.siteOrigin} />
        )}
      </div>
    </ShellFrame>
  );
}
