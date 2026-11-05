'use client';

/**
 * The actions for a saved quote: its status, its document, and sending it.
 *
 * A client component by necessity — the "send" button opens a dialog and the status control moves a
 * row, and two server-rendered panels cannot share that state. The data it needs is small and comes
 * in from the page, so nothing here fetches on its own.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Panel } from '@sq/ui';
import { api } from '@/lib/sq';
import { DocumentActions } from './DocumentActions';
import { SendHistory } from './SendHistory';
import { StatusControl } from './StatusControl';
import { SendDialog } from './SendDialog';

export interface QuoteActionsProps {
  quoteId: string;
  quoteNumber: string;
  status: string;
  customerEmail: string;
  customerName: string;
  companyName: string;
  /** The latest revision, the one a send would attach. */
  revision: { id: string; number: number; issues: { code: string; severity: string }[] };
  canWrite: boolean;
  canSend: boolean;
}

export function QuoteActions({
  quoteId,
  quoteNumber,
  status,
  customerEmail,
  customerName,
  companyName,
  revision,
  canWrite,
  canSend,
}: QuoteActionsProps) {
  const [sending, setSending] = useState(false);
  // Bumped after a send so the history panel re-reads the queue.
  const [historyKey, setHistoryKey] = useState(0);

  const indicative = revision.issues.some((issue) => issue.severity === 'assumption');
  const router = useRouter();
  const [quoteMessage, setQuoteMessage] = useState<string | null>(null);

  const copyQuote = async (): Promise<void> => {
    const result = await api<{ quoteId: string }>(`quotes/${quoteId}/copy`, { method: 'POST' });
    if (!result.ok) {
      setQuoteMessage(result.message);
      return;
    }
    // A copy exists to be changed, so it opens for editing.
    router.push(`/quotes/${result.data.quoteId}/edit`);
  };

  const renameRevision = async (): Promise<void> => {
    const name = window.prompt(`Name for revision ${revision.number}`, '');
    if (name === null) return;
    const result = await api(`quotes/${quoteId}/revisions/${revision.number}`, {
      method: 'PATCH',
      body: { name },
    });
    if (!result.ok) {
      setQuoteMessage(result.message);
      return;
    }
    router.refresh();
  };

  const deleteQuote = async (): Promise<void> => {
    if (
      !window.confirm(
        `Delete ${quoteNumber}? It is taken out of use; the record of what was sent stays.`,
      )
    ) {
      return;
    }
    const result = await api(`quotes/${quoteId}`, { method: 'DELETE' });
    if (!result.ok) {
      setQuoteMessage(result.message);
      return;
    }
    router.push('/quotes');
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-sq-4">
      {canWrite && (
        <Panel title="Quote">
          <div className="flex flex-wrap items-center gap-sq-2">
            <button
              type="button"
              onClick={() => void copyQuote()}
              className="min-h-11 cursor-pointer rounded-md border border-sq-line px-sq-3 text-sq-body font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
            >
              Copy to a new quote
            </button>
            <button
              type="button"
              onClick={() => void renameRevision()}
              className="min-h-11 cursor-pointer rounded-md border border-sq-line px-sq-3 text-sq-body font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
            >
              Rename revision {revision.number}
            </button>
            <button
              type="button"
              onClick={() => void deleteQuote()}
              className="min-h-11 cursor-pointer rounded-md border border-sq-line px-sq-3 text-sq-body font-medium text-sq-danger transition-colors duration-sq-fast hover:bg-sq-ground"
            >
              Delete
            </button>
          </div>
          {quoteMessage !== null && (
            <p role="alert" className="mt-sq-2 text-sq-body text-sq-danger">
              {quoteMessage}
            </p>
          )}
        </Panel>
      )}
      <Panel title="Status">
        <StatusControl
          quoteId={quoteId}
          status={status as 'draft' | 'issued' | 'accepted' | 'declined' | 'expired'}
          canWrite={canWrite}
          onChanged={() => {
            /* The list re-renders from its own data; a move here only changes the pill. */
          }}
        />
      </Panel>

      <Panel
        title="The document"
        description="What the customer receives, built from the current revision."
      >
        <div className="flex flex-col gap-sq-3">
          <DocumentActions
            quoteId={quoteId}
            revisionId={revision.id}
            revision={revision.number}
            canSend={canSend}
            onSend={canSend ? () => setSending(true) : undefined}
          />
        </div>
      </Panel>

      {sending && (
        <SendDialog
          quoteId={quoteId}
          revisionId={revision.id}
          revision={revision.number}
          quoteNumber={quoteNumber}
          customerEmail={customerEmail}
          customerName={customerName}
          companyName={companyName}
          indicative={indicative}
          canSend={canSend}
          onClose={() => {
            setSending(false);
            // A send moves the quote to `issued` and writes a queue row; the history panel below
            // would otherwise still show the state from before the dialog opened.
            setHistoryKey((key) => key + 1);
          }}
        />
      )}

      {/*
        What was sent, and what the mail server said. The queue records `accepted`, `failed` and
        `unknown` — and `unknown` is the one that matters: a crash between the SMTP call and the
        result leaves a send nobody can account for, and an operator needs to see that rather than
        assume it went out.
      */}
      <SendHistory quoteId={quoteId} refreshKey={historyKey} />
    </div>
  );
}
