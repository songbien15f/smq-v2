'use client';

/**
 * A quote's status, and the moves a person may make.
 *
 * ## Why the moves are a fixed table and not a picker
 *
 * A status is a record, and the record only means anything if the transitions are honest: a send
 * is the only thing that moves a quote out of `draft`, and a quote that a customer has answered is
 * not re-opened. So the control renders **what this quote may become right now** and nothing else,
 * rather than a menu the operator must know is wrong.
 *
 * `expired` is reachable from `draft` and `issued` — the offer stopped being one — and the
 * terminal states have no moves at all, which the control says plainly rather than sitting there
 * grey.
 */

import type { QuoteStatus } from '@sq/contracts';
import { api } from '@/lib/sq';
import { StatusPill } from '@sq/ui';

export interface StatusControlProps {
  quoteId: string;
  status: QuoteStatus;
  canWrite: boolean;
  /** Refresh the list after a move, so the record is what the screen shows. */
  onChanged: () => void;
}

/** What a quote may move to, given what it is now. */
const MOVES: Record<QuoteStatus, { to: QuoteStatus; label: string }[]> = {
  draft: [{ to: 'declined', label: 'Mark as declined' }, { to: 'expired', label: 'Mark as expired' }],
  issued: [
    { to: 'accepted', label: 'Accepted' },
    { to: 'declined', label: 'Mark as declined' },
    { to: 'expired', label: 'Mark as expired' },
  ],
  accepted: [],
  declined: [],
  expired: [],
  // A deleted quote is a record, not a working document: it moves nowhere.
  deleted: [],
};

const TONE: Record<QuoteStatus, 'ok' | 'info' | 'danger' | 'neutral'> = {
  draft: 'neutral',
  issued: 'info',
  accepted: 'ok',
  declined: 'danger',
  expired: 'danger',
  deleted: 'danger',
};

export function StatusControl({ quoteId, status, canWrite, onChanged }: StatusControlProps) {
  const moves = MOVES[status] ?? [];

  const move = async (to: QuoteStatus): Promise<void> => {
    const result = await api<{ status: string }>(`quotes/${quoteId}/status`, {
      method: 'PATCH',
      body: { to },
    });
    if (result.ok) onChanged();
  };

  if (!canWrite || moves.length === 0) {
    return (
      <div className="flex items-center gap-sq-2">
        <StatusPill tone={TONE[status]} label={status} />
        {!canWrite && <span className="text-sq-micro text-sq-ink-muted">read-only for your role</span>}
        {canWrite && moves.length === 0 && (
          <span className="text-sq-micro text-sq-ink-muted">
            {status} is a final state — the quote is not re-opened.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-sq-2">
      <StatusPill tone={TONE[status]} label={status} />
{moves.map((option) => (
    <button
      key={option.to}
      type="button"
      onClick={() => void move(option.to)}
      className="min-h-11 cursor-pointer rounded-md border border-sq-line bg-sq-surface px-sq-3 text-sq-micro font-medium text-sq-ink transition-colors duration-sq-fast hover:bg-sq-ground"
    >
      {option.label}
    </button>
  ))}
      <span className="text-sq-micro text-sq-ink-muted">
        Issued is set by sending, not here.
      </span>
    </div>
  );
}
