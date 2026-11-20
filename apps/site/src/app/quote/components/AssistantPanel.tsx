'use client';

import { useEffect, useRef, useState } from 'react';
import type { GuestOpWire } from '@sq/contracts';
import type { GuestBuildingTypeSpec, GuestDesignInput } from '@sq/core/domain';
import { useGuest } from '../store';
import {
  applyPendingChange,
  dismissPending,
  sendToAssistant,
  undoChange,
  useAssistant,
  type AssistantTurn,
} from '../assistantStore';
import { IconChevronRight, IconList } from './icons';

/**
 * "Shed Assistant" (plan G-g S11, laid out as a column by plan guest-template-3col Task 2).
 *
 * ## What it is, and is not
 *
 * It talks to the server's `POST /public/guest/assistant/turn`, which returns text plus a **change
 * set** the server has already applied to a copy of the design. Nothing here decides what a sentence
 * means; the panel shows what came back, applies the design the server computed, and offers Undo.
 *
 * It never sends the request, never asks for the contact details and never shows a price. When the
 * assistant is off, out of quota or broken, the panel collapses to one line and the designer keeps
 * working — the rest of the page does not depend on it.
 *
 * ## One turn, one undo
 *
 * A change card lists what moved and has a single Undo, which restores the design from before the
 * whole change set — not from before the last operation in it.
 *
 * ## Where the state lives
 *
 * The thread, the pending card and the unread count are in `assistantStore.ts`, because the panel can
 * be hidden and the conversation has to survive it. What stays here is the composer's draft and the
 * log's scroll position — both meaningless once the column is gone.
 */

const OP_LABEL: Record<string, string> = {
  setSpan: 'Width',
  setHeight: 'Height',
  setPitch: 'Roof pitch',
  setRoof: 'Roof',
  setSlab: 'Slab',
  setKneeBrace: 'Knee brace',
  setCladding: 'Cladding',
  addBay: 'Add bay',
  setBayWidth: 'Bay width',
  removeBay: 'Remove bay',
  addOpening: 'Add opening',
  removeOpening: 'Remove opening',
  moveOpening: 'Move opening',
  resizeOpening: 'Resize opening',
  setColours: 'Colours',
};

/** A sentence for one operation, in the guest's words rather than the wire's. */
function describeOp(op: GuestOpWire): string {
  switch (op.op) {
    case 'setSpan':
      return `Width → ${(op.mm / 1000).toFixed(2)} m`;
    case 'setHeight':
      return `Height → ${(op.mm / 1000).toFixed(2)} m`;
    case 'setPitch':
      return `Roof pitch → ${op.degrees}°`;
    case 'setRoof':
      return `Roof → ${op.roof === 'gable' ? 'Gable' : 'Skillion'}`;
    case 'setSlab':
      return `Slab → ${op.slab.replace('_', ' ')}`;
    case 'setKneeBrace':
      return `Knee brace → ${op.kneeBrace === 'standard' ? 'Knee Brace' : 'avoid if possible'}`;
    case 'setCladding':
      return `Cladding → ${op.cladding}`;
    case 'addBay':
      return 'Added a bay';
    case 'setBayWidth':
      return `Bay ${op.index + 1} → ${(op.mm / 1000).toFixed(2)} m`;
    case 'removeBay':
      return `Removed bay ${op.index + 1}`;
    case 'addOpening':
      return `Added ${op.kind.replace('_', ' ')} on the ${op.wall} wall`;
    case 'removeOpening':
      return `Removed opening ${op.index + 1}`;
    case 'moveOpening':
      return `Moved opening ${op.index + 1} to the ${op.wall} wall`;
    case 'resizeOpening':
      return `Opening ${op.index + 1} → ${(op.size.width / 1000).toFixed(2)} × ${(op.size.height / 1000).toFixed(2)} m`;
    case 'setColours':
      return 'Changed colours';
    default:
      return OP_LABEL[op.op] ?? op.op;
  }
}

/**
 * Whether the assistant is offered at all.
 *
 * `NEXT_PUBLIC_SQ_ASSISTANT=1` is a build-time switch: with it off, the panel is not rendered and the
 * page ships none of its code paths' UI. With it on but the server's key missing, the panel appears
 * and says it is unavailable — which is the honest difference between "not offered" and "offered,
 * broken".
 */
/** Build-time switch; `?assistant=1` turns it on for one page, which is how the e2e suite reaches it. */
const ASSISTANT_BUILD_FLAG = process.env.NEXT_PUBLIC_SQ_ASSISTANT === '1';

/**
 * Whether this visit offers the assistant.
 *
 * A hook rather than a plain constant so the two callers that need the answer (the panel and the
 * stage's chips) cannot disagree: `?assistant=1` was captured by `hydrate` before the URL was
 * rewritten to `?step=…`, so reading the address here would find nothing.
 */
export function useAssistantOffered(): boolean {
  const offered = useGuest((s) => s.assistantOffered);
  return ASSISTANT_BUILD_FLAG || offered;
}

export function AssistantPanel({
  design,
  type,
  onHide,
}: {
  design: GuestDesignInput;
  type: GuestBuildingTypeSpec;
  /**
   * Collapses the column. Omitted by a caller that renders the panel with no way to hide it; the
   * hide button is then not drawn, rather than drawn and inert.
   */
  onHide?: () => void;
}) {
  return <AssistantPanelBody design={design} type={type} onHide={onHide} />;
}

