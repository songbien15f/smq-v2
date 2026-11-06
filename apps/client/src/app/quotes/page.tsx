import { redirect } from 'next/navigation';
import type { Page, QuoteListItem, SessionView } from '@sq/contracts';
import { money, millimetres, ActionLink, EmptyState, Panel } from '@sq/ui';
import { currentSession, serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { TemplatePicker } from '@/components/workspace/TemplatePicker';
import { QuoteTable } from '@/components/workspace/QuoteTable';

/**
 * The quote list.
 *
 * Server-rendered with the session forwarded, so the first paint is the real list — a salesperson
 * opening this at a customer's table should not watch a spinner. Every figure here is a *summary*
 * derived from the frozen revision; nothing is recalculated, because a list that prices its own rows
 * would disagree with the document the customer was sent the moment a price book changed.
 *
 * ## The summary strip is computed from the rows already fetched
 *
 * Four figures that answer "what is on the books" without a second request, so they cannot disagree
 * with the table beneath them. The table itself is a client component, because the status chips
 * filter it in place; the strip stays on the server and describes the whole book, not the current
 * view — which is why it does not change when a chip is pressed.
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
        items: {
          id: string;
          code: string;
          name: string;
          typeName: string;
          description: string | null;
          config: Record<string, number> | null;
        }[];
      }>('/templates')
    : null;
  const templates = templatesResult !== null && templatesResult.ok ? templatesResult.data.items : [];

  const items = result.ok ? result.data.items : [];
  const canWrite = session.capabilities.includes('quote:write');

  const open = items.filter((q) => q.status === 'draft' || q.status === 'issued').length;
  const accepted = items.filter((q) => q.status === 'accepted').length;
  const onTheBooks = items.reduce((sum, q) => sum + (q.contractCents ?? 0), 0);
  const needsPrice = items.filter((q) => q.incomplete).length;

  const summary = [
    { label: 'Open', value: String(open), tone: '' },
    { label: 'Accepted', value: String(accepted), tone: '' },
    { label: 'On the books', value: money(onTheBooks), tone: '' },
    {
      label: 'Needs a price',
      value: String(needsPrice),
      // The one piece of state in the strip that a person must act on, so it is the one that is
      // coloured. Everything else reads the same whatever it says.
      tone: needsPrice > 0 ? 'text-sq-attention' : '',
    },
  ];

  return (
    <ShellFrame
      capabilities={session.capabilities}
      companyName={session.currentTenantName}
      account={<SignOutButton />}
      subtitle={`Signed in as ${session.email}`}
      title="Quotes"
      caption={result.ok ? `${items.length} ${items.length === 1 ? 'quote' : 'quotes'} · newest first` : 'The list could not be loaded'}
      actions={
        canWrite ? (
          <>
            {/* A quote saved by the desktop app: the other way an operator starts, from a file. */}
            <ActionLink href="/quotes/import">Open a quote file</ActionLink>
            <ActionLink href="/quotes/new" variant="primary">
              New quote
            </ActionLink>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-sq-4">
        {result.ok && items.length > 0 && (
          /*
            One line, not four cards.
            The strip answers "what is on the books" at a glance, so it earns its place only while it
            stays out of the way: the four cards it replaced were 114 px tall and pushed the table to
            314 px, which is a third of a laptop screen spent on four numbers nobody reads twice. The
            label and the figure now sit on one baseline, and the hint line that repeated the label is
            gone. The tone still carries the one piece of state that matters — an attention-coloured
            figure means there is a quote that must not be sent.
          */
          <dl className="grid grid-cols-2 gap-x-sq-4 gap-y-sq-1 rounded-sq-lg border border-sq-line bg-sq-surface px-sq-4 py-sq-2 sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-sq-6 sm:gap-y-0">
            {summary.map((cell) => (
              <div key={cell.label} className="flex items-baseline gap-sq-2">
                <dt className="text-sq-micro font-semibold uppercase tracking-wider text-sq-ink-muted">{cell.label}</dt>
                <dd className={`sq-numeric text-sq-body-lg font-semibold tracking-tight ${cell.tone || 'text-sq-ink'}`}>
                  {cell.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {!result.ok && (
          <Panel title="Could not load quotes">
            <p className="text-sq-body text-sq-danger">{result.message}</p>
          </Panel>
        )}

        {/*
          The template catalogue, above the list: a person starting work looks here first, and a
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

        {result.ok && items.length > 0 && <QuoteTable items={items} />}

        <p className="text-sq-micro text-sq-ink-muted">
          Dimensions are stored in millimetres. One metre is <span className="sq-numeric">{millimetres(1000)}</span>.
        </p>
      </div>
    </ShellFrame>
  );
}
