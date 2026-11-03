'use client';

/**
 * The error summary, at the top of the form.
 *
 * ## The three rules it implements, and why each is not optional
 *
 * 1. **It is focusable and receives focus after a failed save.** A message at the top of a long
 *    form that nothing moves to is a message a keyboard or screen-reader user has to hunt for. The
 *    heading takes `tabIndex={-1}` and is focused programmatically.
 * 2. **Each item is a link to its field.** Tabbing to a field is not the same as arriving at it;
 *    the link moves focus so the operator is typing in the right box.
 * 3. **It does not replace the inline errors.** The summary is for finding problems, the inline
 *    message is for fixing them. A summary-only form makes a person scroll up and down to work out
 *    which field a sentence refers to.
 */

import { useRef } from 'react';
import type { DraftIssue } from './validation';

export interface ErrorSummaryProps {
  issues: readonly DraftIssue[];
  /** Shown only after a save was attempted, so the list does not appear while typing. */
  visible: boolean;
  /** A save was refused by the server; shown above the field list. */
  serverMessage?: string;
  /**
   * The server's own field errors, when it named any.
   *
   * Shown as well as the message, not instead of it. Without these a mismatch between the form's
   * rules and the API's — the customer address was required on one side only — produced "Some fields
   * need attention" and nothing marked, which is a message an operator cannot act on.
   */
  serverDetails?: readonly { path: string; message: string }[];
}

export function ErrorSummary({ issues, visible, serverMessage, serverDetails }: ErrorSummaryProps) {
  const heading = useRef<HTMLHeadingElement>(null);

  /**
   * Rendered when **either** there are field problems **or** the server refused.
   *
   * The first version returned `null` unless `issues.length > 0`, so a refusal on a valid form —
   * a conflict, an expired preview, a 500 — was silent. The button did nothing and the operator had
   * no way to know why.
   */
  if (!visible || (issues.length === 0 && serverMessage === undefined)) return null;

  /** Move focus to a field by id, and mark it so a reader knows which one was just visited. */
  const goTo = (path: string): void => {
    const element = document.getElementById(path);
    if (element === null) return;
    element.focus();
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const count = issues.length;

  return (
    <section
      aria-labelledby="error-summary-heading"
      className="rounded-lg border border-sq-danger/30 bg-sq-danger/5 p-sq-3"
    >
      <h2
        id="error-summary-heading"
        ref={heading}
        tabIndex={-1}
        className="text-sq-body font-semibold text-sq-danger outline-none"
      >
        {count > 0
          ? `There ${count === 1 ? 'is 1 problem' : `are ${count} problems`} to fix before this quote can be saved`
          : 'This quote could not be saved'}
      </h2>

      {serverMessage !== undefined && (
        <p className="mt-sq-1 text-sq-body text-sq-ink" role="alert">
          {serverMessage}
        </p>
      )}

      {/*
        The server's own field list, rendered the same way as the local one so both are actionable.
        A path the form does not have an input for is shown as plain text rather than a dead link.
      */}
      {serverDetails !== undefined && serverDetails.length > 0 && (
        <ul className="mt-sq-2 flex flex-col gap-1">
          {serverDetails.map((detail, index) => (
            <li key={`${detail.path}-${index}`} className="text-sq-body text-sq-ink">
              {document !== undefined ? (
                <ServerDetail detail={detail} onGoTo={goTo} />
              ) : (
                `${detail.path}: ${detail.message}`
              )}
            </li>
          ))}
        </ul>
      )}

      {count > 0 && (
        <ul className="mt-sq-2 flex flex-col gap-1">
          {issues.map((issue, index) => (
            <li key={`${issue.path}-${index}`} className="text-sq-body text-sq-ink">
              <button
                type="button"
                onClick={() => goTo(issue.path)}
                className="cursor-pointer text-left underline decoration-sq-danger/40 underline-offset-2 hover:decoration-sq-danger"
              >
                {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One server field error.
 *
 * A link when the form has a field with that path, plain text when it does not — a link to nowhere
 * is worse than no link, because it looks like a way to fix something.
 */
function ServerDetail({
  detail,
  onGoTo,
}: {
  detail: { path: string; message: string };
  onGoTo: (path: string) => void;
}) {
  const exists = typeof document !== 'undefined' && document.getElementById(detail.path) !== null;

  if (!exists) {
    return (
      <span>
        <code className="text-sq-micro">{detail.path}</code>: {detail.message}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onGoTo(detail.path)}
      className="cursor-pointer text-left underline decoration-sq-danger/40 underline-offset-2 hover:decoration-sq-danger"
    >
      {detail.message}
    </button>
  );
}

/** Focus the summary heading, after a save attempt has been refused. */
export function focusErrorSummary(): void {
  // The heading is rendered by the time this runs, because the refusal has already been handled.
  const element = document.getElementById('error-summary-heading');
  element?.focus();
  element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
