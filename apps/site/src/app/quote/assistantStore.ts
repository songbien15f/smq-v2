'use client';

/**
 * The Guest assistant's conversation, lifted out of the panel.
 *
 * ## Why this is a store and not component state
 *
 * The panel can now be **hidden** — collapsed on a desktop, closed behind a drawer on a tablet, a
 * bottom sheet on a phone — while the page keeps working. Thread state inside the component would go
 * with it the moment it unmounted, and a reply that lands while the assistant is closed would be lost
 * with it. So the thread, the composer's send, the pending confirmation and the unread count live here,
 * written with the same hand-rolled `useSyncExternalStore` pattern as `store.ts`.
 *
 * The panel is **hidden, not unmounted** (see `DesignPanel`), and this store is the second reason: a
 * `hidden`/`inert` parent keeps the thread in the DOM, so a hide and a show are instant and cannot race
 * a reply.
 *
 * ## Nothing here decides what a sentence means
 *
 * A turn goes to `POST /public/guest/assistant/turn`, which answers text plus a **change set** the
 * server has already applied to a copy of the design. This module applies the design that came back and
 * offers Undo; it never interprets the guest's words.
 *
 * ## One turn, one undo
 *
 * `undoChange` restores the design from before the whole change set, not from before its last
 * operation. That is `store.ts`'s `undoDesign`, which every other edit also uses.
 */

import { useSyncExternalStore } from 'react';
import type {
  GuestAssistantMessage,
  GuestAssistantTranscribeResponse,
  GuestAssistantTurnResponse,
  GuestOpWire,
} from '@sq/contracts';
import type { GuestDesignInput } from '@sq/core/domain';
import { guestApi } from './api';
import { applyAssistantDesign, undoDesign } from './store';

export type AssistantTurn =
  | { kind: 'message'; role: 'guest' | 'assistant'; text: string; failed?: string[] }
  | { kind: 'change'; text: string; ops: GuestOpWire[]; failures: AssistantFailure[]; undone: boolean };

export interface AssistantFailure {
  index: number;
  reason: string;
}

/** A change set the assistant proposed that is big enough to ask about before applying (Q, spec G-g). */
export interface AssistantPending {
  design: GuestDesignInput;
  ops: GuestOpWire[];
  text: string;
  failures: AssistantFailure[];
}

export interface AssistantState {
  turns: AssistantTurn[];
  busy: boolean;
  /** The server has no key or is out of quota: one strip, and the designer carries on. */
  unavailable: boolean;
  pending: AssistantPending | null;
  /** Replies that landed while the panel was closed. The FAB shows it; opening the panel clears it. */
  unread: number;
  /** Whether the panel is currently open. Set by `DesignPanel` from the panel state. */
  visible: boolean;
  /**
   * Voice is switched off on the server, out of its daily budget, or there is no key. The composer
   * hides the mic for the rest of the visit rather than offering a button that cannot work.
   */
  voiceUnavailable: boolean;
}

const GREETING: AssistantTurn = {
  kind: 'message',
  role: 'assistant',
  text: 'Tell me what you are building and I will set it up. For example: "6 by 9 garage with two roller doors at the front".',
};

const INITIAL: AssistantState = {
  turns: [GREETING],
  busy: false,
  unavailable: false,
  pending: null,
  unread: 0,
  visible: true,
  voiceUnavailable: false,
};

let state: AssistantState = INITIAL;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function set(patch: Partial<AssistantState>): void {
  state = { ...state, ...patch };
  emit();
}

function addTurn(turn: AssistantTurn): void {
  const turns = [...state.turns, turn];
  // A reply that arrives while the panel is closed is still applied (a change card) but also counted,
  // so the FAB can say something happened. Messages only count when they are the assistant's.
  const counts = !state.visible;
  set({ turns, ...(counts ? { unread: state.unread + 1 } : {}) });
}

/** Read the store from a component; re-renders when the picked slice changes. */
export function useAssistant<T>(select: (s: AssistantState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => select(state),
    () => select(INITIAL),
  );
}

/** The panel says whether it is open, so a reply that lands while closed can be counted. */
export function setAssistantVisible(visible: boolean): void {
  if (state.visible === visible) return;
  set({ visible });
}

/** Opening the panel clears the badge. Called by whatever opens it (FAB, toolbar, rail). */
export function markAssistantSeen(): void {
  if (state.unread === 0) return;
  set({ unread: 0 });
}

/**
 * Send one sentence. The design and type are passed in rather than read from a store, because the
 * caller is the one that knows which building is on screen (the panel and the stage chips both send).
 */
