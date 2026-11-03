/**
 * Surface primitives and status.
 *
 * `StatusPill` is the one place a state is allowed to be colourful, and it is
 * deliberately never colour-only: it always carries a word. A red dot beside
 * "unpriced" tells a colour-blind reader nothing, and a screen reader even less.
 */

import type { ReactNode } from 'react';

/** A white card on the page ground. */
export function Panel({
  title,
  description,
  actions,
  children,
  padded = true,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="rounded-lg border border-sq-line bg-sq-surface">
      {(title !== undefined || actions !== undefined) && (
        <header className="flex flex-wrap items-start justify-between gap-sq-2 border-b border-sq-line px-sq-3 py-sq-2">
          <div>
            {title !== undefined && <h2 className="text-sq-body font-semibold text-sq-ink">{title}</h2>}
            {description !== undefined && (
              <p className="mt-0.5 text-sq-micro text-sq-ink-muted">{description}</p>
            )}
          </div>
          {actions}
        </header>
      )}
      <div className={padded ? 'p-sq-3' : ''}>{children}</div>
    </section>
  );
}

export type StatusTone = 'ok' | 'attention' | 'danger' | 'info' | 'neutral';

const TONE: Record<StatusTone, string> = {
  ok: 'bg-sq-ok/10 text-sq-ok border-sq-ok/25',
  attention: 'bg-sq-attention/10 text-sq-attention border-sq-attention/25',
  danger: 'bg-sq-danger/10 text-sq-danger border-sq-danger/25',
  info: 'bg-sq-info/10 text-sq-info border-sq-info/25',
  neutral: 'bg-sq-ground text-sq-ink-muted border-sq-line',
};

/**
 * A state, as a word with a colour — never a colour alone.
 *
 * The label is required by the type, so "a pill with no text" cannot be built
 * without deliberately passing an empty string.
 */
export function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sq-micro font-medium ${TONE[tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}

/** A single figure with its label, for a summary strip. */
export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: StatusTone;
}) {
  const valueColour =
    tone === 'danger'
      ? 'text-sq-danger'
      : tone === 'attention'
        ? 'text-sq-attention'
        : tone === 'ok'
          ? 'text-sq-ok'
          : 'text-sq-ink';

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sq-micro text-sq-ink-muted">{label}</span>
      <span className={`sq-numeric text-sq-title font-semibold ${valueColour}`}>{value}</span>
      {hint !== undefined && <span className="text-sq-micro text-sq-ink-muted">{hint}</span>}
    </div>
  );
}

/**
 * An empty state that says what to do next.
 *
 * "No data" is not an empty state; it is a shrug. The `action` slot is where the
 * next step goes.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-sq-2 rounded-lg border border-dashed border-sq-line p-sq-6">
      <h3 className="text-sq-body font-semibold text-sq-ink">{title}</h3>
      <p className="max-w-prose text-sq-body text-sq-ink-muted">{body}</p>
      {action}
    </div>
  );
}
