import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { currentSession } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { UsagePage } from '@/components/workspace/UsagePage';

/**
 * What this company has been doing, in this product.
 *
 * Gated on `usage:read`, which today belongs to `company_admin` only. The check runs on the server
 * before anything renders, and the API checks it again on the route — one without the other is a
 * screen that either leaks or lies.
 *
 * The counts are read in the browser rather than on the server because the page has no other reason
 * to be dynamic: an owner opening this is asking about now, and a cached summary from a server
 * render would answer about whenever the page was last built.
 */
export default async function UsageRoute() {
  const session = await currentSession<SessionView>();
  if (session === null) redirect('/');

  if (!session.capabilities.includes('usage:read')) redirect('/quotes');

  return (
    <ShellFrame
      companyName={session.currentTenantName}
      account={<SignOutButton />}
      capabilities={session.capabilities}
      subtitle={`Signed in as ${session.email}`}
    >
      <div className="flex flex-col gap-sq-4">
        <div>
          <p className="text-sq-micro text-sq-ink-muted">
            <a href="/quotes" className="underline underline-offset-2 hover:text-sq-ink">
              Quotes
            </a>{' '}
            / Activity
          </p>
          <h1 className="text-sq-title font-semibold">Activity</h1>
          <p className="text-sq-body text-sq-ink-muted">
            What this company has done here — quotes written, revisions saved, quotes emailed and
            screens opened. Counts only: no customer name, address or price is recorded.
          </p>
        </div>

        <UsagePage />
      </div>
    </ShellFrame>
  );
}
