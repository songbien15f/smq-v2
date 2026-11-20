'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { GuestBuildingTypeSpec, GuestDesignInput } from '@sq/core/domain';
import { editAt, useGuest, type GuestStep } from '../store';
import { reviewFlagsOf, reviewNote, shortLine, summaryLine, summaryRows } from '../summary';
import { IconList } from './icons';

/**
 * The summary bar (spec "Thanh tóm tắt", override §4 `SummaryBar`), shown once a type is picked.
 *
 * - `SummaryBar` sits in the right part of the tab bar at ≥ 768: the design in one line, a "Design
 *   summary" button that opens the full list, and the red Send button.
 * - `PhoneSummaryBar` is one line stuck to the bottom below 768, padded for the home indicator, and
 *   hidden while the soft keyboard is open so it never covers the field being typed in.
 *
 * Send goes to ③, or to the step still missing something — the caller decides.
 */
export function SummaryBar({
  design,
  type,
  step,
  onSend,
}: {
  design: GuestDesignInput;
  type: GuestBuildingTypeSpec | undefined;
  step: GuestStep;
  onSend: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popId = useId();
  const contact = useGuest((s) => s.contact);
  const line = summaryLine(design, type);
  const review = reviewNote(reviewFlagsOf(design, type));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current !== null && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // A tab change closes the list: it describes the design, not the tab.
  useEffect(() => setOpen(false), [step]);

  return (
    <div ref={wrap} className="g-summary">
      <div className="g-summary-text">
        <span className="g-summary-label">Your design</span>
        <span className="g-summary-value" title={line}>
          {line}
        </span>
        {review === null ? null : (
          <span className="g-summary-review">
            <span className="g-summary-dot" aria-hidden="true" />
            {review}
          </span>
        )}
      </div>
      <button
        ref={button}
        type="button"
        className="g-btn g-summary-toggle"
        aria-expanded={open}
        aria-controls={popId}
        onClick={() => setOpen((o) => !o)}
      >
        <IconList />
        {/* Words from 1024 up; below that the tabs need the room and the icon keeps its name. */}
        <span className="g-summary-toggle-label">Design summary</span>
      </button>
      {step === 'send' ? null : (
        <button type="button" className="g-btn g-btn-primary g-summary-send" onClick={onSend}>
          Send quote request
        </button>
      )}

      <div id={popId} className="g-sumpop" hidden={!open} role="region" aria-label="Design summary">
        <dl className="g-sum g-sum-compact">
          {summaryRows(design, type, contact).map((row) => (
            <div key={row.key} className={`g-sum-row${row.missing === true ? ' g-sum-missing' : ''}`}>
              <dt>{row.label}</dt>
              <dd>
                {row.value.length === 0 ? (
                  <span className="g-sum-none">None</span>
                ) : (
                  row.value.map((v) => <span key={v}>{v}</span>)
                )}
              </dd>
              <dd className="g-sum-edit">
                <button
                  type="button"
                  className="g-link-btn"
                  onClick={() => {
                    setOpen(false);
                    editAt(row.step, row.focus, type);
                  }}
                >
                  {row.missing === true ? 'Add' : 'Edit'}
                  <span className="g-sr-only"> {row.label.toLowerCase()}</span>
                </button>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** How much the visual viewport must shrink before it counts as a keyboard, not a toolbar. */
const KEYBOARD_PX = 150;

export function PhoneSummaryBar({
  design,
  type,
  step,
  onSend,
}: {
  design: GuestDesignInput;
  type: GuestBuildingTypeSpec | undefined;
  step: GuestStep;
  onSend: () => void;
}) {
  const keyboard = useKeyboardOpen();
  // On ③ the form's own Send button is the one to press; a second one would sit on top of it.
  if (step === 'send') return null;
  return (
    <>
      <div className="g-mbar-spacer" aria-hidden="true" />
      <div className="g-mbar" data-hidden={keyboard || undefined}>
        <span className="g-mbar-text">{shortLine(design, type)}</span>
        <button type="button" className="g-btn g-btn-primary g-mbar-send" onClick={onSend} tabIndex={keyboard ? -1 : 0}>
          Send quote request
        </button>
      </div>
    </>
  );
}

/** True while the soft keyboard is up, measured with `visualViewport` (spec "Thanh tóm tắt"). */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (vv === null || vv === undefined) return;
    const measure = () => setOpen(window.innerHeight - vv.height * vv.scale > KEYBOARD_PX);
    measure();
    vv.addEventListener('resize', measure);
    return () => vv.removeEventListener('resize', measure);
  }, []);
  return open;
}
