import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { Panel } from '@sq/ui';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { PriceBookManager, type BookSummary } from '@/components/PriceBookManager';

/**
 * Price books.
 *
 * Every quote is priced from the active book, so this is the screen that decides what the product
 * costs. It had an API and no UI: a book could only be published from the command line.
 */
export default async function PriceBooksPage() {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  const books = await serverFetch<{ books: BookSummary[]; activeHash: string | null }>('/admin/price-books');

  return (
    <ShellFrame
      account={<SignOutButton />}
      capabilities={session.data.capabilities}
      current="/price-books"
    >
      <div className="flex flex-col gap-sq-4">
        <div>
          <h1 className="text-sq-title font-semibold">Price books</h1>
          <p className="text-sq-body text-sq-ink-muted">
            The supplier prices every quote is built from.
          </p>
        </div>

        {!books.ok ? (
          <Panel title="Could not load price books">
            <p className="text-sq-body text-sq-danger">
              {books.code === 'forbidden' ? 'Your role cannot manage price books.' : books.message}
            </p>
          </Panel>
        ) : (
          <PriceBookManager initial={books.data.books} activeHash={books.data.activeHash} />
        )}
      </div>
    </ShellFrame>
  );
}
