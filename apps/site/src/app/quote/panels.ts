'use client';

/**
 * Which of tab ③'s two panels is open, per breakpoint.
 *
 * ## Why a store, and why it forgets
 *
 * The template this layout follows keeps panel state **in memory only**: a reload returns to the
 * defaults, and a change of breakpoint resets to that breakpoint's defaults (plan D4). That is
 * deliberate, not an omission — a column a person collapsed on a desktop should not arrive collapsed
 * on their phone, where a different default is correct: on a phone both panels start closed, because a
 * drawer covering the stage would be the first thing they saw.
 *
 * Defaults: **desktop both open · tablet (1024–1279) tools open, assistant closed · phone both closed.**
 *
 * ## The server render
 *
 * The store starts at the desktop defaults, which is what the server renders. An effect corrects it
 * from `matchMedia` on mount — so a phone shows the desktop layout for one frame at most, and then the
 * right one. Guessing from a user agent would be worse: the server has no reliable idea of the width.
 */

import { useSyncExternalStore } from 'react';

export type Bp = 'desktop' | 'tablet' | 'phone';

/** The id of a group the tools rail can open directly. */
export type ToolsGroupId = 'g-group-size' | 'g-group-colours' | 'g-group-doors';

export interface PanelsState {
  bp: Bp;
  leftOpen: boolean;
  rightOpen: boolean;
}

/** What each breakpoint starts with (D1, D4, and the template's own defaults). */
export function defaultsFor(bp: Bp): { leftOpen: boolean; rightOpen: boolean } {
  if (bp === 'desktop') return { leftOpen: true, rightOpen: true };
  if (bp === 'tablet') return { leftOpen: true, rightOpen: false };
  return { leftOpen: false, rightOpen: false };
}

function bpFor(width: number): Bp {
  if (width >= 1280) return 'desktop';
  if (width >= 1024) return 'tablet';
  return 'phone';
}

/*
 * The server snapshot: desktop with both panels open, which is also the widest layout. `useSyncExternal
 * Store` renders this first and the real answer on the client, so hydration matches.
 */
const INITIAL: PanelsState = { bp: 'desktop', ...defaultsFor('desktop') };

let state: PanelsState = INITIAL;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function set(patch: Partial<PanelsState>): void {
  state = { ...state, ...patch };
  emit();
}

export function usePanels<T>(select: (s: PanelsState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => select(state),
    () => select(INITIAL),
  );
}

/**
 * Watch the two breakpoints and reset to their defaults **when the breakpoint changes**.
 *
 * A change of breakpoint resets both flags (D4); a resize *inside* one breakpoint leaves a person's
 * choice alone, so dragging a window edge does not re-open a panel they closed.
 *
 * Returns the teardown.
 */
export function watchBreakpoint(): () => void {
  if (typeof window === 'undefined') return () => {};

  const wide = window.matchMedia('(min-width: 1280px)');
  const medium = window.matchMedia('(min-width: 1024px)');

  const apply = () => {
    const bp = bpFor(window.innerWidth);
    if (bp === state.bp) return;
    set({ bp, ...defaultsFor(bp) });
  };

  // The first reading corrects the server's guess without treating it as a breakpoint change.
  const bp = bpFor(window.innerWidth);
  if (bp !== state.bp) {
    // A first paint at the wrong defaults is corrected here; the flags go to this width's defaults too,
    // because nothing has been chosen yet.
    set({ bp, ...defaultsFor(bp) });
  }

  /*
   * A `resize` listener as well as the two media queries.
   *
   * The `change` events are the precise signal, and they fire in every browser a person uses. They are
   * not delivered in every embedded or automated environment — `ResizeObserver` already is not, which is
   * why `useContainerSize` dispatches a `resize` of its own — and a layout that only sometimes follows
   * the width is worse than one that listens twice. `apply` is idempotent within a breakpoint, so the
   * extra call costs a comparison.
   */
  wide.addEventListener('change', apply);
  medium.addEventListener('change', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  return () => {
    wide.removeEventListener('change', apply);
    medium.removeEventListener('change', apply);
    window.removeEventListener('resize', apply);
    window.removeEventListener('orientationchange', apply);
  };
}

export function openTools(groupId?: ToolsGroupId): void {
  // On a phone the rail does not exist, so opening a group means opening the drawer and scrolling.
  set({ leftOpen: true });
  if (groupId === undefined) return;
  // After the DOM has the panel open (a drawer animates in), open the group and bring it into view.
  const scroll = () => {
    const summary = document.getElementById(groupId);
    if (summary === null) return;
    const details = summary.closest('details');
    if (details !== null && !details.open) details.open = true;
    summary.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame(scroll);
}

export function closeTools(): void {
  if (focusIsInside('g-tools')) focusAfter('g-tools-btn');
  set({ leftOpen: false });
}

export function openAssistant(): void {
  set({ rightOpen: true });
}

export function closeAssistant(): void {
  if (focusIsInside('g-assistant')) focusAfter('g-assistant-fab');
  set({ rightOpen: false });
}

/**
 * Move focus to `id` after the panel has closed.
 *
 * The target may still be `inert` in the same tick (the panel's `inert` is set on the next render, and
 * the FAB appears then too), so this waits a frame. `requestAnimationFrame` is not scheduled in every
 * automation environment, so a `setTimeout` is the fallback — the same choice `store.ts:focusSelector`
 * makes.
 */
function focusAfter(id: string): void {
  if (typeof window === 'undefined') return;
  const attempt = () => {
    const el = document.getElementById(id);
    el?.focus({ preventScroll: true });
  };
  window.requestAnimationFrame(attempt);
  window.setTimeout(attempt, 60);
}

function focusIsInside(id: string): boolean {
  if (typeof document === 'undefined') return false;
  const panel = document.getElementById(id);
  return panel !== null && panel.contains(document.activeElement);
}

/** Escape closes the AI everywhere, and the tools drawer only where it *is* a drawer (phone). */
export function handleEscape(): void {
  if (!state.rightOpen && !(state.bp === 'phone' && state.leftOpen)) return;
  if (state.rightOpen) closeAssistant();
  else if (state.bp === 'phone' && state.leftOpen) closeTools();
}
