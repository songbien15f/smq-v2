import { redirect } from 'next/navigation';
import type { Page, QuoteListItem, SessionView } from '@sq/contracts';
import { money, millimetres, ActionLink, EmptyState, Panel, StatusPill } from '@sq/ui';
import { currentSession, serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { TemplatePicker } from '@/components/workspace/TemplatePicker';

/**
 * The quote list.
 *
 * Server-rendered with the session forwarded, so the first paint is the real list —
 * a salesperson opening this at a customer's table should not watch a spinner.
 *
 * Every figure here is a *summary* derived from the frozen revision. Nothing is
 * recalculated, because a list that prices its own rows would disagree with the
 * document the customer was sent the moment a price book changed.
 *
 * ## The summary strip is computed from the list, in the page
 *
 * Four figures that answer "what is on the books" without a second request. They are derived from
 * the rows already fetched, so they cannot disagree with the table underneath them — a summary
 * fetched separately is a summary that can be a minute stale while the table is not.
 */

/** The colour of a row's spine, by status. The word is still shown; the colour only leads the eye. */
function spineFor(status: string): string {
  if (status === 'accepted') return 'bg-sq-ok';
  if (status === 'issued') return 'bg-sq-info';
  if (status === 'declined' || status === 'expired') return 'bg-sq-danger';
  return 'bg-sq-ink-muted/30';
}

function pillFor(status: string): 'ok' | 'attention' | 'danger' | 'info' | 'neutral' {
  if (status === 'accepted') return 'ok';
  if (status === 'declined' || status === 'expired') return 'danger';
  if (status === 'issued') return 'info';
  return 'neutral';
}

export default async function QuotesPage() {
  const session = await currentSession<SessionView>();
  if (session === null) redirect('/');

  /*
   * The company comes from the session, not from `memberships[0]`.
   *
   * The old form answered "which company sorts first", which is a different question from "which
   * company this session is open in" — and the wrong answer the moment a person holds two
   * memberships. `currentTenantName` is the company the API has already resolved.
   */
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

  // Derived, never fetched: a figure that comes from a second request can be stale next to the rows.
  const open = items.filter((q) => q.status === 'draft' || q.status === 'issued').length;
  const accepted = items.filter((q) => q.status === 'accepted').length;
  const pipelineCents = items.reduce((sum, q) => sum + (q.contractCents ?? 0), 0);
  const needsPrice = items.filter((q) => q.incomplete).length;

  const summary = [
    { label: 'Open', value: String(open), hint: 'draft or issued', tone: '' },
    { label: 'Accepted', value: String(accepted), hint: 'ready to schedule', tone: '' },
    { label: 'On the books', value: money(pipelineCents), hint: 'contract value', tone: '' },
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
      caption={
        result.ok ? `${items.length} ${items.length === 1 ? 'quote' : 'quotes'} · newest first` : 'The list could not be loaded'
      }
      actions={
        canWrite ? (
          <>
            {/*
              A quote saved by the desktop app. It sits beside "New quote" because that is the other
              way an operator starts: with a building that already exists in a file.
            */}
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
                <span className="text-sq-micro font-semibold uppercase tracking-wider text-sq-ink-muted">
                  {cell.label}
                </span>
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

        {result.ok && items.length > 0 && (
          <Panel padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sq-body">
                <thead>
                  <tr className="border-b border-sq-line text-left text-sq-micro uppercase tracking-wider text-sq-ink-muted">
                    <th scope="col" className="px-sq-3 py-sq-2 pl-sq-4 font-semibold">Number</th>
                    <th scope="col" className="px-sq-3 py-sq-2 font-semibold">Customer</th>
                    <th scope="col" className="hidden px-sq-3 py-sq-2 font-semibold sm:table-cell">Site</th>
                    <th scope="col" className="px-sq-3 py-sq-2 font-semibold">Status</th>
                    <th scope="col" className="hidden px-sq-3 py-sq-2 text-right font-semibold sm:table-cell">Rev</th>
                    <th scope="col" className="px-sq-3 py-sq-2 text-right font-semibold">Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((quote) => (
                    <tr key={quote.id} className="border-b border-sq-line/70 last:border-0 hover:bg-sq-ground/70">
                      {/*
                        The link fills the cell's height (`h-full` inside an `h-12` cell), so the hit
                        area is the whole row height rather than the 17 px of the text. WCAG 2.2 sets
                        the web minimum at 24 px, and a bare text link was under it.
                      */}
                      <td className="relative h-12 px-sq-3 pl-sq-4">
                        <span aria-hidden="true" className={`absolute left-0 top-0 h-full w-[3px] ${spineFor(quote.status)}`} />
                        <a
                          href={`/quotes/${quote.id}`}
                          className="flex h-full items-center font-medium text-sq-brand underline-offset-2 hover:underline"
                        >
                          <span className="sq-numeric">{quote.number}</span>
                        </a>
                      </td>
                      <td className="px-sq-3">{quote.customerName || '—'}</td>
                      <td className="hidden px-sq-3 text-sq-ink-muted sm:table-cell">{quote.siteSuburb || '—'}</td>
                      <td className="px-sq-3">
                        <StatusPill tone={pillFor(quote.status)} label={quote.status} />
                      </td>
                      <td className="sq-numeric hidden px-sq-3 sm:table-cell">{quote.revision || '—'}</td>
                      <td className="px-sq-3 text-right">
                        <span className="sq-numeric font-semibold">
                          {quote.contractCents === null ? '—' : money(quote.contractCents)}
                        </span>
                        {quote.incomplete && (
                          <span className="mt-0.5 block text-sq-micro font-medium text-sq-attention">
                            unpriced lines
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        <p className="text-sq-micro text-sq-ink-muted">
          Dimensions are stored in millimetres. One metre is <span className="sq-numeric">{millimetres(1000)}</span>.
        </p>
      </div>
    </ShellFrame>
  );
}
