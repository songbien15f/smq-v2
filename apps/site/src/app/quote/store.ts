'use client';

/**
 * The Guest page's state: the design, the open step, and where the visitor came from.
 *
 * A small external store rather than React state, so the plan, the summary bar and the controls can
 * read and change one design without threading props through the frame. No library:
 * `useSyncExternalStore` is enough, and the site has no state dependency to add.
 *
 * ## Three steps (plan G-a2 §S3, Q2)
 *
 * ① **Start** — building type, address, contact details and the free-text request in one place.
 * ② **Design** — size, roof, pitch, slab, bracing, cladding and the bays.
 * ③ **Send** — a summary and the button.
 *
 * v1 had four steps (type, address, design, send) with the contact form at ④. The customer asked for
 * the contact details at the start (reversing D-T4), so ① and ② merged and the contact form moved
 * down. `?step=type` and `?step=address` from a link or a returning visitor both open ①.
 *
 * ## What is saved, and what is not
 *
 * The **design**, the step, the campaign source and `revisionOf` go to `localStorage` — the spec's
 * "saved on this device". The **contact details do not**: a name, mobile and email left in a shared
 * browser's storage is a leak, and the customer's own answer was that they are asked at ① and stay on
 * the page (Q2). A reload therefore loses the contact fields and keeps everything else; the form says
 * so under itself.
 *
 * Every write is inside try/catch — a private window, a full quota or blocked site data throws, and
 * the page must still work, just without remembering. What comes back is read through
 * `upgradeGuestDesign` (a v1 document is upgraded) and then checked with the same zod schema the API
 * uses, so a stale or hand-edited value is dropped instead of crashing a step later.
 *
 * Nothing here is sent anywhere. The design leaves the browser only when the guest presses Send.
 */

import { useSyncExternalStore } from 'react';
import { guestDesignSchema, guestSourceSchema, normaliseAuMobile } from '@sq/contracts';
import type { GuestBuildingTypeSpec, GuestDesignInput } from '@sq/core/domain';
import { guestDesignFromType, refitGuestOpenings, upgradeGuestDesign, type GuestSite, type GuestWindRegion } from '@sq/core/domain';

export const STEPS = ['start', 'design', 'send'] as const;
export type GuestStep = (typeof STEPS)[number];

export interface GuestState {
  design: GuestDesignInput | null;
  step: GuestStep;
  /** `utm_*` from the link the visitor arrived by; sent with the request (plan G-a P16). */
  source: GuestSource;
  /** False until the saved state and the address have been read in the browser. */
  ready: boolean;
  /**
   * The number of the request this design was last sent as, after "Keep designing": the next send is
   * a new lead noted "Revised design of GR-…". Saved with the design; cleared by Start over.
   */
  revisionOf: string | null;
  /** The contact fields and the free-text request. In memory only — never written to storage. */
  contact: ContactDraft;
  /**
   * Whether this visit offered the assistant (`?assistant=1`), captured while the address still had
   * the query. Build-time `NEXT_PUBLIC_SQ_ASSISTANT` can turn it on for everyone.
   */
  assistantOffered: boolean;
  /**
   * The type a saved draft pointed at when it is no longer offered, or `null`.
   *
   * Set once by `hydrate` when the draft was dropped (the vendor switched the type off). The page shows
   * one sentence explaining why the design is gone; it is not an error, and it clears as soon as the
   * visitor picks a type.
   */
  droppedType: string | null;
  /**
   * The wind region the address lookup estimated, or `null` when it could not place the address.
   *
   * In memory only, like the contact fields: it is a display value, and the server recomputes its own
   * copy at send time (plan §3.3). Kept here so the "Design check" card on step ② can talk about the
   * same region step ① showed.
   */
  estimate: GuestWindRegion | null;
  /**
   * The last few designs, newest last, so "Undo" can step back.
   *
   * Small on purpose (20): this exists for the assistant's change cards and for Ctrl+Z on the plan,
   * not as a document history. It is in memory only — a reload is not something to undo.
   */
  undo: GuestDesignInput[];
  /** The confirmation on ③, until "Keep designing" or "Start a new design". In memory only. */
  sent: { number: string; designKey: string } | null;
  /**
   * Whether the visitor has opened ② for this design. ② may only show its green check after that:
   * every type's default design is already valid, so "nothing missing" alone ticked ② the moment a
   * type was picked on ① (seen 2026-11-20). Saved with the design; a new type or Start over clears it.
   */
  designSeen: boolean;
  /**
   * The signed-in guest's server draft this design is saved as (docs/specs/guest-accounts.md), or
   * `null`. A uuid the page generates, saved with the design; `account.ts` does the saving.
   */
  draftId: string | null;
}

