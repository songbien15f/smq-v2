import { notFound, redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { currentSession, serverFetch } from '@/lib/api';
import { QuoteEditor } from '@/components/editor/QuoteEditor';

/**
 * Amend an existing quote.
 *
 * This route is what makes a **second revision** reachable. The editor already accepted an
 * `initial` draft and the save route already appends a revision when given a `quoteId` and the
 * revision it expects — but nothing ever passed `initial`, so a saved quote could only be looked
 * at. Re-opening it here loads the frozen building and money of the current revision, and saving
 * writes revision N+1 while revision N stays exactly as the customer received it.
 *
 * The draft is seeded from the **server's** copy of the revision, not from anything the browser
 * kept: a quote opened on a second machine must show the same building as the first.
 */

interface QuoteForEdit {
  id: string;
  number: string;
  revision: number;
  customer: Record<string, string | null> | null;
  site: Record<string, unknown>;
  /** Present only for a role that may see cost; absent for a viewer. */
  config?: Record<string, unknown>;
  pricing?: Record<string, unknown>;
}

/** A string field of a loose JSON record, or `''`. */
function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

export default async function EditQuotePage({ params }: { params: Promise<{ quoteId: string }> }) {
  const session = await currentSession<SessionView>();
  if (session === null) redirect('/');

  // Same gate as `/quotes/new`: an editor a person cannot save is a screen that exists to refuse.
  if (!session.capabilities.includes('quote:write')) {
    redirect('/quotes');
  }

  const { quoteId } = await params;
  const quote = await serverFetch<QuoteForEdit>(`/quotes/${quoteId}`);
  if (!quote.ok) notFound();

  const data = quote.data;

  /*
   * A quote with no frozen building cannot be edited.
   *
   * That is a quote whose current revision predates the config being stored, or a viewer's copy
   * where the server withheld it. Sending them to the read-only page is honest; rendering an
   * editor seeded with a blank building would let them save a revision that silently replaced
   * the real one.
   */
  if (data.config === undefined || data.pricing === undefined) {
    redirect(`/quotes/${quoteId}`);
  }

  const customer = data.customer ?? {};
  const site = data.site;

  return (
    <QuoteEditor
      session={session}
      initial={{
        quoteId: data.id,
        quoteNumber: data.number,
        revision: data.revision,
        customer: {
          firstName: text(customer, 'firstName'),
          lastName: text(customer, 'lastName'),
          email: text(customer, 'email'),
          phone: text(customer, 'phone'),
          mobile: text(customer, 'mobile'),
          address: text(customer, 'address'),
          suburb: text(customer, 'suburb'),
          state: text(customer, 'state'),
          postcode: text(customer, 'postcode'),
        },
        site: {
          address: text(site, 'address'),
          suburb: text(site, 'suburb'),
          state: text(site, 'state'),
          postcode: text(site, 'postcode'),
          deliveryAddress: text(site, 'deliveryAddress'),
          deliveryScope: text(site, 'deliveryScope'),
          // Stored as a boolean; an older row may hold the string. Either reads as "acknowledged"
          // only when it is genuinely true — a quote must not silently claim terms were read.
          deliveryAcknowledged: site.deliveryAcknowledged === true || site.deliveryAcknowledged === 'true',
        },
        pricing: data.pricing as never,
        config: data.config,
      }}
    />
  );
}
