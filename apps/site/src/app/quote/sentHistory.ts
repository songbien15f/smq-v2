'use client';

/**
 * The last five requests this browser sent, so a guest who comes back sees what they asked for.
 *
 * Kept under its own key, apart from the draft (`sq.guest.v1`): Start over forgets the draft, not
 * the history, and the history has its own Clear. Like the draft it holds the **design and the
 * site only — never the contact details** (see `store.ts`): a name, mobile and email in a shared
 * browser's storage is a leak. The number is what the confirmation email carries, so the guest can
 * match a row to it.
 *
 * Every read and write is inside try/catch; with storage blocked the list is simply empty. What
 * comes back is checked field by field, and the design through the same upgrade and schema the
 * draft uses, so a stale or hand-edited entry is dropped rather than crashing the page.
 */

import { useSyncExternalStore } from 'react';
import { guestDesignSchema } from '@sq/contracts';
import { upgradeGuestDesign, type GuestDesignInput } from '@sq/core/domain';

const KEY = 'sq.guest.sent.v1';
export const SENT_HISTORY_LIMIT = 5;
const NUMBER_PATTERN = /^[A-Z0-9-]{1,8}\d{1,12}$/;

export interface SentRequest {
  number: string;
  /** ISO-8601, when Send was answered. */
  sentAt: string;
  /** The type's name at the time, for the row; the design's `typeId` decides whether it can reopen. */
  typeName: string;
  design: GuestDesignInput;
}

const EMPTY: readonly SentRequest[] = [];
let cache: readonly SentRequest[] | null = null;
const listeners = new Set<() => void>();

function parse(raw: string | null): readonly SentRequest[] {
  if (raw === null) return EMPTY;
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return EMPTY;
    const out: SentRequest[] = [];
    for (const item of list as Record<string, unknown>[]) {
      if (item === null || typeof item !== 'object') continue;
      const { number, sentAt, typeName } = item;
      if (typeof number !== 'string' || !NUMBER_PATTERN.test(number)) continue;
      if (typeof sentAt !== 'string' || Number.isNaN(Date.parse(sentAt))) continue;
      const upgraded = upgradeGuestDesign(item.design);
      const design = upgraded === null ? null : guestDesignSchema.safeParse(upgraded);
      if (design === null || !design.success) continue;
      out.push({
        number,
        sentAt,
        typeName: typeof typeName === 'string' ? typeName.slice(0, 80) : '',
        design: design.data as GuestDesignInput,
      });
      if (out.length === SENT_HISTORY_LIMIT) break;
    }
    return out;
  } catch {
    return EMPTY;
  }
}

function read(): readonly SentRequest[] {
  if (cache !== null) return cache;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // Storage blocked: nothing remembered.
  }
  cache = parse(raw);
  return cache;
}

function write(list: readonly SentRequest[]): void {
  cache = list;
  try {
    if (list.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable; the list lives for this visit only.
  }
  for (const listener of listeners) listener();
}

/** Note a request that was accepted. Newest first; a repeated number replaces its old row. */
export function recordSent(entry: { number: string; typeName: string; design: GuestDesignInput }): void {
  const row: SentRequest = { ...entry, sentAt: new Date().toISOString() };
  write([row, ...read().filter((r) => r.number !== entry.number)].slice(0, SENT_HISTORY_LIMIT));
}

export function forgetSent(number: string): void {
  write(read().filter((r) => r.number !== number));
}

export function clearSent(): void {
  write(EMPTY);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab sent a request: drop the cache so the next read sees it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The saved requests, newest first. Empty on the server and until the browser has read storage. */
export function useSentRequests(): readonly SentRequest[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