export interface ContactDraft {
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
  /**
   * The free-text request ("Additional Request" on ①). Asked once, at ①, and shown again on ③ so it
   * can be edited without going back. One state, not two fields.
   */
  additionalRequest: string;
  consent: boolean;
  /** The honeypot. A person never sees it; a script that fills every field does. */
  website: string;
}

export const EMPTY_CONTACT: ContactDraft = {
  firstName: '',
  lastName: '',
  mobile: '',
  email: '',
  additionalRequest: '',
  consent: false,
  website: '',
};

/**
 * What the contact form needs before the later steps open.
 *
 * Deliberately permissive about formats the server also checks (`normaliseAuMobile`, `z.email`): the
 * point here is only "has the guest told us who they are", so a mistyped digit does not lock the
 * designer. The server refuses a real mistake with a message on the field.
 */
export function contactStarted(contact: ContactDraft): boolean {
  return (
    contact.firstName.trim() !== '' &&
    contact.lastName.trim() !== '' &&
    contact.email.trim() !== '' &&
    contact.mobile.trim() !== ''
  );
}

/** Full validity, for the Send button and the step locks. */
export function contactValid(contact: ContactDraft): boolean {
  return (
    contact.firstName.trim() !== '' &&
    contact.lastName.trim() !== '' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact.email.trim()) &&
    normaliseAuMobile(contact.mobile) !== null
  );
}

const STORAGE_KEY = 'sq.guest.v1';
/** The saved blob's own version, distinct from the design's `v`. */
const STORAGE_VERSION = 2;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
/** The same shape as the API's `guestSourceSchema`; checked with it when read back. */
export type GuestSource = Partial<Record<(typeof UTM_KEYS)[number], string>>;

const SERVER_STATE: GuestState = {
  design: null,
  step: 'start',
  source: {},
  ready: false,
  revisionOf: null,
  contact: EMPTY_CONTACT,
  assistantOffered: false,
  droppedType: null,
  estimate: null,
  undo: [],
  sent: null,
  designSeen: false,
  draftId: null,
};

let state: GuestState = SERVER_STATE;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: STORAGE_VERSION,
        design: state.design,
        step: state.step,
        source: state.source,
        revisionOf: state.revisionOf,
        designSeen: state.designSeen,
        draftId: state.draftId,
      }),
    );
  } catch {
    // Storage is unavailable (private window, quota, blocked). The page works without it.
  }
}

function set(patch: Partial<GuestState>): void {
  state = { ...state, ...patch };
  // Every way into ② (tab, Next, Back/Forward) ends here, so this is the one place to note it.
  if (state.step === 'design' && state.design !== null && !state.designSeen) state = { ...state, designSeen: true };
  if (state.ready) persist();
  emit();
}

export function isStep(value: unknown): value is GuestStep {
  return typeof value === 'string' && (STEPS as readonly string[]).includes(value);
}

/**
 * ②③ stay locked until ① is answered: a building type, an address, and contact details.
 *
 * A `mode: 'enquiry'` type (Class 1 House) has nothing to design, so ② is never opened for it and ①
 * goes straight to ③ (plan §S3 step 2, Q1).
 */
export function stepLocked(step: GuestStep, design: GuestDesignInput | null, type: GuestBuildingTypeSpec | undefined, contact: ContactDraft): boolean {
  if (step === 'start') return false;
  if (design === null || design.site === undefined) return true;
  if (!contactStarted(contact)) return true;
  if (step === 'design' && type?.config.mode === 'enquiry') return true;
  return false;
}

