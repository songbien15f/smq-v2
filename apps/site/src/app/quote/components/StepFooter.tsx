'use client';

import { useRef } from 'react';
import { STEPS, type GuestStep } from '../store';
import { STEP_LABELS } from './StepTabs';
import { IconChevronLeft, IconChevronRight, IconDevice, IconRestart } from './icons';

/**
 * ‹ Back · "Your design is saved on this device" · Start over · Next › (spec "Chân khung").
 *
 * Navy outline buttons, never red — red belongs to Send alone. Start over asks first, in a native
 * `<dialog>` (focus is trapped and Esc closes it without a library). The assistant's conversation,
 * which the spec says Start over also offers to clear, arrives with G-g.
 */
export function StepFooter({
  step,
  hasDesign,
  nextStep,
  onGo,
  onStartOver,
}: {
  step: GuestStep;
  hasDesign: boolean;
  /**
   * Overrides what Next opens. ① uses it to skip ② for an enquiry type (Class 1 House, Q1), where
   * the designer does not exist.
   */
  nextStep?: GuestStep;
  onGo: (step: GuestStep) => void;
  onStartOver: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const index = STEPS.indexOf(step);
  const prev = index > 0 ? STEPS[index - 1] : null;
  const next = nextStep ?? (index < STEPS.length - 1 ? STEPS[index + 1] : null);

  return (
    <footer className="g-footer">
      <div className="g-container g-footer-row">
        {prev === null ? null : (
          <button type="button" className="g-btn g-btn-outline" onClick={() => onGo(prev)}>
            <IconChevronLeft />
            Back
          </button>
        )}
        {hasDesign ? (
          <>
            <span className="g-footer-saved">
              <IconDevice />
              Your design is saved on this device
            </span>
            <button type="button" className="g-btn g-btn-ghost" onClick={() => dialog.current?.showModal()}>
              <IconRestart />
              <span className="g-narrow-sr">Start over</span>
            </button>
          </>
        ) : null}
        {next === null ? null : (
          <button
            type="button"
            className="g-btn g-btn-outline g-footer-next"
            disabled={!hasDesign}
            onClick={() => onGo(next)}
          >
            <span>
              Next: <span className="g-wide-only">{STEP_LABELS[next].long}</span>
              <span className="g-narrow-only">{STEP_LABELS[next].short}</span>
            </span>
            <IconChevronRight />
          </button>
        )}
      </div>

      <dialog ref={dialog} className="g-dialog" aria-labelledby="g-startover-title">
        <h2 id="g-startover-title">Start over?</h2>
        <p>This clears your building, address and design from this device. It cannot be undone.</p>
        <form method="dialog" className="g-dialog-actions">
          <button type="submit" className="g-btn g-btn-outline" autoFocus>
            Keep my design
          </button>
          <button
            type="submit"
            className="g-btn g-btn-danger"
            onClick={() => {
              onStartOver();
            }}
          >
            Start over
          </button>
        </form>
      </dialog>
    </footer>
  );
}
