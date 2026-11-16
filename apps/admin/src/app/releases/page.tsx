import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { ReleaseManager, type ReleaseRow } from '@/components/ReleaseManager';

export const metadata: Metadata = { title: 'Releases' };

/** What this deployment is running, and what changed. Both the list and the form need `platform:versions`. */
export default async function ReleasesPage() {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const allowed = session.data.capabilities.includes('platform:versions');
  const releases = allowed ? await serverFetch<{ items: ReleaseRow[] }>('/admin/releases') : null;

  return (
    <ShellFrame session={session.data} current="/releases">
      <div className="flex flex-col gap-sq-4">
        <div>
          <h1 className="text-sq-title font-semibold">Releases</h1>
          <p className="text-sq-body text-sq-ink-muted">What this deployment is running, and what changed.</p>
        </div>

        {releases === null ? (
          <Panel title="Not available to your role">
            <p className="text-sq-body text-sq-ink-muted">Releases need the versions capability.</p>
          </Panel>
        ) : !releases.ok ? (
          <Panel title="Could not load releases">
            <p role="alert" className="text-sq-body text-sq-danger">
              {releases.message}
            </p>
          </Panel>
        ) : (
          <ReleaseManager initial={releases.data.items} />
        )}
      </div>
    </ShellFrame>
  );
}
