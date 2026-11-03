import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { currentSession } from '@/lib/api';
import { QuoteEditor } from '@/components/editor/QuoteEditor';

/**
 * A new quote.
 *
 * The session is resolved on the server so the editor never renders for a signed-out visitor, and
 * so the company name is available without a round trip. Everything after that is client-side,
 * because the editor is a live document — a server render per keystroke would be absurd.
 */
export default async function NewQuotePage() {
  const session = await currentSession<SessionView>();
  if (session === null) redirect('/');

  // A viewer may read quotes and nothing else. Sending them to the list rather than showing a
  // disabled editor: an editor they cannot save is a screen that exists only to refuse them.
  if (!session.capabilities.includes('quote:write')) {
    redirect('/quotes');
  }

  return <QuoteEditor session={session} />;
}
