import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { currentSession } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { PriceImportPage } from '@/components/workspace/PriceImportPage';

/**
 * Loading a supplier's price list.
 *
 * Its own route rather than a panel in Settings, because it is a two-step operation over a file and
 * Settings is a form whose Save button means something else. The capability is checked here as well
 * as in the API: the server check stops a non-administrator reaching the page by typing the URL, and
 * the API check stops them acting if they did.
 */
export default async function PriceImportRoute() {
  const session = await currentSession<SessionView>();
  if (session === null) redirect('/');

  if (!session.capabilities.includes('price:manage')) redirect('/quotes');

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
            <a href="/settings" className="underline underline-offset-2 hover:text-sq-ink">
              Settings
            </a>{' '}
            / Prices
          </p>
          <h1 className="text-sq-title font-semibold">Prices</h1>
          <p className="text-sq-body text-sq-ink-muted">
            Your supplier&rsquo;s prices, loaded from a spreadsheet. These override the shared price
            book for this company only.
          </p>
        </div>

        <PriceImportPage />
      </div>
    </ShellFrame>
  );
}