/** The step that may actually open: a locked one falls back to ①. */
function allowedStep(
  step: GuestStep,
  design: GuestDesignInput | null,
  type: GuestBuildingTypeSpec | undefined,
  contact: ContactDraft,
): GuestStep {
  return stepLocked(step, design, type, contact) ? 'start' : step;
}

interface Saved {
  design: GuestDesignInput | null;
  step: GuestStep | null;
  source: GuestSource;
  revisionOf: string | null;
  designSeen: boolean;
  draftId: string | null;
}

const DRAFT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?step=` values from v1 that now mean ①. */
const LEGACY_STEPS: Record<string, GuestStep> = { type: 'start', address: 'start' };

function readSaved(): Saved {
  const empty: Saved = { design: null, step: null, source: {}, revisionOf: null, designSeen: false, draftId: null };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return empty;
  }
  if (raw === null) return empty;
  try {
    const parsed = JSON.parse(raw) as {
      v?: unknown;
      design?: unknown;
      step?: unknown;
      source?: unknown;
      revisionOf?: unknown;
      designSeen?: unknown;
      draftId?: unknown;
    };
    if (parsed.v !== 1 && parsed.v !== STORAGE_VERSION) return empty;
    // A v1 blob holds a v1 design (equal bays, no roof); `upgradeGuestDesign` moves it to v2 and
    // answers null for anything it cannot read, which is treated as "nothing saved".
    const upgraded = upgradeGuestDesign(parsed.design);
    const design = upgraded === null ? null : guestDesignSchema.safeParse(upgraded);
    const source = guestSourceSchema.safeParse(parsed.source ?? {});
    const legacyStep = typeof parsed.step === 'string' ? LEGACY_STEPS[parsed.step] : undefined;
    return {
      design: design !== null && design.success ? (design.data as GuestDesignInput) : null,
      step: isStep(parsed.step) ? parsed.step : (legacyStep ?? null),
      source: source.success ? source.data : {},
      revisionOf:
        design !== null && design.success && typeof parsed.revisionOf === 'string' && /^[A-Z0-9-]{1,8}\d{1,12}$/.test(parsed.revisionOf)
          ? parsed.revisionOf
          : null,
      // A blob saved before the flag existed: a visitor whose saved step was past ① has seen ②.
      designSeen: parsed.designSeen === true || parsed.step === 'design' || parsed.step === 'send',
      draftId:
        design !== null && design.success && typeof parsed.draftId === 'string' && DRAFT_ID_PATTERN.test(parsed.draftId)
          ? parsed.draftId
          : null,
    };
  } catch {
    return empty;
  }
}

function urlWithStep(step: GuestStep): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('step', step);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Read the saved design and the address once, in the browser.
 *
 * - `?step=` wins over the saved step, but still obeys the locks and the v1 names (`type`, `address`
 *   both mean ①).
 * - `utm_*` replace the saved source when present: the newest link is the one that brought them back.
 * - `?type=<id>` (a deep link from the brand site) picks that type and opens ① — **only when nothing
 *   is saved**. A guest with a design already has work this link must not throw away; they keep it
 *   and can change type themselves.
 *
 * The address is then rewritten to `/quote?step=<step>`, so a reload neither re-applies `?type=` nor
 * keeps campaign tags in the bar.
 */
export function hydrate(types: readonly GuestBuildingTypeSpec[] | null): void {
  if (state.ready) return;
  const saved = readSaved();
  const params = new URL(window.location.href).searchParams;

  const utm: GuestSource = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value !== null && value.trim() !== '') utm[key] = value.trim().slice(0, 100);
  }
  const source = Object.keys(utm).length > 0 ? utm : saved.source;
  // Read before the address is rewritten to `?step=…`, which drops every other parameter.
  const assistantOffered = params.get('assistant') === '1';

  let design = saved.design;
  let droppedType: string | null = null;

  /*
   * A draft pointing at a type that is no longer offered — the vendor switched it off in the admin
   * screen — is **dropped whole**.
   *
   * Measured 2026-11-19 with `test_shed` switched off: the page did not break (① opened with the six
   * cards), but the summary bar still read "test_shed · 6.00 × 6.00 m" — the raw id of a type that no
   * longer exists — and step ② said "This building type is no longer offered". A visitor can act on
   * neither: there is no card to re-pick and no way back to a design that works.
   *
   * The address goes with it, because it lives *inside* the design (`design.site`); keeping it would
   * mean inventing a design with a site and no building. Measured 2026-11-19: after the drop the page
   * showed six cards and no address, which is what the notice now says.
   *
   * `types === null` means the list has not loaded yet, so nothing is known and nothing is dropped.
   */
  if (design !== null && types !== null && !types.some((t) => t.id === design!.typeId)) {
    droppedType = design.typeId;
    design = null;
  }

  const rawStep = params.get('step');
  let step: GuestStep =
    droppedType !== null ? 'start' : isStep(rawStep) ? rawStep : (LEGACY_STEPS[rawStep ?? ''] ?? saved.step ?? 'start');

  const typeId = params.get('type');
  if (design === null && typeId !== null && types !== null) {
    const type = types.find((t) => t.id === typeId);
    if (type !== undefined) {
      design = guestDesignFromType(type);
      step = 'start';
    }
  }

  const type = types?.find((t) => t.id === design?.typeId);
  // Compared by reference below, so note it before the repair makes a new object.
  const fromSaved = design === saved.design;
  // A design saved before openings were re-placed on every change can hold one at an illegal spot
  // (the assistant once wrote offset 0). Put it right on load; nothing is judged until the types are known.
  if (design !== null && type !== undefined) design = refitGuestOpenings(design, type).design;
  step = allowedStep(step, design, type, state.contact);
  window.history.replaceState({ step }, '', urlWithStep(step));
  state = {
    ...state,
    design,
    step,
    source,
    ready: true,
    assistantOffered,
    revisionOf: fromSaved ? saved.revisionOf : null,
    droppedType,
    designSeen: design !== null && (step === 'design' || (fromSaved && saved.designSeen)),
    draftId: fromSaved ? saved.draftId : null,
  };
  persist();
  emit();
}

/** Open a step. A locked step does nothing. `push` adds a history entry so Back returns here. */
export function goTo(step: GuestStep, type?: GuestBuildingTypeSpec, { push = true }: { push?: boolean } = {}): boolean {
  if (stepLocked(step, state.design, type, state.contact)) return false;
  if (step === state.step) return true;
  if (push) window.history.pushState({ step }, '', urlWithStep(step));
  set({ step });
  return true;
}

/** Browser Back / Forward: follow the address, still obeying the locks. */
export function syncFromLocation(type?: GuestBuildingTypeSpec): void {
  const raw = new URL(window.location.href).searchParams.get('step');
  const wanted: GuestStep = isStep(raw) ? raw : (LEGACY_STEPS[raw ?? ''] ?? 'start');
  const step = allowedStep(wanted, state.design, type, state.contact);
  if (step !== wanted) window.history.replaceState({ step }, '', urlWithStep(step));
  if (step !== state.step) set({ step });
}

/** Pick a building type: start from its defaults, keeping an address already entered. */
export function chooseType(type: GuestBuildingTypeSpec): void {
  if (state.design?.typeId === type.id) return;
  const design = guestDesignFromType(type, state.design?.site);
  // Picking a type is the answer to "your type is gone"; the notice has done its job.
  if (state.droppedType !== null) set({ droppedType: null });
  if (state.sent !== null) {
    set({ design, sent: null, contact: EMPTY_CONTACT, revisionOf: state.sent.number, designSeen: false });
    return;
  }
  set({ design, designSeen: false });
}

/** Record the estimated wind region the address lookup answered (step ① shows it, step ② reuses it). */
export function setEstimate(region: GuestWindRegion | null): void {
  set({ estimate: region });
}

/** Set or clear the site address. Used by ①'s single address field. */
export function setSite(site: GuestSite | undefined): void {
  updateDesign((design) => {
    if (site !== undefined) return { ...design, site };
    const next = { ...design };
    delete next.site;
    return next;
  });
}

/** Replace the design (later steps edit through this). */
export function updateDesign(update: (design: GuestDesignInput) => GuestDesignInput): void {
  if (state.design === null) return;
  const previous = state.design;
  const design = update(state.design);
  // Every change is undoable, including the assistant's: one stack, one behaviour.
  if (designKey(design) !== designKey(previous)) {
    set({ undo: [...state.undo, previous].slice(-20) });
  }
  // Changing a design already sent is the same as "Keep designing": the next send is a revision.
  if (state.sent !== null && designKey(design) !== state.sent.designKey) {
    set({ design, sent: null, contact: EMPTY_CONTACT, revisionOf: state.sent.number });
    return;
  }
  set({ design });
}

/**
 * Replace the design with one the assistant produced, as a **single** undo step.
 *
 * The change set may be ten operations; pressing Undo once must put the design back the way it was
 * before all ten, which is what "one turn is one undo" means.
 */
export function applyAssistantDesign(design: GuestDesignInput): void {
  const previous = state.design;
  if (previous === null) {
    set({ design });
    return;
  }
  set({ design, undo: [...state.undo, previous].slice(-20), sent: null });
}

/** Step back one change. Returns false when there is nothing to undo. */
export function undoDesign(): boolean {
  const last = state.undo[state.undo.length - 1];
  if (last === undefined) return false;
  set({ design: last, undo: state.undo.slice(0, -1) });
  return true;
}

/** Whether Undo would do anything, for the button's disabled state. */
export function canUndoNow(): boolean {
  return state.undo.length > 0;
}

/** A stable key for "is this still the design that was sent". */
export function designKey(design: GuestDesignInput | null): string {
  return JSON.stringify(design);
}

/**
 * Change a contact field.
 *
 * `type` is passed in because whether ② is allowed depends on it (a Class 1 House is an enquiry with
 * nothing to design). Without it the lock can only see the design and the contact fields, which is
 * enough for ③ and the "② is locked" case; the frame re-checks on every render anyway.
 */
export function updateContact(patch: Partial<ContactDraft>, type?: GuestBuildingTypeSpec): void {
  const contact = { ...state.contact, ...patch };
  const step = stepLocked(state.step, state.design, type, contact) ? 'start' : state.step;
  if (step !== state.step) window.history.replaceState({ step }, '', urlWithStep(step));
  set({ contact, step });
}

/** The request went: show the confirmation in place of the form. */
export function markSent(number: string): void {
  // The server deleted the draft this request came from (it is a sent request now).
  set({ sent: { number, designKey: designKey(state.design) }, draftId: null });
}

/**
 * "Keep designing": the design stays and the next send is a revision of this one. Opens ②.
 *
 * The contact details are **kept**, unlike v1 where this form lived on the last step and emptying it
 * was the point. Now they are what unlocks ② (Q2), so clearing them would lock the guest out of the
 * designer they just used — measured 2026-11-19: "Keep designing" landed on ① with the design
 * stranded behind a contact form. They are in memory only either way.
 */
export function keepDesigning(type?: GuestBuildingTypeSpec): void {
  const number = state.sent?.number ?? state.revisionOf;
  set({ sent: null, revisionOf: number });
  goTo('design', type);
}

/**
 * Open a request sent earlier from this browser (the list on ①): its design comes back and the next
 * send is a revision of that number, exactly as "Keep designing" would have left it. The contact
 * fields are untouched — they were never saved.
 */
export function reopenSent(number: string, design: GuestDesignInput, type: GuestBuildingTypeSpec): void {
  const previous = state.design;
  const fitted = refitGuestOpenings(design, type).design;
  set({
    design: fitted,
    sent: null,
    revisionOf: number,
    designSeen: false,
    undo: previous === null ? state.undo : [...state.undo, previous].slice(-20),
  });
}

// ---------------------------------------------------------------- "Edit" links

let pendingFocus: string | null = null;

/**
 * Open a step and put focus on one field there (the "Edit" links on ③ and in the summary popover).
 *
 * The frame normally moves focus to the new panel's heading; a pending target is taken instead
 * (`takePendingFocus`). On the step already open, the field is focused straight away.
 */
export function editAt(step: GuestStep, selector: string, type?: GuestBuildingTypeSpec): void {
  pendingFocus = selector;
  if (step === state.step) {
    focusSelector(takePendingFocus());
    return;
  }
  if (!goTo(step, type)) pendingFocus = null;
}

export function takePendingFocus(): string | null {
  const selector = pendingFocus;
  pendingFocus = null;
  return selector;
}

/**
 * Focus the first match, opening the `<details>` group it sits in.
 *
 * `setTimeout`, not `requestAnimationFrame`: rAF is never scheduled in the browser automation this
 * project's checks run under, so a focus queued on it never happened.
 */
export function focusSelector(selector: string | null): boolean {
  if (selector === null) return false;
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el === null) return;
    const group = el.closest('details');
    if (group !== null && !group.open) group.open = true;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center' });
  }, 0);
  return true;
}

/** Start over: forget the design and go back to ①. The campaign source is kept — it is not theirs to lose. */
export function startOver(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing saved, or storage blocked; either way there is nothing left to remove.
  }
  if (state.step !== 'start') window.history.pushState({ step: 'start' }, '', urlWithStep('start'));
  set({ design: null, step: 'start', revisionOf: null, sent: null, contact: EMPTY_CONTACT, designSeen: false, draftId: null });
}

// ---------------------------------------------------------------- guest accounts (account.ts)

/**
 * Fill the contact fields from the signed-in guest's profile — **only the empty ones**, so anything
 * typed on ① stays. Editing a field afterwards does not change the profile (spec "Bước ①").
 */
export function prefillContact(profile: { firstName: string; lastName: string; email: string; mobile: string }): void {
  const c = state.contact;
  const patch: Partial<ContactDraft> = {};
  if (c.firstName.trim() === '') patch.firstName = profile.firstName;
  if (c.lastName.trim() === '') patch.lastName = profile.lastName;
  if (c.email.trim() === '') patch.email = profile.email;
  if (c.mobile.trim() === '') patch.mobile = nationalMobile(profile.mobile);
  if (Object.keys(patch).length > 0) set({ contact: { ...c, ...patch } });
}

/** `+61412345678` → `0412 345 678`, the way the field asks for it. */
export function nationalMobile(e164: string): string {
  const digits = e164.startsWith('+61') ? `0${e164.slice(3)}` : e164;
  return /^04\d{8}$/.test(digits) ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}` : digits;
}

