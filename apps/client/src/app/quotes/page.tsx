import { redirect } from 'next/navigation';
import type { Page, QuoteListItem, SessionView } from '@sq/contracts';
import { money, millimetres } from '@sq/ui';
import { currentSession, serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { EmptyState, StatusPill, Panel } from '@sq/ui';
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
 */
export default async function QuotesPage() {
  const session = await currentSession<SessionView>();
  if (session === null) redirect('/');

  const membership = session.memberships[0];
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

  return (
    <ShellFrame
      capabilities={session.capabilities}
      companyName={membership?.tenantName}
      account={<SignOutButton />}
      subtitle={`Signed in as ${session.email}`}
    >
      <div className="flex flex-col gap-sq-4">
        <div className="flex flex-wrap items-end justify-between gap-sq-2">
          <div>
            <h1 className="text-sq-title font-semibold">Quotes</h1>
            <p className="text-sq-body text-sq-ink-muted">
              {result.ok ? `${result.data.items.length} shown` : 'The list could not be loaded'}
            </p>
          </div>
          {session.capabilities.includes('quote:write') && (
            <div className="flex flex-wrap items-center gap-sq-2">
              {/*
                A quote saved by the desktop app. It sits beside "New quote" because that is the
                other way an operator starts: with a building that already exists in a file.
              */}
              <a
                href="/quotes/import"
                className="inline-flex min-h-[38px] items-center rounded-md border border-sq-line px-sq-3 text-sq-body font-medium text-sq-ink no-underline transition-colors duration-150 hover:bg-sq-ground"
              >
                Open a quote file
              </a>
              <a
                href="/quotes/new"
                className="inline-flex min-h-[38px] items-center rounded-md bg-sq-brand px-sq-3 text-sq-body font-medium text-white no-underline transition-colors duration-150 hover:bg-sq-brand-hover"
              >
                New quote
              </a>
            </div>
          )}
        </div>

        {!result.ok && (
          <Panel title="Could not load quotes">
            <p className="text-sq-body text-sq-danger">{result.message}</p>
          </Panel>
        )}

        {/*
          The template catalogue, above the list: a person starting work looks here first, and a
          building someone already worked out is faster than a blank form.
        */}
        {session.capabilities.includes('quote:write') && templates.length > 0 && (
          <TemplatePicker templates={templates} />
        )}

        {result.ok && result.data.items.length === 0 && (
          <EmptyState
            title="No quotes yet"
            body="A quote starts from the building: span, length, wall height, roof pitch and the doors. Everything else — materials, price, payment terms — follows from those."
            action={
              session.capabilities.includes('quote:write') ? (
                <a
                  href="/quotes/new"
                  className="inline-flex min-h-[38px] items-center rounded-md bg-sq-brand px-sq-3 text-sq-body font-medium text-white no-underline"
                >
                  Start the first quote
                </a>
              ) : undefined
            }
          />
        )}

        {result.ok && result.data.items.length > 0 && (
          <Panel padded={false}>
            <table className="w-full border-collapse text-sq-body">
              <thead>
                <tr className="border-b border-sq-line text-left text-sq-micro text-sq-ink-muted">
                  <th scope="col" className="px-sq-2 py-sq-2 font-medium">Number</th>
                  <th scope="col" className="px-sq-2 py-sq-2 font-medium">Customer</th>
                  <th scope="col" className="px-sq-2 py-sq-2 font-medium">Site</th>
                  <th scope="col" className="px-sq-2 py-sq-2 font-medium">Status</th>
                  <th scope="col" className="px-sq-2 py-sq-2 text-right font-medium">Revision</th>
                  <th scope="col" className="px-sq-2 py-sq-2 text-right font-medium">Contract</th>
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((quote) => (
                  <tr key={quote.id} className="border-b border-sq-line last:border-0 hover:bg-sq-ground/60">
                    <td className="px-sq-2 py-sq-2">
                      <a href={`/quotes/${quote.id}`} className="font-medium text-sq-brand underline-offset-2 hover:underline">
                        {quote.number}
                      </a>
                    </td>
                    <td className="px-sq-2 py-sq-2">{quote.customerName || '—'}</td>
                    <td className="px-sq-2 py-sq-2 text-sq-ink-muted">{quote.siteSuburb || '—'}</td>
                    <td className="px-sq-2 py-sq-2">
                      <StatusPill
                        tone={
                          quote.status === 'accepted'
                            ? 'ok'
                            : quote.status === 'declined' || quote.status === 'expired'
                              ? 'danger'
                              : quote.status === 'issued'
                                ? 'info'
                                : 'neutral'
                        }
                        label={quote.status}
                      />
                    </td>
                    <td className="sq-numeric px-sq-2 py-sq-2">{quote.revision || '—'}</td>
                    <td className="sq-numeric px-sq-2 py-sq-2">
                      {quote.contractCents === null ? '—' : money(quote.contractCents)}
                      {quote.incomplete && (
                        <span className="ml-2">
                          <StatusPill tone="attention" label="unpriced lines — do not send" />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}

        <p className="text-sq-micro text-sq-ink-muted">
          Dimensions are stored in millimetres. One metre is <span className="sq-numeric">{millimetres(1000)}</span>.
        </p>
      </div>
    </ShellFrame>
  );
}
