'use client';

/**
 * The three-step progress rail.
 *
 * ## What it deliberately is not
 *
 * Not a free-navigation stepper. Steps are **gated**: Step 2 needs a valid building, because
 * placing doors on a plan that has no dimensions is meaningless, and Step 3 needs a price. A
 * stepper that lets you jump to a step whose inputs do not exist turns every later screen into a
 * defensive branch.
 *
 * ## Accessibility, and the one thing worth spelling out
 *
 * The rail is an ordered list with `aria-current="step"` on exactly one item, because a screen
 * reader user needs to know where they are, not merely which steps exist. A completed step is
 * still a **link** rather than a static tick: going back to fix a dimension is the single most
 * common action in this editor, and a step you cannot click is a step you have to hunt for.
 */

import type { ReactNode } from 'react';

export type EditorStep = 'details' | 'options' | 'cost';

const ORDER: { id: EditorStep; label: string; short: string }[] = [
  { id: 'details', label: 'Quote details', short: 'Details' },
  { id: 'options', label: 'Options on the plan', short: 'Options' },
  { id: 'cost', label: 'Cost and price', short: 'Cost' },
];

export interface StepRailProps {
  current: EditorStep;
  /** A step the operator may open. An unreachable step renders as text, not a dead link. */
  reachable: (step: EditorStep) => boolean;
  /** Why a step is unreachable, shown on hover and to a screen reader. */
  blockedReason: (step: EditorStep) => string | undefined;
  onSelect: (step: EditorStep) => void;
  /** Count of resolved problems, shown so the rail is not the only signal. */
  noticeCount?: number;
  children?: ReactNode;
}

export function StepRail({ current, reachable, blockedReason, onSelect, noticeCount }: StepRailProps) {
  const currentIndex = ORDER.findIndex((step) => step.id === current);

  return (
    <nav aria-label="Quote steps" className="border-b border-sq-line bg-sq-surface">
      <ol className="mx-auto flex max-w-[1400px] items-stretch gap-0 px-sq-3">
        {ORDER.map((step, index) => {
          const isCurrent = step.id === current;
          const isDone = index < currentIndex;
          const canGo = reachable(step.id);
          const reason = blockedReason(step.id);

          return (
            <li key={step.id} className="flex items-stretch">
              {canGo && !isCurrent ? (
                <button
                  type="button"
                  onClick={() => onSelect(step.id)}
                  aria-current={undefined}
                  className="flex min-h-11 cursor-pointer items-center gap-2 border-b-2 border-transparent px-sq-2 text-sq-micro font-medium text-sq-ink-muted transition-colors duration-sq-fast hover:border-sq-brand hover:text-sq-ink"
                >
                  <StepNumber index={index} done={isDone} current={false} />
                  <span className="hidden sm:inline">{step.short}</span>
                  <span className="sr-only sm:hidden">{step.label}</span>
                </button>
              ) : (
                <span
                  aria-current={isCurrent ? 'step' : undefined}
                  title={reason}
                  className={[
                    'flex min-h-11 items-center gap-2 border-b-2 px-sq-2 text-sq-micro font-medium',
                    isCurrent ? 'border-sq-brand text-sq-ink' : 'border-transparent text-sq-ink-muted/70',
                  ].join(' ')}
                >
                  <StepNumber index={index} done={isDone} current={isCurrent} />
                  <span className="hidden sm:inline">{step.short}</span>
                  <span className="sr-only sm:hidden">{step.label}</span>
                  {isCurrent && <span className="sr-only"> (current step)</span>}
                  {reason !== undefined && !isCurrent && <span className="sr-only"> — {reason}</span>}
                </span>
              )}
              {index < ORDER.length - 1 && (
                <span aria-hidden="true" className="self-center text-sq-ink-muted/40">
                  /
                </span>
              )}
            </li>
          );
        })}

        {noticeCount !== undefined && noticeCount > 0 && (
          <li className="ml-auto flex items-center">
            <span className="text-sq-micro font-medium text-sq-attention">
              {noticeCount} {noticeCount === 1 ? 'item needs attention' : 'items need attention'}
            </span>
          </li>
        )}
      </ol>
    </nav>
  );
}

/** A step's number, or a tick once it is behind the operator. */
function StepNumber({ index, done, current }: { index: number; done: boolean; current: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={[
        'grid h-5 w-5 shrink-0 place-items-center rounded-full text-sq-micro font-semibold',
        current
          ? 'bg-sq-brand text-white'
          : done
            ? 'bg-sq-ok/15 text-sq-ok'
            : 'bg-sq-ground text-sq-ink-muted',
      ].join(' ')}
    >
      {done ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        index + 1
      )}
    </span>
  );
}
