import { redirect } from 'next/navigation';
import type { Page, QuoteListItem, SessionView } from '@sq/contracts';
import { money, ActionLink, EmptyState, Panel } from '@sq/ui';
import { currentSession, serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { TemplatePicker } from '@/components/workspace/TemplatePicker';
import { QuoteBoard } from '@/components/workspace/QuoteBoard';

/**
 * The quote list.
 *
 * Rendered on the server with the session forwarded, so the first paint is the real board — a
 * salesperson opening this at a customer's table should not watch a spinner.
 *
 * Direction B keeps the list short and legible: the board is a client component that filters the
 * already-fetched rows by status with no round trip, while this page stays responsible for what a
 * server render must own — the session, the fetch, and the one figure in the heading.
 */
export default async function QuotesPage() {
  const session = await currentSession<SessionView>();
  if (session === null) redirect('/');

  const result = await serverFetch<Page<QuoteListItem>>('/quotes?limit=50');

  /*
   * The template catalogue, fetched alongside the list. A failure here must not break the list — a
   * company with no catalogue is a company with no templates, which is the normal state on a fresh
   * install.
   */
  const templatesResult = session.capabilities.includes('quote:write')
    ? await serverFetch<{
        items: { id: string; code: string; name: string; typeName: string; config: Record<string, number> | null }[];
      }>('/templates')
    : null;
  const templates = templatesResult !== null && templatesResult.ok ? templatesResult.data.items : [];

  const items = result.ok ? result.data.items : [];
  const canWrite = session.capabilities.includes('quote:write');
  const onTheBooks = items.reduce((sum, q) => sum + (q.contractCents ?? 0), 0);

  return (
    <ShellFrame
      capabilities={session.capabilities}
      companyName={session.currentTenantName}
      account={<SignOutButton />}
      subtitle={`Signed in as ${session.email}`}
    >
      <div className="mx-auto flex max-w-[1400px] flex-col gap-sq-6">
        <div className="flex flex-wrap items-end justify-between gap-sq-3">
          <div>
            <h1 className="text-sq-display font-semibold tracking-tight text-sq-ink">Quotes</h1>
            <p className="mt-1 text-sq-body text-sq-ink-muted">
              {result.ok ? (
                <>
                  {items.length} {items.length === 1 ? 'quote' : 'quotes'} ·{' '}
                  <b className="sq-numeric font-semibold text-sq-ink">{money(onTheBooks)}</b> on the books
                </>
              ) : (
                'The board could not be loaded'
              )}
            </p>
          </div>

          {canWrite && (
            <div className="flex flex-wrap items-center gap-sq-2">
              {/* A quote saved by the desktop app: the other way an operator starts, from a file. */}
              <ActionLink href="/quotes/import">Open a quote file</ActionLink>
              <ActionLink href="/quotes/new" variant="primary">
                New quote
              </ActionLink>
            </div>
          )}
        </div>

        {!result.ok && (
          <Panel title="Could not load quotes">
            <p className="text-sq-body text-sq-danger">{result.message}</p>
          </Panel>
        )}

        {/*
          The template catalogue, above the board: a person starting work looks here first, and a
          building someone already worked out is faster than a blank form.
        */}
        {canWrite && templates.length > 0 && <TemplatePicker templates={templates} />}

        {result.ok && items.length === 0 && (
          <EmptyState
            title="No quotes yet"
            body="A quote starts from the building: span, length, wall height, roof pitch and the doors. Everything else — materials, price, payment terms — follows from those."
            action={canWrite ? <ActionLink href="/quotes/new" variant="primary">Start the first quote</ActionLink> : undefined}
          />
        )}

        {result.ok && items.length > 0 && <QuoteBoard items={items} />}
      </div>
    </ShellFrame>
  );
}