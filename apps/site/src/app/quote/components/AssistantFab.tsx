'use client';

/**
 * "Ask the AI" — the button that brings the assistant back.
 *
 * Shown whenever the assistant column is closed: the right edge on a desktop, and everywhere below
 * 1280 (where the column is a drawer or a sheet). It carries the **unread** count — replies that
 * arrived while the column was closed — because a change the assistant made without the guest
 * watching is worth saying out loud. Above nine it reads "9+", so the badge cannot grow the button.
 *
 * Opening it clears the count (`markAssistantSeen`), which is what "seen" means here: the thread is on
 * screen, and the change card is in it.
 */

import { markAssistantSeen, useAssistant } from '../assistantStore';
import { openAssistant } from '../panels';

export function AssistantFab() {
  const unread = useAssistant((s) => s.unread);

  return (
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
      <span className="g-fab-ping" aria-hidden="true" />
      <span>Ask the AI</span>
      {unread === 0 ? null : (
        <span className="g-fab-badge" aria-hidden="true">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
}
