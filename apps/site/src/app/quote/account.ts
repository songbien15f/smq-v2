'use client';

/**
 * The optional Guest account on the page (spec docs/specs/guest-accounts.md).
 *
 * A small store like `store.ts`: who is signed in (`profile`), plus the two things a session changes
 * on the quote page —
 * - **step ① prefill**: once the page is ready and a profile is known, the empty contact fields take
 *   the profile's values (`prefillContact`); anything typed stays;
 * - **draft autosave**: while signed in, a design that has not been sent is saved to the account
 *   2 s after it stops changing, under the page's own uuid (`draftId`), so a save is an idempotent PUT.
 *
 * Signed out, nothing here talks to the server beyond the one `GET /public/guest/account` on load.
 */

import { useSyncExternalStore } from 'react';
import type {
  ApiResult,
  GuestDraftView,
  GuestPasswordChange,
  GuestProfilePatch,
  GuestProfileView,
  GuestSignIn,
  GuestSignUp,
} from '@sq/contracts';
import { guestApi } from './api';
import type { GuestBuildingTypeSpec, GuestDesignInput } from '@sq/core/domain';
import {
  forgetAccountState,
  guestSnapshot,
  openDraft,
  prefillContact,
  reopenSent,
  setDraftId,
  subscribeGuest,
  type GuestState,
} from './store';

export interface AccountState {
  /** `unknown` until the first `GET /public/guest/account` answers. */
  status: 'unknown' | 'signed-out' | 'signed-in';
  profile: GuestProfileView | null;
  /** The last draft save, for the "Saved to your account" line. */
  draftSave: 'idle' | 'saving' | 'saved' | 'failed';
}

let account: AccountState = { status: 'unknown', profile: null, draftSave: 'idle' };
const listeners = new Set<() => void>();

function setAccount(patch: Partial<AccountState>): void {
  account = { ...account, ...patch };
  for (const listener of listeners) listener();
}

export function useGuestAccount<T>(select: (s: AccountState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => select(account),
    () => select(SERVER_ACCOUNT),
  );
}
const SERVER_ACCOUNT: AccountState = { status: 'unknown', profile: null, draftSave: 'idle' };

// ---------------------------------------------------------------- session

function signedIn(profile: GuestProfileView): void {
  setAccount({ status: 'signed-in', profile });
  tryPrefill();
}

/** A 401 from any account route: the session is gone (signed out elsewhere, or expired). */
function lostSession<T>(result: ApiResult<T>): ApiResult<T> {
  if (!result.ok && result.code === 'unauthorized' && account.status === 'signed-in') {
    setAccount({ status: 'signed-out', profile: null, draftSave: 'idle' });
    prefilledFor = null;
  }
  return result;
}

export async function refreshAccount(): Promise<void> {
  const result = await guestApi<GuestProfileView>('public/guest/account');
  if (result.ok) signedIn(result.data);
  else if (result.code === 'unauthorized') setAccount({ status: 'signed-out', profile: null });
  // Any other failure (offline, 5xx): stay as we were; the page works without an account.
  else if (account.status === 'unknown') setAccount({ status: 'signed-out' });
}

export async function signIn(body: GuestSignIn): Promise<ApiResult<GuestProfileView>> {
  const result = await guestApi<GuestProfileView>('public/guest/account/sign-in', { method: 'POST', body });
  if (result.ok) {
    signedIn(result.data);
    saveDraftNow();
  }
  return result;
}

export async function signUp(body: GuestSignUp): Promise<ApiResult<GuestProfileView>> {
  const result = await guestApi<GuestProfileView>('public/guest/account/sign-up', { method: 'POST', body });
  if (result.ok) {
    signedIn(result.data);
    saveDraftNow();
  }
  return result;
}

export async function signOut(): Promise<void> {
  cancelPendingSave();
  await guestApi('public/guest/account/sign-out', { method: 'POST' });
  setAccount({ status: 'signed-out', profile: null, draftSave: 'idle' });
  prefilledFor = null;
  lastSavedKey = null;
  // A shared computer: the next person must not find the last one's details on ①.
  forgetAccountState();
}

export async function updateProfile(body: GuestProfilePatch): Promise<ApiResult<GuestProfileView>> {
  const result = lostSession(await guestApi<GuestProfileView>('public/guest/account', { method: 'PATCH', body }));
  if (result.ok) setAccount({ profile: result.data });
  return result;
}

export async function changePassword(body: GuestPasswordChange): Promise<ApiResult<{ changed: true }>> {
  return lostSession(await guestApi<{ changed: true }>('public/guest/account/password', { method: 'POST', body }));
}

/** For the profile page: the same 401 handling as every other account call. */
export async function accountGet<T>(path: string): Promise<ApiResult<T>> {
  return lostSession(await guestApi<T>(`public/guest/account/${path}`));
}

