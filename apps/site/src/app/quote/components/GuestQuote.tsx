'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GuestBuildingTypesResponse } from '@sq/contracts';
import { type GuestBuildingTypeSpec } from '@sq/core/domain';
import { applyQueuedOpen } from '../account';
import { guestApi } from '../api';
import {
  chooseType,
  contactStarted,
  explainStart,
  focusSelector,
  goTo,
  hydrate,
  startOver,
  syncFromLocation,
  takePendingFocus,
  useGuest,
  type GuestStep,
} from '../store';
import { missingSteps, needsDesign } from '../summary';
import { GuestHeader } from './GuestHeader';
import { DesignPanel } from './DesignPanel';
import { StepFooter } from './StepFooter';
import { SendPanel } from './SendPanel';
import { StartPanel } from './StartPanel';
import { StepTabs, panelId, tabId } from './StepTabs';
import { PhoneSummaryBar, SummaryBar } from './SummaryBar';
import { IconCheck } from './icons';

type TypesState =
  | { status: 'loading' }
  | { status: 'ready'; types: readonly GuestBuildingTypeSpec[] }
  | { status: 'failed'; message: string };

const PANEL_TITLES: Record<GuestStep, string> = {
  start: 'Start your quote',
  design: 'Design your building',
  send: 'Send your quote request',
};

const PANEL_LEADS: Record<GuestStep, string> = {
  start: 'Pick the closest building type, tell us where it goes and how to reach you.',
  design: 'Set the size and roof, then add doors, windows and colours.',
  send: 'Check what you are sending, then press Send.',
};

/**
 * The Guest quote page's frame (plan G-a2 S3–S6): header, the three steps, one panel, the footer.
 *
 * ① start (type, address, contact, free-text request), ② building, ③ send and the summary bar.
 */
export function GuestQuote() {
  const ready = useGuest((s) => s.ready);
  const step = useGuest((s) => s.step);
  const design = useGuest((s) => s.design);
  const contact = useGuest((s) => s.contact);
  const designSeen = useGuest((s) => s.designSeen);
  const [types, setTypes] = useState<TypesState>({ status: 'loading' });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const shownStep = useRef<GuestStep | null>(null);

  const loadTypes = useCallback(async () => {
    setTypes({ status: 'loading' });
    const result = await guestApi<GuestBuildingTypesResponse>('public/guest/building-types');
    const next: TypesState = result.ok
      ? { status: 'ready', types: result.data.types }
      : { status: 'failed', message: result.message };
    setTypes(next);
    // The saved design and the address are read once the types are known, so `?type=` can be applied.
    hydrate(next.status === 'ready' ? next.types : null);
    // "Open" / "Continue" on the profile page (account.ts).
    applyQueuedOpen(next.status === 'ready' ? next.types : null);
  }, []);

  useEffect(() => {
    void loadTypes();
    const onPop = () => syncFromLocation();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [loadTypes]);

  /*
   * A step change moves focus to the new panel's heading and brings the panel's top into view
   * (spec "Chân khung"). Not on the first render: a page that grabs focus on load is disorienting.
   */
  useEffect(() => {
    if (!ready) return;
    if (shownStep.current !== null && shownStep.current !== step) {
      // An "Edit" link asked for one field; otherwise the new panel's heading.
      if (!focusSelector(takePendingFocus())) headingRef.current?.focus({ preventScroll: true });
      const main = mainRef.current;
      if (main !== null) {
        const bar = document.querySelector<HTMLElement>('.g-tabbar')?.offsetHeight ?? 0;
        const top = main.getBoundingClientRect().top + window.scrollY - bar;
        if (window.scrollY > top) window.scrollTo({ top });
      }
    }
    shownStep.current = step;
  }, [ready, step]);

  const typeList = types.status === 'ready' ? types.types : null;
  const type = typeList?.find((t) => t.id === design?.typeId);
  const missing = missingSteps(design, type, contact);
  const go = (s: GuestStep) => void goTo(s, type);
  /**
   * The summary bar's Send (header and phone bar): ③, unless a step before it is missing something.
   *
   * It shares `goTo`'s answer, so a locked ③ lands on ① with the field to fix focused rather than doing
   * nothing; a design that is not ready opens ② with its first failing check focused.
   */
  const send = () => {
    const target = missing[0]?.step ?? 'send';
    // `goTo` explains a refusal itself (back to ①, offending field focused), so there is no second call.
    /*
     * On ② the chip is the thing worth reaching when something needs attention; when nothing does the
     * selector matches nothing and focus stays where the frame put it (the panel heading).
     */
    if (goTo(target, type) && target === 'design') focusSelector('.g-check-chip-review');
  };

  /*
   * ① goes straight to ③ for an enquiry (Class 1 House, Q1): there is nothing to design, and ② is
   * locked for that type. The footer's Next follows the same rule.
   */
  const nextFromStart: GuestStep = needsDesign(type) ? 'design' : 'send';

  return (
    <>
      <GuestHeader />
      <StepTabs step={step} design={design} type={type} contact={contact} missing={missing} designSeen={designSeen} onActivate={go}>
        {design === null ? null : <SummaryBar design={design} type={type} step={step} onSend={send} />}
      </StepTabs>

      <main ref={mainRef} className="g-main" data-step={step}>
        <div className="g-container">
          <section
            key={step}
            id={panelId(step)}
            role="tabpanel"
            aria-labelledby={tabId(step)}
            aria-busy={!ready}
            className="g-panel"
          >
            {step === 'start' && design === null ? (
              <div className="g-hero">
                <h1>Design your shed. Get a quote by email.</h1>
                <ul className="g-hero-checks">
                  {['No sign-up', 'Design in 2D & 3D', 'Quote by email'].map((item) => (
                    <li key={item}>
                      <IconCheck />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <h2 ref={headingRef} tabIndex={-1} className="g-panel-title">
              {PANEL_TITLES[step]}
            </h2>

            {step === 'start' ? (
              <StartPanel
                types={types}
                design={design}
                contact={contact}
                onRetry={() => void loadTypes()}
                onChooseType={chooseType}
                nextStep={nextFromStart}
                onNext={(s) => go(s)}
              />
            ) : step === 'design' ? (
              <>
                <p className="g-panel-lead">{PANEL_LEADS.design}</p>
                <DesignPanel type={type} loading={types.status === 'loading'} />
              </>
            ) : (
              <SendPanel type={type} />
            )}
          </section>
        </div>
      </main>

      <StepFooter
        step={step}
        hasDesign={design !== null && design.site !== undefined && contactStarted(contact)}
        nextStep={step === 'start' ? nextFromStart : undefined}
        onGo={go}
        onStartOver={startOver}
      />
      {design === null ? null : <PhoneSummaryBar design={design} type={type} step={step} onSend={send} />}
    </>
  );
}
