import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { currentSession } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { TeamPage } from '@/components/workspace/TeamPage';

/**
 * The team screen.
 *
 * The capability is checked **on the server** before the page renders, and the API checks it again
 * at each operation. The server check is what stops a non-administrator reaching the page by typing
 * the URL; the API check is what stops them acting if they did. One without the other is a screen
 * that either leaks or lies.
 */
export default async function TeamRoute() {
  const session = await currentSession<SessionView>();
  if (session === null) redirect('/');

  // Same policy as the API: reading the team is an administrative act, because it exposes who works
  // here and what they may do.
  if (!session.capabilities.includes('members:manage')) redirect('/quotes');

  return (
    <ShellFrame
      companyName={session.memberships[0]?.tenantName}
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
            / Team
          </p>
          <h1 className="text-sq-title font-semibold">Team</h1>
          <p className="text-sq-body text-sq-ink-muted">
            Who can work in this company, and as what.
          </p>
        </div>

        <TeamPage canManage />
      </div>
    </ShellFrame>
  );
}
