import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { CompanyCreator } from '@/components/CompanyCreator';

export const metadata: Metadata = { title: 'New company' };

/**
 * Creating a company, on a page of its own.
 *
 * It used to open in place above the directory, pushing the list down and leaving the one-time
 * password on screen beside every other company. A page has an address, a back button that means
 * "cancel", and nothing else on it to misread while the credentials are showing.
 */
export default async function NewCompanyPage() {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const canCreate = session.data.capabilities.includes('platform:companies');

  return (
    <ShellFrame session={session.data} current="/company">
      <div className="flex max-w-3xl flex-col gap-sq-4">
        <a href="/company" className="w-fit text-sq-body text-sq-ink-muted no-underline hover:text-sq-ink">
          ‹ Companies
        </a>
        <div>
          <h1 className="text-sq-title font-semibold">New company</h1>
          <p className="text-sq-body text-sq-ink-muted">
            Creates the company and its first administrator in one step.
          </p>
        </div>
        {canCreate ? (
          <CompanyCreator />
        ) : (
          <Panel title="Not available to your role">
            <p className="text-sq-body text-sq-ink-muted">
              Creating a company needs the companies capability. Ask a platform administrator.
            </p>
          </Panel>
        )}
      </div>
    </ShellFrame>
  );
}