export async function sendToAssistant(
  message: string,
  design: GuestDesignInput,
  typeId: string,
): Promise<void> {
  const text = message.trim();
  if (text === '' || state.busy) return;

  const history: GuestAssistantMessage[] = state.turns
    .filter((t): t is Extract<AssistantTurn, { kind: 'message' }> => t.kind === 'message')
    .slice(-8)
    .map((t) => ({ role: t.role, text: t.text }));

  set({ busy: true });
  addTurn({ kind: 'message', role: 'guest', text });

  const result = await guestApi<GuestAssistantTurnResponse>('public/guest/assistant/turn', {
    method: 'POST',
    body: { message: text, design, typeId, history },
  });

  set({ busy: false });

  if (!result.ok) {
    if (result.code === 'not_configured') {
      set({ unavailable: true });
      return;
    }
    addTurn({ kind: 'message', role: 'assistant', text: result.message });
    return;
  }

  const reply = result.data;
  if (reply.needsConfirm && reply.ops.length > 0) {
    /*
     * Ask first, apply nothing yet. This is the one case where a reply while the panel is closed does
     * **not** touch the design: the pending card waits, and only `applyPendingChange` — a person's
     * click — applies it. The unread count still rises, so the FAB says a question is waiting.
     */
    set({
      pending: {
        design: reply.design as GuestDesignInput,
        ops: reply.ops,
        text: reply.message,
        failures: reply.failures,
      },
      ...(state.visible ? {} : { unread: state.unread + 1 }),
    });
    return;
  }

  if (reply.ops.length > 0) {
    applyAssistantDesign(reply.design as GuestDesignInput);
    addTurn({ kind: 'change', text: reply.message, ops: reply.ops, failures: reply.failures, undone: false });
  } else {
    addTurn({
      kind: 'message',
      role: 'assistant',
      text: reply.message,
      ...(reply.failures.length > 0 ? { failed: reply.failures.map((f) => f.reason) } : {}),
    });
  }
}

/** Apply the confirmation card's change set: one undo step for the whole set. */
export function applyPendingChange(): void {
  const pending = state.pending;
  if (pending === null) return;
  applyAssistantDesign(pending.design);
  set({
    turns: [
      ...state.turns,
      { kind: 'change', text: pending.text, ops: pending.ops, failures: pending.failures, undone: false },
    ],
    pending: null,
  });
}

/** "Keep my design": drop the proposed change, apply nothing. */
export function dismissPending(): void {
  if (state.pending === null) return;
  set({ pending: null });
}

/** Undo the change at `index` and mark that card undone. One click per change set. */
export function undoChange(index: number): void {
  if (!undoDesign()) return;
  set({
    turns: state.turns.map((turn, i) =>
      i === index && turn.kind === 'change' ? { ...turn, undone: true } : turn,
    ),
  });
}


/* ---------------------------------------------------------------- voice (STT, plan 2026-11-22) */

/** A blob as base64 without its `data:...;base64,` header — what the route expects. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the recording.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Turn one recording into text. Returns `null` when there is nothing usable to put in the composer.
 *
 * The sentence is **not sent**: the caller puts it in the input for the visitor to read and edit. This
 * is why the failure cases are quiet — a tap that was too short, a gateway that heard nothing, or voice
 * being switched off all end as `null`, and the composer says what to do instead.
 *
 * `unavailable` from the server is sticky for the visit: the mic would fail the same way every time, so
 * the composer stops offering it.
 */
/**
 * Whether the server has told us voice is off this visit.
 *
 * Read straight from the store rather than through a hook: the transcript callback is async and closes
 * over the values from the render that registered it, so it needs the answer *now*, not then.
 */
export function isVoiceUnavailable(): boolean {
  return state.voiceUnavailable;
}

export async function transcribeVoice(
  blob: Blob,
  mimeType: string,
  durationMs: number,
  typeId: string,
): Promise<{ text: string; onTopic: boolean } | null> {
  let audio: string;
  try {
    audio = await blobToBase64(blob);
  } catch {
    return null;
  }

  const result = await guestApi<GuestAssistantTranscribeResponse>('public/guest/assistant/transcribe', {
    method: 'POST',
    body: { audio, mimeType, durationMs, typeId },
  });

  if (!result.ok) return null;
  if (result.data.unavailable === true) {
    set({ voiceUnavailable: true });
    return null;
  }
  return { text: result.data.text, onTopic: result.data.onTopic };
}
