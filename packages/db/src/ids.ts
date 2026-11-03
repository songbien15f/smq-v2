/**
 * Identifiers and timestamps.
 *
 * Two functions, both boring on purpose, and both centralised so a schema that
 * stores uuids as text and timestamps as ISO-8601 has exactly one way to produce
 * them. A second `new Date().toISOString()` written inline is how one table ends up
 * with millisecond precision and another without.
 */

import { randomUUID } from 'node:crypto';

/** A new record id. */
export function newId(): string {
  return randomUUID();
}

/** The current time, as the ISO-8601 UTC text every timestamp column holds. */
export function now(): string {
  return new Date().toISOString();
}

/** A time `ms` in the future, same format. */
export function plusMs(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

/** A time `days` in the future, same format. */
export function plusDays(days: number): string {
  return plusMs(days * 24 * 60 * 60 * 1000);
}

/** True when an ISO timestamp is at or before now. */
export function isPast(iso: string, at: Date = new Date()): boolean {
  const value = Date.parse(iso);
  return Number.isFinite(value) && value <= at.getTime();
}