export async function deleteDraft(id: string): Promise<ApiResult<{ deleted: true }>> {
  const result = lostSession(
    await guestApi<{ deleted: true }>(`public/guest/account/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  );
  // The design on screen was that draft: it is unsaved work again, saved under a new id when edited.
  // Not re-saved until it changes again (otherwise the autosave would bring it straight back).
  if (result.ok && guestSnapshot().draftId === id) {
    lastSavedKey = `|${JSON.stringify(draftBody(guestSnapshot()))}`;
    setDraftId(null);
  }
  return result;
}

// ---------------------------------------------------------------- step ① prefill

/** The profile id whose details were last offered to ①, so a field the guest clears stays clear. */
let prefilledFor: string | null = null;

function tryPrefill(): void {
  const profile = account.profile;
  if (profile === null || !guestSnapshot().ready || prefilledFor === profile.id) return;
  prefilledFor = profile.id;
  prefillContact(profile);
}

// ---------------------------------------------------------------- draft autosave

const SAVE_DELAY_MS = 2000;
let timer: ReturnType<typeof setTimeout> | null = null;
/** What the server last accepted, so an unrelated store change (a hover, a contact field) saves nothing. */
let lastSavedKey: string | null = null;

function draftBody(s: GuestState) {
  return {
    design: s.design,
    step: s.step,
    ...(Object.keys(s.source).length === 0 ? {} : { source: s.source }),
    revisionOf: s.revisionOf,
  };
}

function saveable(s: GuestState): boolean {
  return account.status === 'signed-in' && s.ready && s.design !== null && s.sent === null;
}

/** Sending: a save still waiting must not recreate the draft the server is about to delete. */
export function cancelDraftSave(): void {
  cancelPendingSave();
}

function cancelPendingSave(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function scheduleSave(): void {
  const s = guestSnapshot();
  if (!saveable(s)) return;
  const key = `${s.draftId ?? ''}|${JSON.stringify(draftBody(s))}`;
  if (key === lastSavedKey) return;
  cancelPendingSave();
  timer = setTimeout(() => void saveDraft(), SAVE_DELAY_MS);
}

function saveDraftNow(): void {
  cancelPendingSave();
  void saveDraft();
}

async function saveDraft(retried = false): Promise<void> {
  timer = null;
  const s = guestSnapshot();
  if (!saveable(s)) return;
  let id = s.draftId;
  if (id === null) {
    id = crypto.randomUUID();
    setDraftId(id);
  }
  const body = draftBody(s);
  if (`${id}|${JSON.stringify(body)}` === lastSavedKey) return;
  setAccount({ draftSave: 'saving' });
  const result = lostSession(
    await guestApi<GuestDraftView>(`public/guest/account/drafts/${id}`, { method: 'PUT', body }),
  );
  if (result.ok) {
    lastSavedKey = `${id}|${JSON.stringify(body)}`;
    setAccount({ draftSave: 'saved' });
    // Changed again while the save was in flight: save the newer one too.
    scheduleSave();
    return;
  }
  // The id belongs to another account (a draft id left in this browser's storage): start a new one.
  if (result.code === 'not_found' && !retried && guestSnapshot().draftId === id) {
    setDraftId(null);
    await saveDraft(true);
    return;
  }
  setAccount({ draftSave: account.status === 'signed-in' ? 'failed' : 'idle' });
}

let started = false;

/** Called once by the quote page: learn who is signed in, then watch the design. */
export function startGuestAccount(): void {
  if (started) return;
  started = true;
  void refreshAccount();
  subscribeGuest(() => {
    tryPrefill();
    scheduleSave();
  });
}

// ---------------------------------------------------------------- opening from the profile page

/**
 * The profile page (`/quote/account`) does not run the editor, so "Open" / "Continue" leaves what to
 * open in sessionStorage and goes to `/quote`, which applies it once its types are loaded
 * (`applyQueuedOpen`). A design only — the same kind of data the page already keeps in storage.
 */
const QUEUE_KEY = 'sq-guest-open';

export type QueuedOpen =
  | { kind: 'draft'; draft: GuestDraftView }
  | { kind: 'sent'; number: string; design: GuestDesignInput };

export function openOnQuotePage(item: QueuedOpen): void {
  try {
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(item));
  } catch {
    // Storage blocked: the quote page opens on what it had.
  }
  window.location.assign('/quote');
}

export function applyQueuedOpen(types: readonly GuestBuildingTypeSpec[] | null): void {
  let item: QueuedOpen | null = null;
  try {
    const raw = sessionStorage.getItem(QUEUE_KEY);
    sessionStorage.removeItem(QUEUE_KEY);
    item = raw === null ? null : (JSON.parse(raw) as QueuedOpen);
  } catch {
    return;
  }
  if (item === null || types === null) return;
  const design = item.kind === 'draft' ? item.draft.design : item.design;
  const type = types.find((t) => t.id === design.typeId);
  if (type === undefined) return;
  if (item.kind === 'draft') {
    openDraft({ ...item.draft, design: item.draft.design as GuestDesignInput }, type);
    // Already on the server as it is: nothing to save until it changes.
    lastSavedKey = `${item.draft.id}|${JSON.stringify(draftBody(guestSnapshot()))}`;
  } else {
    reopenSent(item.number, item.design, type);
  }
}
