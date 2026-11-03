'use client';

/**
 * A labelled field.
 *
 * The label is above the control and always visible. A placeholder is not a label:
 * it disappears exactly when the operator needs to know what the field was, which
 * on a quote form is while they are arguing with a customer about the span.
 *
 * Error text sits directly under the control, in the danger colour, with an icon —
 * not colour alone, because a red border is invisible to a colour-blind user and a
 * screen reader announces nothing.
 */

import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string;
  /** Shown under the control in the muted colour. */
  hint?: string;
  /** When set, the field is invalid and this replaces the hint. */
  error?: string;
  /** Right-aligned trailing content, e.g. a unit (`mm`). */
  suffix?: ReactNode;
  required?: boolean;
}

export function Field({ label, hint, error, suffix, required, id, ...rest }: FieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const describedBy = error !== undefined ? `${fieldId}-error` : hint !== undefined ? `${fieldId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-sq-1">
      <label htmlFor={fieldId} className="text-sq-micro font-medium text-sq-ink">
        {label}
        {required === true && (
          <span className="ml-1 text-sq-danger" aria-hidden="true">
            *
          </span>
        )}
        {required === true && <span className="sr-only"> (required)</span>}
      </label>

      <div className="flex items-center gap-sq-2">
        <input
          id={fieldId}
          aria-invalid={error !== undefined || undefined}
          aria-describedby={describedBy}
          aria-required={required === true || undefined}
          className={[
            'min-h-11 w-full rounded-md border bg-sq-surface px-sq-2 py-sq-1',
            'text-sq-body text-sq-ink placeholder:text-sq-ink-muted/60',
            'transition-colors duration-sq-fast',
            error !== undefined ? 'border-sq-danger' : 'border-sq-line',
          ].join(' ')}
          {...rest}
        />
        {suffix !== undefined && (
          <span className="shrink-0 text-sq-micro text-sq-ink-muted">{suffix}</span>
        )}
      </div>

      {error !== undefined ? (
        <p id={`${fieldId}-error`} className="flex items-start gap-1 text-sq-micro text-sq-danger">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="mt-0.5 shrink-0">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
          </svg>
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={`${fieldId}-hint`} className="text-sq-micro text-sq-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