/** Signed out: the contact fields go, and the design stops being the account's draft. */
export function forgetAccountState(): void {
  set({ contact: EMPTY_CONTACT, draftId: null });
}

export function setDraftId(draftId: string | null): void {
  if (draftId !== state.draftId) set({ draftId });
}

/** Open a server draft in the editor, at the step it stopped on (when that step is unlocked). */
export function openDraft(
  draft: { id: string; design: GuestDesignInput; step: GuestStep; source: GuestSource | null; revisionOf: string | null },
  type: GuestBuildingTypeSpec,
): void {
  const previous = state.design;
  const design = refitGuestOpenings(draft.design, type).design;
  const step = allowedStep(draft.step, design, type, state.contact);
  window.history.pushState({ step }, '', urlWithStep(step));
  set({
    design,
    step,
    source: draft.source ?? state.source,
    revisionOf: draft.revisionOf,
    draftId: draft.id,
    sent: null,
    droppedType: null,
    designSeen: draft.step !== 'start',
    undo: previous === null ? state.undo : [...state.undo, previous].slice(-20),
  });
}

/** The store as it is now, for `account.ts`'s autosave (outside React). */
export function guestSnapshot(): GuestState {
  return state;
}

export function subscribeGuest(listener: () => void): () => void {
  return subscribe(listener);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Read the store from a component; re-renders when the picked slice changes. */
export function useGuest<T>(select: (s: GuestState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(SERVER_STATE),
  );
}
