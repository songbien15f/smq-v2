import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { currentSession } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { QuoteFileImport } from '@/components/workspace/QuoteFileImport';

/**
 * Reading a legacy `.sqd` quote file.
 *
 * Its own route because it is a file operation, not part of the quote list: an operator arrives
 * here holding a file from the desktop app and wants to know what is in it.
 */
export default async function QuoteFileRoute() {
  const session = await currentSession<SessionView>();
  if (session === null) redirect('/');

  if (!session.capabilities.includes('quote:write')) redirect('/quotes');

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
            / Open a quote file
          </p>
          <h1 className="text-sq-title font-semibold">Open a quote file</h1>
          <p className="text-sq-body text-sq-ink-muted">
            A quote saved by the desktop app, as a <code>.sqd</code> file.
          </p>
        </div>

        <QuoteFileImport />
      </div>
    </ShellFrame>
  );
}
