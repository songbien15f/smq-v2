import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { GuestBuildingTypeAdminDetail, GuestBuildingTypesAdminResponse, SessionView } from '@sq/contracts';
import { Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { GuestTypeEditor } from '@/components/GuestTypeEditor';

export const metadata: Metadata = { title: 'Guest building type' };

/** One type, as the API reports it — including the checks and warnings the form shows. */
export default async function GuestTypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const allowed = session.data.capabilities.includes('platform:templates');
  const [detail, list] = allowed
    ? await Promise.all([
        serverFetch<GuestBuildingTypeAdminDetail>(`/admin/guest-types/${encodeURIComponent(id)}`),
        serverFetch<GuestBuildingTypesAdminResponse>('/admin/guest-types'),
      ])
    : [null, null];

  return (
    <ShellFrame session={session.data} current="/guest-types">
      <div className="flex flex-col gap-sq-4">
        <nav aria-label="Breadcrumb" className="text-sq-micro text-sq-ink-muted">
          <a href="/guest-types" className="underline-offset-2 hover:underline">
            Guest building types
          </a>
          <span aria-hidden="true"> › </span>
          <span>{id}</span>
        </nav>

        {detail === null ? (
          <Panel title="Not available to your role">
            <p className="text-sq-body text-sq-ink-muted">This needs the templates capability.</p>
          </Panel>
        ) : !detail.ok ? (
          <Panel title="Could not load the type">
            <p role="alert" className="text-sq-body text-sq-danger">
              {detail.message}
            </p>
            <a href="/guest-types" className="mt-sq-2 inline-block text-sq-body underline-offset-2 hover:underline">
              Back to the list
            </a>
          </Panel>
        ) : (
          <GuestTypeEditor
            mode="edit"
            detail={detail.data}
            siteOrigin={list !== null && list.ok ? list.data.siteOrigin : ''}
          />
        )}
      </div>
    </ShellFrame>
  );
}
