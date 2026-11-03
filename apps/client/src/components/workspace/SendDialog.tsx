'use client';

/**
 * Sending the quote to a customer.
 *
 * ## What this dialog is careful about
 *
 * 1. **It says what the customer will receive** — the PDF for this exact revision, attached — because
 *    an operator who thinks they are sending a link and instead sends an attachment has said
 *    something different to their customer.
 * 2. **An indicative quote needs an explicit acknowledgement.** "Indicative" means at least one figure
 *    is an allowance; sending it without the operator having read that is how an allowance becomes a
 *    promise.
 * 3. **It reports the relay's answer, not an intention.** A send that returned "queued" and then
 *    failed is shown as failed, with the mail server's own words.
 * 4. **One key per intent**, so a double-click is one email and a retry after an edit is a new one.
 */

import { useState } from 'react';
import { Button, Field } from '@sq/ui';
import { api, newIdempotencyKey } from '@/lib/sq';

export interface SendDialogProps {
  quoteId: string;
  revisionId: string;
  revision: number;
  quoteNumber: string;
  customerEmail: string;
  customerName: string;
  companyName: string;
  /** True when the revision carries allowances, which must be acknowledged. */
  indicative: boolean;
  canSend: boolean;
  onClose: () => void;
}

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; messageId: string | null }
  | { kind: 'failed'; message: string };

export function SendDialog({
  quoteId,
  revisionId,
  revision,
  quoteNumber,
  customerEmail,
  customerName,
  companyName,
  indicative,
  canSend,
  onClose,
}: SendDialogProps) {
  const [state, setState] = useState<SendState>({ kind: 'idle' });
  const [to, setTo] = useState(customerEmail);
  const [subject, setSubject] = useState(`Quotation ${quoteNumber} — ${companyName}`);
  const [body, setBody] = useState(
    `Hello ${customerName},\n\nPlease find your quotation attached.\n\nThe price and the payment stages are also shown on the document.\n\nKind regards,\n${companyName}`,
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [idempotency] = useState(() => newIdempotencyKey());

  const send = async (): Promise<void> => {
    setState({ kind: 'sending' });

    const result = await api<{ jobId: string; state: string; messageId: string | null; error?: string }>(
      `quotes/${quoteId}/send`,
      {
        method: 'POST',
        body: {
          revisionId,
          to,
          subject,
          body,
          acknowledgeIndicative: acknowledged,
          idempotencyKey: idempotency,
        },
      },
    );

    if (!result.ok) {
      setState({ kind: 'failed', message: result.message });
      return;
    }

    if (result.data.state === 'accepted') {
      setState({ kind: 'sent', messageId: result.data.messageId });
      return;
    }

    // The relay refused, or the send was interrupted. Both are answers, and both are shown.
    setState({
      kind: 'failed',
      message:
        result.data.error ??
        (result.data.state === 'unknown'
          ? 'The send was interrupted. The mail server may or may not have accepted it — check the sent folder before trying again.'
          : 'The mail server declined the message.'),
    });
  };

  const blockedByAcknowledgement = indicative && !acknowledged;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-heading"
      className="fixed inset-0 z-50 flex items-end justify-center bg-sq-brand/40 p-sq-3 sm:items-center"
    >
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg border border-sq-line bg-sq-surface p-sq-4">
        <h2 id="send-heading" className="text-sq-title font-semibold text-sq-ink">
          Email the quotation
        </h2>
        <p className="mt-sq-1 text-sq-body text-sq-ink-muted">
          {quoteNumber} revision {revision} is attached as a PDF, exactly as it was saved.
        </p>

        {state.kind === 'sent' ? (
          <div className="mt-sq-3 flex flex-col gap-sq-2">
            <p role="status" className="rounded-md border border-sq-ok/30 bg-sq-ok/10 p-sq-2 text-sq-body text-sq-ok">
              The mail server accepted the message{state.messageId === null ? '' : ` (${state.messageId})`}. The
              quote is now marked <strong>issued</strong>.
            </p>
            <p className="text-sq-micro text-sq-ink-muted">
              Accepted is not the same as delivered: the server has taken responsibility for it. A bounce
              would arrive as a reply.
            </p>
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <div className="mt-sq-3 flex flex-col gap-sq-3">
            <Field
              id="send-to"
              label="To"
              type="email"
              inputMode="email"
              required
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
            <Field
              id="send-subject"
              label="Subject"
              required
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />

            <label className="flex flex-col gap-sq-1">
              <span className="text-sq-micro font-medium text-sq-ink">Message</span>
              <textarea
                id="send-body"
                rows={7}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="min-h-32 rounded-md border border-sq-line bg-sq-surface px-sq-2 py-sq-1 text-sq-body text-sq-ink"
              />
              <span className="text-sq-micro text-sq-ink-muted">
                Plain text, so it reads the same in every mail client.
              </span>
            </label>

            {indicative && (
              <label className="flex cursor-pointer items-start gap-sq-2 rounded-md border border-sq-attention/30 bg-sq-attention/5 p-sq-2">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[var(--color-sq-attention)]"
                />
                <span className="text-sq-body text-sq-ink">
                  I have read the allowances on this quote. It is an <strong>indicative</strong> quotation and
                  the customer will see that on the page.
                </span>
              </label>
            )}

            {state.kind === 'failed' && (
              <p role="alert" className="rounded-md border border-sq-danger/30 bg-sq-danger/10 p-sq-2 text-sq-body text-sq-danger">
                {state.message}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-sq-2">
              <Button
                variant="primary"
                loading={state.kind === 'sending'}
                disabled={!canSend || blockedByAcknowledgement}
                onClick={() => void send()}
              >
                Send
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              {blockedByAcknowledgement && (
                <span className="text-sq-micro text-sq-attention">
                  Acknowledge the allowances to send this quote.
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
