'use client';

/**
 * The "AI Assistant" dock, fixed at the bottom-right of the workspace while the assistant is closed:
 * the suggestion chips stacked above the "AI Assistant" button, right-aligned.
 *
 * The button opens the assistant, which then fills the workspace's full height; the dock is hidden
 * while it is open and the same chips appear inside the panel, above the composer. It carries the
 * **unread** count — replies that arrived while the panel was closed — because a change the assistant
 * made without the guest watching is worth saying out loud. Above nine it reads "9+", so the badge
 * cannot grow the button.
 *
 * Opening it clears the count (`markAssistantSeen`), which is what "seen" means here: the thread is on
 * screen, and the change card is in it.
 */

import { useEffect, useMemo, useState } from 'react';
import type { GuestBuildingTypeSpec, GuestDesignInput } from '@sq/core/domain';
import { markAssistantSeen, sendToAssistant, useAssistant } from '../assistantStore';
import { openAssistant } from '../panels';
import { IconChevronDown, IconSparkle } from './icons';

/** `9000` → `9`, `7500` → `7.5`: metres the way a person says them. */
const metres = (mm: number) => String(Math.round(mm / 100) / 10);

/**
 * The suggestion chips, worked out from the design on screen so each one is a next step that makes
 * sense *now*: no "add a roller door" once it has one, no "make it wider" at the type's widest, no
 * door or window chip for a type that takes none (Review Focus 3). Each is a plain sentence the
 * assistant already understands; nothing here decides what it does — the server still does.
 *
 * Most useful first, so a caller that shows only a few keeps the best ones.
 */
export function suggestionsFor(design: GuestDesignInput, type: GuestBuildingTypeSpec): string[] {
  const out: string[] = [];
  const { building, openings, colours } = design;
  const { limits, roofs } = type.config;
  const rules = type.config.openings.rules;
  const count = (kind: string) => openings.filter((o) => o.type === kind).length;
  const allows = (kind: string) => {
    const rule = rules.find((r) => r.type === kind);
    return rule !== undefined && count(kind) < rule.max;
  };

  if (allows('roller_door') && count('roller_door') === 0) out.push('Add a roller door at the front');
  if (allows('pa_door') && count('pa_door') === 0) out.push('Add a side access door');
  if (allows('window') && count('window') === 0) out.push('Add a window on the back');

  const wider = building.span + 1000;
  const narrower = building.span - 1000;
  if (wider <= limits.span.max) out.push(`Make it ${metres(wider)} metres wide`);
  else if (narrower >= limits.span.min) out.push(`Make it ${metres(narrower)} metres wide`);

  if (building.bayWidths.length < limits.bays.max) out.push('Add another bay to make it longer');

  /* A roof colour other than the one on it now, from the type's own palette. */
  const allowed = type.config.colours.allowed.filter((c) => c !== colours.roof);
  const colour = allowed.find((c) => c === 'Monument') ?? allowed.find((c) => c === 'Surfmist') ?? allowed[0];
  if (colour !== undefined) out.push(`Make the roof ${colour}`);

  if (building.roof === 'gable' && roofs.includes('skillion')) out.push('Switch to a skillion roof');
  if (building.height + 300 <= limits.height.max) out.push(`Make the walls ${metres(building.height + 300)} m high`);

  return out;
}

/**
 * The chips themselves, shared by the dock and the open panel. One click sends the sentence to the
 * assistant without opening it. Hidden while a turn is in flight (the assistant is already answering
 * one).
 */
export function AssistantSuggestions({
  design,
  type,
  className,
  limit = 3,
}: {
  design: GuestDesignInput;
  type: GuestBuildingTypeSpec;
  className: string;
  limit?: number;
}) {
  const busy = useAssistant((s) => s.busy);
  const chips = useMemo(() => suggestionsFor(design, type).slice(0, limit), [design, type, limit]);
  if (busy || chips.length === 0) return null;

  return (
    <ul className={className} aria-label="Suggestions for the AI assistant">
      {chips.map((text) => (
        <li key={text}>
          <button type="button" className="g-chip-ask" onClick={() => void sendToAssistant(text, design, type.id)}>
            {text}
          </button>
        </li>
      ))}
    </ul>
  );
}

const SUGGEST_KEY = 'sq.guest.assistant.suggestions';

function readSuggestPref(): boolean | null {
  try {
    const v = window.localStorage.getItem(SUGGEST_KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

/**
 * The suggestions inside the open panel: one slim row above the composer that the visitor can fold
 * away, so the thread keeps the height.
 *
 * Until the visitor chooses, the row is open before they have said anything and folded once they have — by then they know what to type. Their choice is remembered for this browser only
 * (localStorage, which may be blocked; the default then applies).
 */
export function PanelSuggestions({ design, type }: { design: GuestDesignInput; type: GuestBuildingTypeSpec }) {
  /* The assistant's greeting is a turn too; the conversation starts with the visitor's first line. */
  const hasThread = useAssistant((s) => s.turns.some((t) => t.kind === 'message' && t.role === 'guest'));
  const [pref, setPref] = useState<boolean | null>(null);
  useEffect(() => setPref(readSuggestPref()), []);
  const open = pref ?? !hasThread;

  const toggle = () => {
    const next = !open;
    setPref(next);
    try {
      window.localStorage.setItem(SUGGEST_KEY, next ? '1' : '0');
    } catch {
      /* Storage blocked: the choice lasts until the page reloads. */
    }
  };

  return (
    <div className="g-assistant-suggest" data-open={open || undefined}>
      <button
        type="button"
        className="g-suggest-toggle"
        aria-expanded={open}
        aria-controls="g-assistant-chips"
        aria-label={open ? 'Hide suggestions' : 'Show suggestions'}
        title={open ? 'Hide suggestions' : 'Show suggestions'}
        onClick={toggle}
      >
        <IconSparkle className="g-suggest-icon" />
        {open ? null : <span>Suggestions</span>}
        <IconChevronDown className="g-suggest-chevron" />
      </button>
      {open ? (
        <div id="g-assistant-chips" className="g-assistant-chips-wrap">
          <AssistantSuggestions design={design} type={type} className="g-assistant-chips" limit={4} />
        </div>
      ) : null}
    </div>
  );
}

export function AssistantFab({ design, type }: { design: GuestDesignInput; type: GuestBuildingTypeSpec }) {
  const unread = useAssistant((s) => s.unread);

  return (
    <div className="g-ai-dock">
      <AssistantSuggestions design={design} type={type} className="g-ai-dock-chips" />
      <button
        type="button"
        id="g-assistant-fab"
        className="g-fab"
        aria-label={unread > 0 ? `Open the AI assistant, ${unread} new` : 'Open the AI assistant'}
        aria-expanded={false}
        aria-controls="g-assistant"
        onClick={() => {
          openAssistant();
          markAssistantSeen();
        }}
      >
        <IconSparkle className="g-fab-icon" />
        <span>AI Assistant</span>
        {unread === 0 ? null : (
          <span className="g-fab-badge" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    </div>
  );
}
