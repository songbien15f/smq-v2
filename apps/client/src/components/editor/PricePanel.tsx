'use client';

/**
 * The price, always on screen.
 *
 * ## Why it is not on the Cost step
 *
 * A salesperson talks to a customer while typing. The number has to move as the building changes —
 * there is no "Calculate" button in the conversation. So the price sits beside the work rather
 * than behind a step, and the Cost step is where it is *negotiated*, not where it is first seen.
 *
 * ## Why it shows what it does not know
 *
 * Two things make a quote unsafe to send and both are visible here rather than discovered later:
 * **unpriced lines** (a material the book could not price, so the total is not a total) and
 * **assumptions** (a figure that is an allowance, such as girts priced from the purlin section).
 * A price shown without them is a price that claims more than it knows.
 *
 * The figures never animate. A number that counts up cannot be read, and on this screen it is
 * being read aloud to somebody.
 */

import type { EvaluationView } from '@sq/contracts';
import { money } from '@sq/ui';
import { StatusPill } from '@sq/ui';
import { gstWithin } from './stages';

export interface PricePanelProps {
  evaluation: EvaluationView | null;
  /** True when the building or the money moved after this price was calculated. */
  stale: boolean;
  calculating: boolean;
  /** Why there is no price, when there is none. */
  error: string | null;
  onCalculate: () => void;
  /** A save is in flight. */
  saving: boolean;
  /**
   * The staged figures, already re-derived from anything the operator typed.
   *
   * Passed in rather than read from `evaluation.price` so this panel and the Cost step agree. Two
   * places computing a deposit from a negotiated contract is two answers on one screen — and the
   * one on the panel is the one the salesperson reads out loud.
   */
  stages: { contractCents: number; depositCents: number; progressCents: number; balanceCents: number };
}

