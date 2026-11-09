/**
 * Usage: what the product is actually being used for.
 *
 * ## Why this table was empty
 *
 * `usage_events` has existed since the first migration and **nothing ever wrote to it**. A table nobody
 * writes is worse than no table: it looks like analytics, so nobody builds analytics, and a vendor
 * asking "how many quotes did this company write last month" has no answer.
 *
 * ## What is recorded, and what is deliberately not
 *
 * Four kinds, all facts about the product rather than about a person:
 *
 * - `quote_created` — a quote was saved for the first time
 * - `revision_saved` — an amendment
 * - `mail_sent` — a quote left the building
 * - `page_view` — a screen was opened
 *
 * **No customer name, no address, no price, no quote content.** The row says *that* something
 * happened and which company it happened for. Anything more turns an analytics table into a second
 * copy of the customer database, with a weaker access rule.
 *
 * ## Why the write never fails the request
 *
 * A usage row is a side effect. If the insert fails, the quote was still saved, and throwing would
 * turn an analytics problem into a broken save. The failure is swallowed deliberately — and this is
 * the one place in this codebase where swallowing is right, so it says so.
 */

import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';
import { createHash } from 'node:crypto';
import { encryptAddress } from './address.js';

/** The kinds this product records. A stable list, because a dashboard groups by it. */
export const USAGE_KINDS = ['quote_created', 'revision_saved', 'mail_sent', 'page_view'] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

/**
 * A salted digest of an address: a stable handle, not the address.
 *
 * Kept beside `ip_enc` (the encrypted address) for one property the ciphertext does not have: a
 * **rotation of `SESSION_SECRET` makes the ciphertext unreadable but leaves this unchanged**, so a
 * visitor's history stays one history. The log groups by this; the address is only ever shown.
 */
export function hashAddress(address: string | undefined): string | null {
  if (address === undefined || address.trim() === '') return null;
  const normalised = address.trim().replace(/^::ffff:/i, '');
  const salt = process.env.SESSION_SECRET ?? 'smartquote-usage';
  return createHash('sha256').update(`handle|${salt}|${normalised}`, 'utf8').digest('hex').slice(0, 32);
}

/** Record one event. Never throws. */
export async function recordUsage(
  db: Db,
  input: {
    kind: UsageKind;
    tenantId: string | null;
    userId: string | null;
    /** The request's address. Encrypted and digested here, so no caller can write a raw one. */
    address?: string;
    /**
     * The product session this event happened in.
     *
     * This is what makes "how long did they stay" answerable. The product's own session is the honest
     * boundary: somebody who closes the laptop and returns tomorrow has a new session and must not be
     * credited with fourteen hours. No new cookie and no client change — the id is already on every
     * request.
     */
    sessionId?: string | null;
    /** Who did it, as a person reads it. Not an id: the dashboard is read by a human. */
    actorEmail?: string | null;
    /** Free-form, and deliberately small: a quote id, a route. Never customer data. */
    detail?: Record<string, string | number | boolean>;
  },
): Promise<void> {
  try {
    /*
     * The actor travels **inside `detail_json`**, not in a new column.
     *
     * `usage_events` has existed since migration 001 on both dialects; a column means a migration plus
     * a second shape that can disagree between SQLite and Postgres. The label is one short string on a
     * row that is already JSON, and nothing queries it on its own — the dashboard reads the rows and
     * groups them. If it ever needs an index, that is the moment to add the column.
     */
    const detail: Record<string, string | number | boolean> = { ...(input.detail ?? {}) };
    if (input.actorEmail !== undefined && input.actorEmail !== null && input.actorEmail !== '') {
      detail.actor = input.actorEmail;
    }

    await db.run(
      `INSERT INTO usage_events (id, at, kind, tenant_id, user_id, ip_hash, ip_enc, session_id, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId(),
        now(),
        input.kind,
        input.tenantId,
        input.userId,
        hashAddress(input.address),
        encryptAddress(input.address),
        input.sessionId ?? null,
        Object.keys(detail).length === 0 ? null : JSON.stringify(detail),
      ],
    );
  } catch {
    /*
     * Swallowed on purpose. A usage row is a side effect of the thing the caller asked for; a failed
     * insert must not turn a saved quote into an error. This is the only place in the product where
     * swallowing is the right answer, which is why it is commented rather than silent.
     */
  }
}

/** One row of the summary a dashboard shows. */
export interface UsageSummaryRow {
  kind: string;
  total: number;
  last7: number;
  last30: number;
}

/**
 * Counts by kind, over the whole history and two windows.
 *
 * Computed in one query rather than three: the table grows with every save, and three passes over it
 * for one screen is three times the work for the same answer.
 */
export async function usageSummary(db: Db, tenantId: string | null): Promise<UsageSummaryRow[]> {
  const at7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const at30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  /*
   * The tenant filter is **built**, not passed as a nullable parameter.
   *
   * `(? IS NULL OR tenant_id = ?)` is the obvious spelling and Postgres refuses it with
   * "could not determine data type of parameter $3" — it cannot infer a type for a bare `?` compared
   * to NULL. This project has hit that once before; the fix is the same, and building the clause keeps
   * the SQL portable to SQLite, which would have accepted the other form and hidden the bug.
   */
  const where = tenantId === null ? '' : 'WHERE tenant_id = ?';
  const params: (string | number)[] = [at7, at30];
  if (tenantId !== null) params.push(tenantId);

  const rows = await db.all<{ kind: string; total: number; last7: number; last30: number }>(
    `SELECT kind,
            COUNT(*) AS total,
            SUM(CASE WHEN at >= ? THEN 1 ELSE 0 END) AS last7,
            SUM(CASE WHEN at >= ? THEN 1 ELSE 0 END) AS last30
       FROM usage_events
       ${where}
      GROUP BY kind
      ORDER BY kind`,
    params,
  );

  return rows.map((row) => ({
    kind: row.kind,
    total: Number(row.total),
    last7: Number(row.last7 ?? 0),
    last30: Number(row.last30 ?? 0),
  }));
}

/** The most recent events, for a screen that wants to show activity rather than totals. */
export async function recentUsage(
  db: Db,
  input: { tenantId: string | null; limit: number },
): Promise<{ id: string; at: string; kind: string; userId: string | null; detail: string | null }[]> {
  // Built rather than nullable, for the same Postgres reason as `usageSummary`.
  const where = input.tenantId === null ? '' : 'WHERE tenant_id = ?';
  const params: (string | number)[] = input.tenantId === null ? [] : [input.tenantId];
  params.push(input.limit);

  const rows = await db.all<{
    id: string;
    at: string;
    kind: string;
    user_id: string | null;
    detail_json: string | null;
  }>(
    `SELECT id, at, kind, user_id, detail_json
       FROM usage_events
       ${where}
      ORDER BY at DESC
      LIMIT ?`,
    params,
  );

  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    kind: row.kind,
    userId: row.user_id,
    detail: row.detail_json,
  }));
}
