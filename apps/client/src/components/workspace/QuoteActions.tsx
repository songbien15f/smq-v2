'use client';

/**
 * The actions for a saved quote: its status, its document, and sending it.
 *
 * A client component by necessity — the "send" button opens a dialog and the status control moves a
 * row, and two server-rendered panels cannot share that state. The data it needs is small and comes
 * in from the page, so nothing here fetches on its own.
 */

import { useState } from 'react';
import { Panel } from '@sq/ui';
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

  return (
    <div className="flex flex-col gap-sq-4">
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