export function PricePanel({
  evaluation,
  stale,
  calculating,
  error,
  onCalculate,
  saving,
  stages,
}: PricePanelProps) {
  if (error !== null) {
    return (
      <aside aria-label="Price" className="flex flex-col gap-sq-2 rounded-lg border border-sq-line bg-sq-surface p-sq-3">
        <h2 className="text-sq-body font-semibold text-sq-ink">Price</h2>
        <p role="alert" className="text-sq-body text-sq-danger">
          {error}
        </p>
        <button
          type="button"
          onClick={onCalculate}
          className="min-h-11 cursor-pointer rounded-md border border-sq-line px-sq-3 text-sq-body font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
        >
          Try again
        </button>
      </aside>
    );
  }

  if (evaluation === null) {
    return (
      <aside aria-label="Price" className="flex flex-col gap-sq-2 rounded-lg border border-sq-line bg-sq-surface p-sq-3">
        <h2 className="text-sq-body font-semibold text-sq-ink">Price</h2>
        <p className="text-sq-body text-sq-ink-muted">
          No price yet. The building on the first step has to be complete enough to count materials
          from, then it can be priced.
        </p>
        <button
          type="button"
          onClick={onCalculate}
          disabled={calculating}
          className="min-h-11 cursor-pointer rounded-md bg-sq-brand px-sq-3 text-sq-body font-medium text-white transition-colors duration-sq-fast hover:bg-sq-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {calculating ? 'Calculating…' : 'Calculate the price'}
        </button>
      </aside>
    );
  }

  const { price, issues, lines } = evaluation;
  const mocked = lines.filter((line) => line.mocked).length;
  const assumptions = issues.filter((issue) => issue.severity === 'assumption');
  const blockers = issues.filter((issue) => issue.severity === 'blocker');

  return (
    <aside aria-label="Price" className="flex flex-col gap-sq-2">
      <div className="rounded-lg border border-sq-line bg-sq-surface p-sq-3">
        <div className="flex items-center justify-between gap-sq-2">
          <h2 className="text-sq-micro font-medium uppercase tracking-wide text-sq-ink-muted">
            Contract price
          </h2>
          {stale && <StatusPill tone="attention" label="out of date" />}
        </div>

        {/*
          The one large number on the screen. `tabular-nums` and a mono face so it does not shuffle
          sideways when a digit changes, and no animation so it can be read while it updates.
        */}
        <p className={`sq-numeric mt-sq-1 text-sq-display font-semibold ${stale ? 'text-sq-ink-muted' : 'text-sq-ink'}`}>
          {money(stages.contractCents)}
        </p>
        <p className="text-sq-micro text-sq-ink-muted">
          Includes {money(gstWithin(stages.contractCents))} GST · {price.totalMassKg.toFixed(0)} kg of steel
        </p>

        <dl className="mt-sq-3 flex flex-col gap-1 text-sq-micro">
          <Row label="Deposit on signing" value={money(stages.depositCents)} />
          <Row label="Progress at frame stage" value={money(stages.progressCents)} />
          <Row label="Balance before delivery" value={money(stages.balanceCents)} />
        </dl>

        {stale && (
          <button
            type="button"
            onClick={onCalculate}
            disabled={calculating || saving}
            className="mt-sq-3 min-h-11 w-full cursor-pointer rounded-md bg-sq-brand px-sq-3 text-sq-body font-medium text-white transition-colors duration-sq-fast hover:bg-sq-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {calculating ? 'Calculating…' : 'Calculate again'}
          </button>
        )}
      </div>

      {blockers.length > 0 && (
        <div className="rounded-lg border border-sq-danger/30 bg-sq-danger/5 p-sq-3">
          <h3 className="text-sq-body font-semibold text-sq-danger">
            {blockers.length === 1 ? 'One thing blocks this quote' : `${blockers.length} things block this quote`}
          </h3>
          <ul className="mt-sq-1 flex list-disc flex-col gap-1 pl-sq-3 text-sq-micro text-sq-ink">
            {blockers.map((issue, index) => (
              // `issue.code` is NOT unique: one blocked material produces one issue per
              // line, all sharing `UNIT_ASSUMED_BRACKET`. React needs a key that is
              // unique among siblings, so the position is part of it.
              <li key={`${issue.code}-${index}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {mocked > 0 && (
        <div className="rounded-lg border border-sq-attention/30 bg-sq-attention/5 p-sq-3">
          <p className="text-sq-body text-sq-attention">
            <strong>{mocked}</strong> {mocked === 1 ? 'line has' : 'lines have'} no price
            {mocked === 1 ? '' : ''}. The total above is not a total — this quote cannot be sent
            until the price book covers them.
          </p>
        </div>
      )}

      {assumptions.length > 0 && (
        <div className="rounded-lg border border-sq-line bg-sq-surface p-sq-3">
          <h3 className="text-sq-body font-semibold text-sq-ink">
            {assumptions.length === 1 ? 'One allowance in this price' : `${assumptions.length} allowances in this price`}
          </h3>
          <p className="mt-1 text-sq-micro text-sq-ink-muted">
            A priced quote with an allowance is <em>indicative</em>, not firm. The customer sees these
            in the quote.
          </p>
          <ul className="mt-sq-2 flex flex-col gap-2 text-sq-micro text-sq-ink">
            {assumptions.map((issue, index) => (
              <li key={`${issue.code}-${index}`} className="flex flex-col gap-0.5">
                <span>{issue.message}</span>
                <code className="text-sq-micro text-sq-ink-muted">{issue.code}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-sq-2 border-b border-sq-line/60 pb-1 last:border-0">
      <dt className="text-sq-ink-muted">{label}</dt>
      <dd className="sq-numeric shrink-0 text-sq-ink">{value}</dd>
    </div>
  );
}

/**
 * The price as one line, for the widths where the panel has nowhere to live.
 *
 * ## Why this exists
 *
 * The editor is three columns above 1280 px, two between 1024 and 1279, and one below 1024. The
 * price is the **third** grid child, so it dropped to the bottom of the page: measured on
 * 2026-11-08, its top edge was at 5 092 px on a 1279 px window and 5 996 px on a phone, while the
 * page itself was 6 515 / 7 528 px tall. A salesperson on a 1280×800 laptop — the commonest laptop
 * there is — could not see the number they were quoting while filling the form, which is the one
 * thing this screen exists to show. The module header above has claimed "the price as a sticky
 * summary at the top" since the screen was written; nothing implemented it.
 *
 * So: one line, pinned under the workspace bar, below `xl` only. The full panel keeps its place at
 * the end of the column, because that is where the payment stages and the allowances are read.
 *
 * Two things are deliberately **not** on this line: the payment stages and the allowance list. They
 * need a paragraph each, and a summary that grows into a second panel has stopped being a summary.
 * What is here is the number, whether it is out of date, and the way to the step that changes it.
 */
export function PriceSummary({
  evaluation,
  stale,
  stages,
  onOpenCost,
}: {
  evaluation: EvaluationView | null;
  stale: boolean;
  stages: { contractCents: number };
  /** Named rather than a `goTo` import: this component renders, it does not navigate. */
  onOpenCost?: () => void;
}) {
  return (
    <aside
      aria-label="Price summary"
      className="flex items-center justify-between gap-sq-2"
    >
      <p className="flex min-w-0 items-baseline gap-sq-2">
        <span className="shrink-0 text-sq-micro font-medium uppercase tracking-wide text-sq-ink-muted">
          Contract price
        </span>
        {evaluation === null ? (
          <span className="truncate text-sq-body text-sq-ink-muted">No price yet</span>
        ) : (
          <span
            className={`sq-numeric truncate text-sq-body-lg font-semibold ${stale ? 'text-sq-ink-muted' : 'text-sq-ink'}`}
          >
            {money(stages.contractCents)}
          </span>
        )}
        {stale && <StatusPill tone="attention" label="out of date" />}
      </p>

      {onOpenCost !== undefined && (
        <button
          type="button"
          onClick={onOpenCost}
          className="min-h-11 shrink-0 cursor-pointer rounded-md border border-sq-line px-sq-2 text-sq-micro font-medium text-sq-ink transition-colors duration-sq-fast hover:bg-sq-ground"
        >
          Cost step
        </button>
      )}
    </aside>
  );
}
