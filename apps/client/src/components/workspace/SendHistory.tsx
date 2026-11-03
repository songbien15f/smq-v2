'use client';

/**
 * What was sent, and what the mail server said about it.
 *
 * ## Why this is a panel and not a toast
 *
 * A send is not an event that happened once and is over. The queue records a state per attempt —
 * `queued`, `sending`, `accepted`, `failed`, `unknown`, `cancelled` — and the state that matters most
 * is `unknown`: a crash between the SMTP call and the result write leaves a row nobody can account
 * for. An operator needs to be able to come back an hour later and see it, which a toast cannot do.
 *
 * ## Why `accepted` is not called "delivered"
 *
 * The state says what the *mail server* said. The server accepted the message for delivery; whether
 * it reached an inbox is a claim this program cannot make, and a screen that says "delivered" would
 * be lying on the one question a customer will ring up about.
 *
 * ## Why a failure is safe to retry but `unknown` is not
 *
 * A `failed` job was refused by the relay, so nothing went out and a retry is safe. An `unknown` job
 * may or may not have been accepted; sending the customer a second quote is worse than asking
 * someone to check, so the row says so in words rather than offering a retry button.
 */

import { useCallback, useEffect, useState } from 'react';
import { Panel, StatusPill } from '@sq/ui';
import { api } from '@/lib/sq';

/** One send attempt, as the API reports it. */
interface SendJob {
  id: string;
  to: string;
  subject: string;
  state: 'queued' | 'sending' | 'accepted' | 'failed' | 'unknown' | 'cancelled';
  attempts: number;
  messageId: string | null;
  lastError: string | null;
  acknowledgedIndicative: boolean;
  createdAt: string;
  sentAt: string | null;
}

/** How a state reads to a person, and how it should be coloured. */
const STATE: Record<SendJob['state'], { label: string; tone: 'ok' | 'danger' | 'attention' | 'info' | 'neutral'; hint: string }> = {
  queued: { label: 'Queued', tone: 'neutral', hint: 'Waiting to be sent.' },
  sending: { label: 'Sending', tone: 'info', hint: 'Handed to the mail server.' },
  accepted: { label: 'Accepted', tone: 'ok', hint: 'The mail server took it. That is not proof it reached an inbox.' },
  failed: { label: 'Failed', tone: 'danger', hint: 'The mail server refused it, so nothing was delivered. Safe to try again.' },
  unknown: {
    label: 'Unknown',
    tone: 'attention',
    hint: 'The send was interrupted. Check with the customer before sending again — a second copy is worse than a phone call.',
  },
  cancelled: { label: 'Cancelled', tone: 'neutral', hint: 'Not sent — the company was suspended or the quote changed.' },
};

/** A date and time, short enough for a table cell. */
function when(value: string | null): string {
  if (value === null || value === '') return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16).replace('T', ' ');
  return parsed.toISOString().slice(0, 16).replace('T', ' ');
}

export interface SendHistoryProps {
  quoteId: string;
  /** Changes when a send completes, so the list re-reads rather than showing a stale state. */
  refreshKey?: number;
}

export function SendHistory({ quoteId, refreshKey = 0 }: SendHistoryProps) {
  const [jobs, setJobs] = useState<SendJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    const result = await api<{ items: SendJob[] }>(`quotes/${quoteId}/sends`);
    if (result.ok) {
      setJobs(result.data.items);
      setError(null);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }, [quoteId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Nothing has ever been sent and nothing failed to load: the panel would be an empty table
  // claiming a feature that has not been used. Say nothing instead.
  if (loading || (jobs.length === 0 && error === null)) return null;

  return (
    <Panel
      title="Sends"
      description="Every attempt to email this quote, and what the mail server said."
      padded={false}
    >
      {error !== null ? (
        <p role="alert" className="px-sq-3 py-sq-4 text-sq-body text-sq-danger">
          {error}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sq-body">
            <thead>
              <tr className="border-b border-sq-line text-left text-sq-micro text-sq-ink-muted">
                <th scope="col" className="px-sq-3 py-sq-2 font-medium">When</th>
                <th scope="col" className="px-sq-3 py-sq-2 font-medium">To</th>
                <th scope="col" className="px-sq-3 py-sq-2 font-medium">State</th>
                <th scope="col" className="px-sq-3 py-sq-2 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const state = STATE[job.state];
                return (
                  <tr key={job.id} className="border-b border-sq-line last:border-0">
                    <td className="px-sq-3 py-sq-2 text-sq-ink-muted">{when(job.sentAt ?? job.createdAt)}</td>
                    <td className="px-sq-3 py-sq-2">{job.to}</td>
                    <td className="px-sq-3 py-sq-2">
                      <StatusPill tone={state.tone} label={state.label} />
                      <span className="mt-1 block text-sq-micro text-sq-ink-muted">{state.hint}</span>
                    </td>
                    <td className="px-sq-3 py-sq-2 text-sq-micro text-sq-ink-muted">
                      {job.lastError !== null ? (
                        <span className="text-sq-danger">{job.lastError}</span>
                      ) : job.messageId !== null ? (
                        <span className="sq-numeric">{job.messageId}</span>
                      ) : (
                        '—'
                      )}
                      {job.attempts > 1 && (
                        <span className="mt-1 block">{job.attempts} attempts</span>
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
  );
}
