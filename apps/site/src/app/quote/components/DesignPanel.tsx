'use client';

import { useEffect, useMemo } from 'react';
import { validateGuestDesign, type GuestBuildingTypeSpec } from '@sq/core/domain';
import { useGuest } from '../store';
import { closeAssistant, closeTools, handleEscape, openTools, usePanels, watchBreakpoint } from '../panels';
import { setAssistantVisible, useAssistant } from '../assistantStore';
import { ControlAccordion } from './ControlAccordion';
import { DesignCheck } from './DesignCheck';
import { AssistantFab } from './AssistantFab';
import { AssistantPanel, useAssistantOffered } from './AssistantPanel';
import { Stage } from './Stage';
import { ToolsRail } from './ToolsRail';
import { IconChevronLeft } from './icons';

/**
 * Tab ③: the design workspace — tools on the left, the 2D/3D stage in the middle, the assistant on the
 * right (plan guest-template-3col).
 *
 * ## One grid, three attributes
 *
 * `data-bp` says which layout applies and `data-left` / `data-right` say which panels are open. The CSS
 * reads those; nothing here measures the window. Above 1280 a closed tools column becomes a 48 px rail
 * and a closed assistant disappears; at 1024–1279 the assistant is a drawer; below 1024 both are
 * drawers, and below 768 the assistant is a bottom sheet.
 *
 * ## The panels are hidden, not unmounted
 *
 * The thread lives in `assistantStore`, so unmounting would not lose it — but keeping the panel mounted
 * makes a hide and a show instant, cannot race a reply in flight, and keeps the composer's draft. A
 * closed off-canvas panel gets `inert`, so the keyboard cannot reach what a person cannot see.
 *
 * ## No assistant, no furniture
 *
 * Without the assistant (build flag off and no `?assistant=1`) there is no third column, no FAB, no
 * "AI Assistant" button and no stage chips: the grid is tools | stage, as it was before this plan.
 */
export function DesignPanel({ type, loading }: { type: GuestBuildingTypeSpec | undefined; loading: boolean }) {
  const design = useGuest((s) => s.design);
  const issues = useMemo(
    () => (design === null || type === undefined ? [] : validateGuestDesign(design, type)),
    [design, type],
  );

  const bp = usePanels((s) => s.bp);
  const leftOpen = usePanels((s) => s.leftOpen);
  const rightOpen = usePanels((s) => s.rightOpen);
  const assistant = useAssistantOffered();
  const pending = useAssistant((s) => s.pending);
  const unread = useAssistant((s) => s.unread);

  // Correct the server's desktop guess, and reset both flags when the breakpoint changes (D4).
  useEffect(() => watchBreakpoint(), []);

  // The store counts a reply that lands while the column is closed; this is how it knows.
  useEffect(() => setAssistantVisible(rightOpen), [rightOpen]);

  // Escape closes the assistant everywhere, and the tools drawer where it is one (phone).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (design === null) return null;
  if (type === undefined) {
    return (
      <p className="g-panel-lead" role="status">
        {loading ? 'Loading your building type…' : 'This building type is no longer offered. Choose another on step 1.'}
      </p>
    );
  }

  const showAssistant = assistant;
  /* Below 1280 the assistant is off-canvas, so a closed one is inert rather than merely invisible. */
  const assistantOffCanvas = bp !== 'desktop';
  /* Tools are a column down to 1024 and a drawer below it. */
  const toolsOffCanvas = bp === 'phone';

  return (
    <div
      className="g-design"
      data-bp={bp}
      data-left={leftOpen ? 'open' : 'closed'}
      data-right={showAssistant && rightOpen ? 'open' : 'closed'}
      data-assistant={showAssistant ? 'yes' : 'no'}
    >
      {/* One scrim per off-canvas panel: above the page, below the panel. */}
      {assistantOffCanvas && rightOpen ? (
        <button type="button" className="g-scrim" aria-label="Close the assistant" onClick={() => closeAssistant()} />
      ) : null}
      {toolsOffCanvas && leftOpen ? (
        <button type="button" className="g-scrim" aria-label="Close the tools" onClick={() => closeTools()} />
      ) : null}

      <section id="g-tools" className="g-design-controls" aria-labelledby="g-tools-title">
        <div className="g-controls-head">
          <h2 id="g-tools-title" className="g-controls-title">
            Your design
          </h2>
          <button
            type="button"
            id="g-left-toggle"
            className="g-icon-btn"
            aria-label={leftOpen ? 'Hide tools panel' : 'Show tools panel'}
            aria-expanded={leftOpen}
            aria-controls="g-tools"
            onClick={() => (leftOpen ? closeTools() : openTools())}
          >
            <IconChevronLeft />
          </button>
        </div>
        <div className="g-controls-body">
          <ControlAccordion design={design} type={type} issues={issues} />
          <DesignCheck design={design} type={type} />
        </div>
        {/* Shown only while collapsed on a desktop; the CSS decides, `data-left` drives it. */}
        <ToolsRail />
      </section>

      <div className="g-design-stage">
        <Stage design={design} type={type} />
      </div>

      {showAssistant ? (
        <aside
          id="g-assistant"
          className="g-design-assistant"
          aria-labelledby="g-assistant-title"
          inert={assistantOffCanvas && !rightOpen ? true : undefined}
        >
          <AssistantPanel design={design} type={type} onHide={closeAssistant} />
        </aside>
      ) : null}

      {showAssistant && !rightOpen ? <AssistantFab /> : null}

      {/*
        The unread count and a pending confirmation, for whatever else needs them. Hidden, so they are
        data rather than text; the FAB reads the store directly.
      */}
      <span hidden data-assistant-unread={unread} data-assistant-pending={pending === null ? 'no' : 'yes'} />
    </div>
  );
}
