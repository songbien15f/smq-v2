'use client';

/**
 * The Assistant, as a panel: header, conversation, suggestions, composer, footer.
 *
 * ## This is the frame, not the assistant
 *
 * Nothing here talks to a model yet (`connected` is false), so the conversation is empty, the suggestions
 * are inert and the composer is disabled with a banner that says why. A disabled composer with a visible
 * reason is the spec's "unavailable" state, and it is the honest one: a box that accepted text and
 * answered nothing would be worse than a box that says it is not there yet. Everything the spec fixes
 * about behaviour is already in place so wiring it up later changes data, not markup: Enter sends,
 * Shift+Enter breaks the line, Enter during an IME composition (`isComposing` / key 229) does neither,
 * the thread is a polite live log, every icon button has a name and a 44 px target.
 */

import { useState } from 'react';
import { ChevronIcon, CloseIcon, MicIcon, SendIcon, SparkleIcon } from '@sq/ui';
import type { EditorStep } from '../StepRail';

/** At most three per step (spec): more is a menu, not a nudge. */
const SUGGESTIONS: Record<EditorStep, readonly string[]> = {
  details: ['Fill in the customer details', 'Check the site address', 'Suggest a shed size'],
  options: ['Add a roller door', 'Add a personnel door', 'Change the colours'],
  cost: ['Explain the price', 'Compare with the last revision', 'What is missing before I send?'],
};

interface AssistantPanelProps {
  step: EditorStep;
  /** False until a model is wired in: the composer is disabled and a banner says so. */
  connected?: boolean;
  /** `xl` column: collapse to the rail. */
  onCollapse?: () => void;
  /** Drawer / sheet: close it. */
  onClose?: () => void;
  /** Id of the heading. */
  headingId?: string;
}

const ICON_BUTTON =
  'grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-md text-sq-ink-muted transition-colors duration-sq-fast hover:bg-sq-ground hover:text-sq-ink disabled:cursor-not-allowed disabled:opacity-55';

export function AssistantPanel({ step, connected = false, onCollapse, onClose, headingId = 'assistant-heading' }: AssistantPanelProps) {
  const [draft, setDraft] = useState('');
  const suggestions = SUGGESTIONS[step];

  const send = () => {
    if (!connected || draft.trim() === '') return;
    // Wiring point: hand `draft` to the conversation, then clear it.
    setDraft('');
  };

  return (
    <section aria-labelledby={headingId} className="flex h-full min-h-0 flex-col bg-sq-surface">
      <header className="flex items-center gap-sq-2 border-b border-sq-line px-sq-3 py-sq-1">
        <SparkleIcon size={18} className="shrink-0 text-sq-gold-deep" />
        <h2 id={headingId} className="text-sq-body font-semibold text-sq-ink">
          Assistant
        </h2>
        <span className="rounded-full bg-sq-brand px-1.5 py-0.5 text-sq-micro font-semibold leading-none text-white">AI</span>
        <span className="flex-1" />
        {onCollapse !== undefined && (
          <button type="button" onClick={onCollapse} aria-label="Collapse assistant" className={ICON_BUTTON}>
            <ChevronIcon direction="right" size={18} />
          </button>
        )}
        {onClose !== undefined && (
          <button type="button" onClick={onClose} aria-label="Close assistant" className={ICON_BUTTON}>
            <CloseIcon size={18} />
          </button>
        )}
      </header>

      {!connected && (
        <p role="status" className="border-b border-sq-line bg-sq-ground px-sq-3 py-sq-2 text-sq-micro text-sq-ink-muted">
          The assistant is not connected yet. You can keep working; the price stays on screen.
        </p>
      )}

      <div role="log" aria-live="polite" aria-label="Conversation" className="min-h-0 flex-1 overflow-y-auto px-sq-3 py-sq-3">
        <p className="text-sq-body text-sq-ink-muted">
          Ask me to fill in or change this quote, or to explain the price. I will tell you what I changed so you can check it.
        </p>
      </div>

      <div className="flex flex-wrap gap-sq-1 px-sq-3 pb-sq-2">
        {suggestions.map((text) => (
          <button
            key={text}
            type="button"
            disabled={!connected}
            onClick={() => setDraft(text)}
            className="min-h-11 cursor-pointer rounded-full border border-sq-line px-sq-2 text-sq-micro font-medium text-sq-ink transition-colors duration-sq-fast hover:bg-sq-ground disabled:cursor-not-allowed disabled:opacity-55"
          >
            {text}
          </button>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className="flex items-end gap-sq-1 border-t border-sq-line px-sq-3 py-sq-2"
      >
        <label htmlFor="assistant-input" className="sr-only">
          Message to the assistant
        </label>
        <textarea
          id="assistant-input"
          value={draft}
          disabled={!connected}
          rows={2}
          placeholder="Ask the assistant"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter confirms a candidate while an IME is composing (key 229): it must not send.
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            send();
          }}
          className="min-h-11 min-w-0 flex-1 resize-none rounded-md border border-sq-line bg-sq-surface px-sq-2 py-sq-1 text-sq-body text-sq-ink disabled:cursor-not-allowed disabled:bg-sq-ground"
        />
        <button type="button" disabled={!connected} aria-label="Dictate a message" className={ICON_BUTTON}>
          <MicIcon size={18} />
        </button>
        <button
          type="submit"
          disabled={!connected || draft.trim() === ''}
          aria-label="Send message"
          className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-md bg-sq-brand text-white transition-colors duration-sq-fast hover:bg-sq-brand-hover disabled:cursor-not-allowed disabled:opacity-55"
        >
          <SendIcon size={18} />
        </button>
      </form>

      <p className="px-sq-3 pb-sq-2 text-sq-micro text-sq-ink-muted">AI can make mistakes. Check the price before sending.</p>
    </section>
  );
}
