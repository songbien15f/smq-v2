import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { currentSession } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { SettingsPage } from '@/components/workspace/SettingsPage';
import { Breadcrumb } from '@/components/Breadcrumb';

/**
 * Company settings live under `/settings` rather than `/company/settings` because an operator's
 * mental model is "change the settings", not "navigate to the company section then find settings".
 * The shorter path also matches the API route, which keeps muscle memory consistent between the
 * browser bar and a curl command.
 */
export default async function SettingsRoute() {
  const session = await currentSession<SessionView>();
  if (session === null) redirect('/');

  return (
    <ShellFrame
      companyName={session.currentTenantName}
      account={<SignOutButton />}
      capabilities={session.capabilities}
      subtitle={`Signed in as ${session.email}`}
    >
      <div className="flex flex-col gap-sq-4">
        <div>
          <Breadcrumb trail={[{ label: 'Quotes', href: '/quotes' }, { label: 'Settings' }]} />
          <h1 className="text-sq-title font-semibold">Company settings</h1>
          <p className="text-sq-body text-sq-ink-muted">
            Identity, pricing defaults and terms. A save writes a new version; saved revisions keep
            the values they were priced under.
          </p>
        </div>

        <SettingsPage />
      </div>
    </ShellFrame>
  );
}