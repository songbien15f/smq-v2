import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { GuestBuildingTypesAdminResponse, SessionView } from '@sq/contracts';
import { Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { GuestTypeEditor } from '@/components/GuestTypeEditor';
import { newTypeTemplate } from '@/lib/guestTypeTemplate';

export const metadata: Metadata = { title: 'New Guest building type' };

/**
 * A blank type, starting from the garage's configuration.
 *
 * Not an empty form: every field in a building type has to hold a value that passes
 * `checkGuestBuildingType`, and "all zeroes" does not. Starting from a type the product already ships
 * means the operator edits what they want and the rest is sound.
 */
export default async function NewGuestTypePage() {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const allowed = session.data.capabilities.includes('platform:templates');
  const list = allowed ? await serverFetch<GuestBuildingTypesAdminResponse>('/admin/guest-types') : null;

  return (
    <ShellFrame session={session.data} current="/guest-types">
      <div className="flex flex-col gap-sq-4">
        <nav aria-label="Breadcrumb" className="text-sq-micro text-sq-ink-muted">
          <a href="/guest-types" className="underline-offset-2 hover:underline">
            Guest building types
          </a>
          <span aria-hidden="true"> › </span>
          <span>New</span>
        </nav>

        {list === null ? (
          <Panel title="Not available to your role">
            <p className="text-sq-body text-sq-ink-muted">This needs the templates capability.</p>
          </Panel>
        ) : !list.ok ? (
          <Panel title="Could not load the page">
            <p role="alert" className="text-sq-body text-sq-danger">
              {list.message}
            </p>
          </Panel>
        ) : (
          <GuestTypeEditor
            mode="create"
            detail={{ item: newTypeTemplate(), issues: [], warnings: [] }}
            siteOrigin={list.data.siteOrigin}
          />
        )}
      </div>
    </ShellFrame>
  );
}
