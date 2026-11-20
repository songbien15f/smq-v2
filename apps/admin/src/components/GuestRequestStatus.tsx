'use client';

/**
 * Decline, mark spam, or put a request back to new.
 *
 * Nothing is deleted: a request somebody sent is a record that they asked. "Transferred" is set only
 * by handing the request to a company (a later slice), so a transferred request shows no buttons.
 */

import { useState } from 'react';
import { Button, StatusPill } from '@sq/ui';
import { api } from '@/lib/adminApi';
import { STATUS_LABEL, STATUS_TONE, type GuestRequestStatus } from '@/lib/guestRequests';

export function GuestRequestStatusPanel({
  number,
  initialStatus,
  initialReason,
}: {
  number: string;
  initialStatus: GuestRequestStatus;
  initialReason: string | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [reason, setReason] = useState(initialReason);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<GuestRequestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const change = async (next: 'new' | 'declined' | 'spam'): Promise<void> => {
    setBusy(next);
    setError(null);
    const result = await api<{ status: GuestRequestStatus; declineReason: string | null }>(
      `admin/guest-requests/${encodeURIComponent(number)}`,
      { method: 'PATCH', body: next === 'declined' && draft.trim() !== '' ? { status: next, reason: draft.trim() } : { status: next } },
    );
    setBusy(null);
    if (result.ok) {
      setStatus(result.data.status);
      setReason(result.data.declineReason);
      setDraft('');
    } else {
      setError(result.message);
    }
  };

  return (
    <div className="flex flex-col gap-sq-3">
      <div className="flex flex-wrap items-center gap-sq-2">
        <StatusPill tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />
        {status === 'declined' && reason !== null && (
          <span className="text-sq-body text-sq-ink-muted">Reason: {reason}</span>
        )}
      </div>

      {status === 'transferred' ? (
        <p className="text-sq-body text-sq-ink-muted">Handed to a company; its status no longer changes here.</p>
      ) : status === 'new' ? (
        <div className="flex flex-col gap-sq-2">
          <label className="flex flex-col gap-1 text-sq-micro text-sq-ink-muted">
            Reason for declining (optional, kept with the request)
            <input
              type="text"
              maxLength={500}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-9 max-w-xl rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body text-sq-ink"
            />
          </label>
          <div className="flex flex-wrap gap-sq-2">
            <Button loading={busy === 'declined'} disabled={busy !== null} onClick={() => void change('declined')}>
              Decline
            </Button>
            <Button
              variant="destructive"
              loading={busy === 'spam'}
              disabled={busy !== null}
              onClick={() => void change('spam')}
            >
              Mark as spam
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button loading={busy === 'new'} disabled={busy !== null} onClick={() => void change('new')}>
            Put back to new
          </Button>
        </div>
      )}

      {error !== null && (
        <p role="alert" className="text-sq-body text-sq-danger">
          {error}
        </p>
      )}
    </div>
  );
}
