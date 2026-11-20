'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { GuestBuildingTypeSpec, GuestDesignInput } from '@sq/core/domain';
import { STEPS, stepLocked, contactStarted, type ContactDraft, type GuestStep } from '../store';
import type { MissingStep } from '../summary';
import { IconCheck } from './icons';

export const STEP_LABELS: Record<GuestStep, { long: string; short: string }> = {
  start: { long: 'Start', short: 'Start' },
  design: { long: 'Building', short: 'Build' },
  send: { long: 'Send request', short: 'Send' },
};

export const tabId = (step: GuestStep) => `g-tab-${step}`;
export const panelId = (step: GuestStep) => `g-panel-${step}`;
const LOCK_HINT_ID = 'g-tab-lock-hint';

/**
 * Done = filled in, and not missing anything for Send. ③ is never "done": it is the goal.
 * ② also needs to have been opened: a type's default design is already valid, so without that ②
 * ticked itself the moment a type was picked on ①.
 */
function complete(step: GuestStep, design: GuestDesignInput | null, missing: string | null, designSeen: boolean): boolean {
  if (design === null || step === 'send' || missing !== null) return false;
  if (step === 'start') return design.site !== undefined;
  return designSeen;
}

/**
 * The three steps, on the WAI-ARIA Tabs pattern with manual activation (spec "Tab theo mẫu WAI-ARIA").
 *
 * - Roving tabindex: one tab is in the Tab order; ←/→ move focus, Home/End jump to the ends.
 * - Enter/Space (or a click) opens the focused tab — focus alone does not, because ② is heavy.
 * - A locked tab stays focusable, so a screen reader hears why it is locked, but does not open.
 */
export function StepTabs({
  step,
  design,
  type,
  contact,
  missing,
  designSeen,
  onActivate,
  children,
}: {
  step: GuestStep;
  design: GuestDesignInput | null;
  type: GuestBuildingTypeSpec | undefined;
  contact: ContactDraft;
  missing: readonly MissingStep[];
  designSeen: boolean;
  onActivate: (step: GuestStep) => void;
  children?: React.ReactNode;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState(STEPS.indexOf(step));
  const anyLocked = design === null || design.site === undefined || !contactStarted(contact);

  useEffect(() => setFocusIndex(STEPS.indexOf(step)), [step]);

  function moveFocus(index: number) {
    const next = (index + STEPS.length) % STEPS.length;
    setFocusIndex(next);
    refs.current[next]?.focus();
    refs.current[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = refs.current.findIndex((el) => el === document.activeElement);
    if (current === -1) return;
    switch (event.key) {
      case 'ArrowRight':
        moveFocus(current + 1);
        break;
      case 'ArrowLeft':
        moveFocus(current - 1);
        break;
      case 'Home':
        moveFocus(0);
        break;
      case 'End':
        moveFocus(STEPS.length - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <div className="g-tabbar">
      <div className="g-container">
        <div className="g-tabbar-row">
          <div className="g-tablist" role="tablist" aria-label="Quote steps" onKeyDown={onKeyDown}>
            {STEPS.map((s, i) => {
              const locked = stepLocked(s, design, type, contact);
              const selected = s === step;
              const lack = missing.find((m) => m.step === s)?.reason ?? null;
              const done = !selected && complete(s, design, lack, designSeen);
              return (
                <button
                  key={s}
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={tabId(s)}
                  className={`g-tab${done ? ' g-tab-done' : ''}`}
                  aria-selected={selected}
                  {...(selected ? { 'aria-controls': panelId(s) } : {})}
                  {...(locked ? { 'aria-disabled': true, 'aria-describedby': LOCK_HINT_ID } : {})}
                  tabIndex={i === focusIndex ? 0 : -1}
                  onFocus={() => setFocusIndex(i)}
                  onClick={() => {
                    if (!locked) onActivate(s);
                  }}
                >
                  <span className="g-tab-num" aria-hidden="true">
                    {done ? <IconCheck className="g-tab-check" /> : i + 1}
                  </span>
                  <span className="g-tab-label-long">{STEP_LABELS[s].long}</span>
                  <span className="g-tab-label-short">{STEP_LABELS[s].short}</span>
                  {done ? <span className="g-sr-only">, complete</span> : null}
                  {lack === null ? null : (
                    <>
                      <span className="g-tab-dot" aria-hidden="true" />
                      <span className="g-sr-only">, {lack}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          {children}
        </div>
        {anyLocked ? (
          <p id={LOCK_HINT_ID} className="g-tab-hint">
            Fill in your building type, address and contact details first.
          </p>
        ) : null}
      </div>
    </div>
  );
}