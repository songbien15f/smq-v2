import { notFound, redirect } from 'next/navigation';
import type { RevisionView, SessionView } from '@sq/contracts';
import { money, date, Panel, Stat, StatusPill } from '@sq/ui';
import { currentSession, serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { QuoteActions } from '@/components/workspace/QuoteActions';
import { FrozenSteelwork } from '@/components/workspace/FrozenSteelwork';
import { Breadcrumb } from '@/components/Breadcrumb';

/**
 * One quote, with its revisions.
 *
 * This page existed as a link before it existed as a route: the list pointed at `/quotes/{id}` and
 * got a 404. It is here because a list that offers a link nobody can follow is worse than no list —
 * the operator learns not to trust the screen.
 *
 * ## What it shows, and why
 *
 * The **revisions**, not the quote in general. A saved revision is the record of what a customer was
 * sent, and the questions people actually ask are "which one did they get" and "how did this one
 * differ" — both answered by a revision list with its frozen prices.
 *
 * Each revision is read-only by construction: `quote_revisions` refuses UPDATE and DELETE at the
 * database, so there is nothing to offer here but the figures.
 */

interface QuoteDetail {
  id: string;
  number: string;
  status: string;
  revision: number;
  contractCents?: number;
  incomplete: boolean;
  customer: { firstName?: string; lastName?: string; email?: string; address?: string } | null;
  site: { address?: string; deliveryScope?: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface RevisionRow {
  id: string;
  revision: number;
  name: string;
  description: string;
  created_at: string;
  created_by_email: string;
  engine_version: number;
  contract_cents: number;
  total_cost_cents: number;
  total_mass_kg: number;
  mocked_lines: number;
  bom_hash: string;
  price_book_hash: string;
}

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ quoteId: string }>;
  searchParams: Promise<{ revision?: string }>;
}) {
  const session = await currentSession<SessionView>();
  if (session === null) redirect('/');

  const { quoteId } = await params;

  const quote = await serverFetch<QuoteDetail>(`/quotes/${quoteId}`);
  if (!quote.ok) notFound();

  const revisions = await serverFetch<{ items: RevisionRow[] }>(`/quotes/${quoteId}/revisions`);

  const items = revisions.ok ? revisions.data.items : [];

  /*
   * Which revision the document and the workshop sheets describe.
   *
   * The page used to always use `items[0]` — the newest — so a customer asking "what did revision 1
   * say" had no way to see it short of editing the URL by hand. Every route below already takes a
   * revision number; only the screen never offered one.
   *
   * An unknown or unparseable `?revision=` falls back to the latest rather than 404: a link with a
   * stale number is a bookmark, not an error, and refusing it would lose the reader entirely.
   */
  const { revision: requested } = await searchParams;
  const wanted = Number(requested);
  const selected =
    Number.isInteger(wanted) && wanted > 0
      ? (items.find((row) => row.revision === wanted) ?? items[0])
      : items[0];
  const viewingOlder = selected !== undefined && items.length > 0 && selected.revision !== items[0].revision;

  const customer = quote.data.customer;
  const customerName =
    customer === null ? '' : `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim();

  return (
    <ShellFrame
      companyName={session.currentTenantName}
      account={<SignOutButton />}
      capabilities={session.capabilities}
      subtitle={`Signed in as ${session.email}`}
    >
      <div className="flex flex-col gap-sq-4">
        <div className="flex flex-wrap items-end justify-between gap-sq-2">
          <div>
            <Breadcrumb trail={[{ label: 'Quotes', href: '/quotes' }, { label: quote.data.number }]} />
            <h1 className="text-sq-title font-semibold">{customerName || 'No customer name'}</h1>
            <p className="text-sq-body text-sq-ink-muted">{quote.data.site?.address ?? '—'}</p>
          </div>
          <div className="flex items-center gap-sq-2">
            <StatusPill
              tone={
                quote.data.status === 'accepted'
                  ? 'ok'
                  : quote.data.status === 'declined' || quote.data.status === 'expired'
                    ? 'danger'
                    : quote.data.status === 'issued'
                      ? 'info'
                      : 'neutral'
              }
              label={quote.data.status}
            />
            {quote.data.incomplete && <StatusPill tone="attention" label="has unpriced lines — do not send" />}
            {session.capabilities.includes('quote:write') && (
              <a
                href={`/quotes/${quote.data.id}/edit`}
                className="min-h-11 cursor-pointer rounded-md border border-sq-line px-sq-3 text-sq-body font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
              >
                Edit
              </a>
            )}
          </div>
        </div>

        <div className="grid gap-sq-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Revision" value={String(quote.data.revision)} hint="Current" />
          <Stat
            label="Contract"
            value={quote.data.contractCents === undefined ? '—' : money(quote.data.contractCents)}
            hint={quote.data.contractCents === undefined ? 'Not visible to your role' : 'GST inclusive'}
          />
          <Stat label="Revisions" value={String(items.length)} />
          <Stat label="Last saved" value={date(quote.data.updatedAt)} />
        </div>

        <Panel
          title="Revisions"
          description="Every save records what the customer was sent. These figures cannot change — the database refuses it."
          padded={false}
        >
          {items.length === 0 ? (
            <p className="px-sq-3 py-sq-4 text-sq-body text-sq-ink-muted">
              This quote has no saved revisions yet.
            </p>
          ) : (
            /*
             * Seven columns do not fit a phone: at 390 px this table measured 512 px wide and pushed
             * the page 154 px sideways (2026-11-08, WCAG 1.4.10 reflow). The wrapper is what the
             * quotes list already had — the table scrolls inside its panel instead of the viewport
             * scrolling under it.
             */
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sq-body">
              <thead>
                <tr className="border-b border-sq-line text-left text-sq-micro text-sq-ink-muted">
                  <th scope="col" className="px-sq-2 py-sq-2 font-medium">Rev</th>
                  <th scope="col" className="px-sq-2 py-sq-2 font-medium">Name</th>
                  <th scope="col" className="px-sq-2 py-sq-2 font-medium">Saved</th>
                  <th scope="col" className="px-sq-2 py-sq-2 text-right font-medium">Contract</th>
                  <th scope="col" className="px-sq-2 py-sq-2 text-right font-medium">Material cost</th>
                  <th scope="col" className="px-sq-2 py-sq-2 text-right font-medium">Mass</th>
                  <th scope="col" className="px-sq-2 py-sq-2 font-medium">Engine</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const current = selected !== undefined && row.revision === selected.revision;
                  /* The whole row is the link: a table cell is not a target, and a 20 px number is not either. */
                  return (
                    <tr
                      key={row.id}
                      className={[
                        'relative border-b border-sq-line last:border-0',
                        current ? 'bg-sq-ground' : 'hover:bg-sq-ground/60',
                      ].join(' ')}
                    >
                      <td className="sq-numeric px-sq-2 py-sq-2 font-medium">
                        <a
                          href={`/quotes/${quote.data.id}?revision=${row.revision}`}
                          aria-current={current ? 'true' : undefined}
                          className="no-underline after:absolute after:inset-0 after:content-['']"
                        >
                          {row.revision}
                          <span className="sr-only">
                            {current ? ' — showing now' : ' — show this revision'}
                          </span>
                        </a>
                      </td>
                      <td className="px-sq-2 py-sq-2">
                        {row.name || `Revision ${row.revision}`}
                        {current && (
                          <span className="ml-sq-2 text-sq-micro font-medium text-sq-brand">viewing</span>
                        )}
                        {row.description !== '' && (
                          <span className="block text-sq-micro text-sq-ink-muted">{row.description}</span>
                        )}
                      </td>
                      <td className="px-sq-2 py-sq-2 text-sq-ink-muted">
                        {date(row.created_at)}
                        <span className="block text-sq-micro">{row.created_by_email}</span>
                      </td>
                      <td className="sq-numeric px-sq-2 py-sq-2">{money(row.contract_cents)}</td>
                      <td className="sq-numeric px-sq-2 py-sq-2 text-sq-ink-muted">
                        {money(row.total_cost_cents)}
                      </td>
                      <td className="sq-numeric px-sq-2 py-sq-2 text-sq-ink-muted">
                        {row.total_mass_kg.toFixed(0)} kg
                      </td>
                      <td className="px-sq-2 py-sq-2 text-sq-micro text-sq-ink-muted">
                        v{row.engine_version}
                        {row.mocked_lines > 0 && (
                          <span className="block text-sq-attention">{row.mocked_lines} unpriced</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
          )}
        </Panel>

        {items.length === 0 ? (
          <Panel
            title="The document"
            description="What the customer receives, built from the current revision."
          >
            <p className="text-sq-body text-sq-ink-muted">
              Save a revision first — the document renders from a frozen snapshot, not from the draft.
            </p>
          </Panel>
        ) : (
          <>
            {/*
              Which revision the panel is describing. Without this, a reader who followed a
              `?revision=1` link sees a document and a price with no statement of *which* save they
              are looking at — and the header above still says "Revision 2", because that is the
              quote's current one. Two numbers on one screen with no explanation is how somebody
              reads the wrong price out loud.
            */}
            <div className="flex flex-wrap items-baseline gap-sq-2">
              <h2 className="text-sq-title font-semibold">
                Revision {selected.revision}
                {selected.name !== '' && selected.name !== `Revision ${selected.revision}` && (
                  <span className="ml-sq-2 text-sq-body font-normal text-sq-ink-muted">{selected.name}</span>
                )}
              </h2>
              {viewingOlder ? (
                <>
                  <StatusPill tone="attention" label={`an earlier revision — the quote is on ${items[0].revision}`} />
                  <a
                    href={`/quotes/${quote.data.id}`}
                    className="text-sq-micro font-medium text-sq-brand underline underline-offset-2"
                  >
                    Show the current one
                  </a>
                </>
              ) : (
                <StatusPill tone="ok" label="Current revision" />
              )}
            </div>

            <QuoteActions
              quoteId={quote.data.id}
              quoteNumber={quote.data.number}
              status={quote.data.status}
              customerEmail={customer?.email ?? ''}
              customerName={customerName}
              companyName={session.currentTenantName ?? ''}
              revision={{
                id: selected.id,
                number: selected.revision,
                // Issues are not on the revision row, and the *revision*-scoped route that would
                // carry them does not exist yet — `GET /quotes/:id/revisions` lists them without
                // issues. An empty list means the send dialog asks for no acknowledgement it does
                // not need. Passing a hardcoded `[]` is honest here; inventing severities would
                // make the dialog claim a revision is clean when nobody checked.
                issues: [],
              }}
              canWrite={session.capabilities.includes('quote:write')}
              canSend={session.capabilities.includes('quote:send')}
            />

            {/*
              The sheets a workshop builds from, for the revision on screen. They sit below the
              customer document because they are the other half of the same record: the customer was
              sent a price, and this is the steel that price was made of. A role without `cost:read`
              gets nothing back from either route, and the component renders nothing.
            */}
            <FrozenSteelwork quoteId={quote.data.id} revision={selected.revision} />
          </>
        )}
      </div>
    </ShellFrame>
  );
}
