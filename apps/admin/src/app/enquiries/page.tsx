import { redirect } from 'next/navigation';
import type { Page, SessionView } from '@sq/contracts';
import { Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { EnquiryList, type Enquiry } from '@/components/EnquiryList';

/**
 * The enquiry queue.
 *
 * The route existed and the table existed; nothing had ever written to it and no screen showed it.
 * A lead that arrives and is never seen is worse than a form that is not there, because the person
 * who sent it believes they have been heard.
 */
export default async function EnquiriesPage() {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const enquiries = await serverFetch<Page<Enquiry>>('/admin/enquiries?limit=200');

  return (
    <ShellFrame
      account={<SignOutButton />}
      capabilities={session.data.capabilities}
      current="/enquiries"
    >
      <div className="flex flex-col gap-sq-4">
        <div>
          <h1 className="text-sq-title font-semibold">Enquiries</h1>
          <p className="text-sq-body text-sq-ink-muted">
            People who asked about a shed from the website.
          </p>
        </div>

        {!enquiries.ok ? (
          <Panel title="Could not load enquiries">
            <p className="text-sq-body text-sq-danger">
              {enquiries.code === 'forbidden'
                ? 'Your role cannot see enquiries.'
                : enquiries.message}
            </p>
          </Panel>
        ) : (
          <EnquiryList initial={enquiries.data.items} />
        )}
      </div>
    </ShellFrame>
  );
}
