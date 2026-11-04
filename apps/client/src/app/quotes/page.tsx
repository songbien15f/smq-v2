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
        items: { id: string; code: string; name: string; typeName: string; config: Record<string, number> | null }[];
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
    { label: 'Open', value: String(open), hint: 'draft or issued', tone: '' },
    { label: 'Accepted', value: String(accepted), hint: 'ready to schedule', tone: '' },
    { label: 'On the books', value: money(onTheBooks), hint: 'contract value', tone: '' },
    {
      label: 'Needs a price',
      value: String(needsPrice),
      hint: needsPrice === 0 ? 'every line priced' : 'do not send these',
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
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sq-lg border border-sq-line bg-sq-line lg:grid-cols-4">
            {summary.map((cell) => (
              <div key={cell.label} className="bg-sq-surface px-sq-4 py-sq-3">
                <span className="text-sq-micro font-semibold uppercase tracking-wider text-sq-ink-muted">{cell.label}</span>
                <b className={`sq-numeric mt-1 block text-sq-display font-semibold tracking-tight ${cell.tone || 'text-sq-ink'}`}>
                  {cell.value}
                </b>
                <span className="text-sq-micro text-sq-ink-muted">{cell.hint}</span>
              </div>
            ))}
          </div>
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