function AssistantPanelBody({
  design,
  type,
  onHide,
}: {
  design: GuestDesignInput;
  type: GuestBuildingTypeSpec;
  onHide?: () => void;
}) {
  const turns = useAssistant((s) => s.turns);
  /*
   * Swipe the handle or the head down to close the sheet (phones only, where the panel is a sheet).
   * Pointer events rather than touch: one gesture works for a mouse, a finger and a stylus, and the
   * 64 px threshold is what keeps a tap on the head from closing the panel.
   */
  const dragStart = useRef<number | null>(null);
  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (typeof window === 'undefined' || window.innerWidth > 767) return;
    if ((event.target as HTMLElement).closest('.g-sheet-handle, .g-assistant-head') === null) return;
    dragStart.current = event.clientY;
  };
  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (start === null) return;
    if (event.clientY - start > 64) onHide?.();
  };
  const busy = useAssistant((s) => s.busy);
  const unavailable = useAssistant((s) => s.unavailable);
  const pending = useAssistant((s) => s.pending);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [turns, pending]);

  /*
   * Opening the column puts the cursor in the composer on a desktop, where the panel is part of the
   * page rather than a drawer over it. On a phone the soft keyboard would cover the sheet, so it does
   * not.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(min-width: 1280px)').matches) inputRef.current?.focus({ preventScroll: true });
  }, []);

  const send = () => {
    const message = text.trim();
    if (message === '' || busy) return;
    setText('');
    void sendToAssistant(message, design, type.id);
  };

  return (
    <section
      className="g-assistant"
      aria-labelledby="g-assistant-title"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {/* The sheet's grab handle; visible only where the panel is a sheet (the CSS decides). */}
      <div className="g-sheet-handle" aria-hidden="true">
        <span />
      </div>
      <div className="g-assistant-head">
        <span className="g-assistant-avatar" aria-hidden="true">
          S
        </span>
        <div className="g-assistant-headtext">
          <h2 id="g-assistant-title" className="g-assistant-name">
            Shed Assistant
            <span className="g-assistant-badge">AI</span>
          </h2>
          <p className="g-assistant-sub">With you for the whole design</p>
        </div>
        {onHide === undefined ? null : (
          <button
            type="button"
            id="g-asst-close"
            className="g-assistant-hide"
            aria-label="Hide assistant"
            aria-expanded={false}
            aria-controls="g-assistant"
            onClick={onHide}
          >
            <IconChevronRight />
          </button>
        )}
      </div>

      {unavailable ? (
        <p className="g-assistant-strip" role="status">
          The assistant is unavailable right now. The designer works as normal.
        </p>
      ) : (
        <>
          <ol ref={listRef} className="g-assistant-log" aria-live="polite">
            {turns.map((turn, i) =>
              turn.kind === 'message' ? (
                <li key={i} className={`g-msg g-msg-${turn.role}`}>
                  <p>{turn.text}</p>
                  {turn.failed === undefined ? null : (
                    <ul className="g-msg-failed">
                      {turn.failed.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ) : (
                <ChangeCard key={i} turn={turn} index={i} />
              ),
            )}

            {pending === null ? null : (
              <li className="g-msg g-msg-assistant">
                <p>{pending.text}</p>
                <div className="g-change">
                  <ul>
                    {pending.ops.map((op, k) => (
                      <li key={k}>{describeOp(op)}</li>
                    ))}
                  </ul>
                  <div className="g-change-actions">
                    <button type="button" className="g-btn g-btn-primary" onClick={applyPendingChange}>
                      Apply
                    </button>
                    <button type="button" className="g-btn g-btn-outline" onClick={dismissPending}>
                      Keep my design
                    </button>
                  </div>
                </div>
              </li>
            )}
          </ol>

          <form
            className="g-assistant-form"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <label className="g-sr-only" htmlFor="g-assistant-input">
              Message the assistant
            </label>
            <div className="g-assistant-row">
              <input
                ref={inputRef}
                id="g-assistant-input"
                className="g-input"
                type="text"
                maxLength={1000}
                placeholder="e.g. make it 9 metres wide"
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={busy}
              />
              <button type="submit" className="g-btn g-btn-primary" disabled={busy || text.trim() === ''}>
                {busy ? '…' : 'Send'}
              </button>
            </div>
            <p className="g-hint">AI can make mistakes — check the plan. It never sends your request.</p>
          </form>
        </>
      )}
    </section>
  );
}

/** One applied change set: what moved, Undo, "View on plan". */
function ChangeCard({ turn, index }: { turn: Extract<AssistantTurn, { kind: 'change' }>; index: number }) {
  return (
    <li className="g-msg g-msg-assistant">
      <p>{turn.text}</p>
      <div className="g-change" data-undone={turn.undone || undefined}>
        <ul>
          {turn.ops.map((op, k) => (
            <li key={k}>{describeOp(op)}</li>
          ))}
        </ul>
        {turn.failures.length === 0 ? null : (
          <p className="g-hint">Not done: {turn.failures.map((f) => f.reason).join(' ')}</p>
        )}
        <div className="g-change-actions">
          {turn.undone ? (
            <span className="g-hint">Undone</span>
          ) : (
            <button type="button" className="g-btn g-btn-ghost" onClick={() => undoChange(index)}>
              Undo
            </button>
          )}
          <button
            type="button"
            className="g-btn g-btn-ghost"
            onClick={() => {
              window.location.hash = '';
              document.getElementById('g-view-2d')?.click();
            }}
          >
            <IconList />
            View on plan
          </button>
        </div>
      </div>
    </li>
  );
}
