/**
 * Evaluating and saving a quote.
 *
 * ## Why an evaluation is stored rather than recomputed
 *
 * The editor shows a price, and then the operator presses Save. Between those two moments three
 * things can change: the price book can be republished, a per-row override can be edited, and
 * the browser can send a different config from the one on screen. Without a stored evaluation
 * all three save silently, and the customer receives a figure nobody looked at.
 *
 * So the preview is persisted with:
 *
 * - a hash of the **config** it priced and a hash of the **result** it produced;
 * - the **book hash** and **override version** it used;
 * - an **expiry**, because a preview is not a quote.
 *
 * Save re-reads the evaluation and refuses with a 409 if any of those moved. The operator then
 * sees the new number and decides again, which is the only honest answer.
 *
 * ## Why a revision stores its own BOM and price
 *
 * A revision is the record of what a customer was sent. Storing a pointer to "the calculation"
 * would mean next month's price-book update changes a figure somebody already signed. The BOM,
 * the price and the issues are frozen in the row; `quote_revisions` has no UPDATE path at all.
 */

import type { Db } from '@sq/db';
import { newId, now, plusMs } from '@sq/db';
import { canonicalHash } from './priceBook.js';

/** How long a preview stays valid. Long enough to type a customer's details in. */
export const EVALUATION_TTL_MS = 30 * 60 * 1000;

/** One evaluation, as Save reads it back. */
export interface StoredEvaluation {
  id: string;
  configHash: string;
  resultHash: string;
  priceBookHash: string;
  overrideVersion: number;
  engineVersion: number;
  status: string;
  priceJson: string;
  linesJson: string;
  /**
   * The frame cut list, as JSON.
   *
   * Stored with the preview rather than recomputed at save: the draft on screen was
   * priced from this list, and a save that rebuilt it could pick different sections
   * if the factory profile changed mid-edit.
   */
  membersJson: string;
  issuesJson: string;
  expiresAt: string;
  consumedAt: string | null;
}

/** Raised when a save cannot be honest about what it is saving. */
export class SaveRefused extends Error {
  constructor(
    readonly code: 'expired' | 'changed' | 'not_yours' | 'consumed' | 'conflict',
    message: string,
  ) {
    super(message);
    this.name = 'SaveRefused';
  }
}

/**
 * Record a preview.
 *
 * The whole priced result is stored, not just its hash: Save writes the stored figures into the
 * revision, so what the operator saw is what the customer gets.
 */
export async function storeEvaluation(
  db: Db,
  input: {
    tenantId: string;
    userId: string;
    configHash: string;
    resultHash: string;
    priceBookHash: string;
    overrideVersion: number;
    settingsVersion: number;
    engineVersion: number;
    status: string;
    price: unknown;
    /** The BOM lines, flattened: the contract names them `lines`, not `groups`. */
    lines: unknown;
    /** The frame cut list that goes with those lines. */
    members: unknown;
    issues: unknown;
  },
): Promise<{ id: string; expiresAt: string }> {
  // A preview nobody will save is litter. Clearing this company's expired rows on each new
  // evaluation keeps the table bounded without a scheduler.
  await db.run('DELETE FROM evaluations WHERE tenant_id = ? AND expires_at < ?', [
    input.tenantId,
    now(),
  ]);

  const id = newId();
  const expiresAt = plusMs(EVALUATION_TTL_MS);

  await db.run(
    `INSERT INTO evaluations (
       id, tenant_id, config_hash, result_hash, price_book_hash, override_version, settings_version,
       engine_version, status, price_json, lines_json, members_json, issues_json, created_by, created_at,
       expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.tenantId,
      input.configHash,
      input.resultHash,
      input.priceBookHash,
      input.overrideVersion,
      input.settingsVersion,
      input.engineVersion,
      input.status,
      JSON.stringify(input.price),
      JSON.stringify(input.lines),
      JSON.stringify(input.members ?? []),
      JSON.stringify(input.issues),
      input.userId,
      now(),
      expiresAt,
    ],
  );

  return { id, expiresAt };
}

/**
 * Read an evaluation back for a save.
 *
 * Every refusal names what moved. "The price changed" is useless to an operator; "the price book
 * was republished while you were editing" is a sentence they can act on.
 */
export async function loadEvaluationForSave(
  db: Db,
  input: {
    tenantId: string;
    userId: string;
    evaluationId: string;
    /** The config the browser is about to save, so the server can compare. */
    configHash: string;
  },
): Promise<StoredEvaluation> {
  const row = await db.get<{
    id: string;
    config_hash: string;
    result_hash: string;
    price_book_hash: string;
    override_version: number;
    engine_version: number;
    status: string;
    price_json: string;
    lines_json: string;
    members_json: string;
    issues_json: string;
    expires_at: string;
    consumed_at: string | null;
    created_by: string | null;
    tenant_id: string;
  }>(
    `SELECT id, config_hash, result_hash, price_book_hash, override_version, engine_version,
            status, price_json, lines_json, members_json, issues_json, expires_at, consumed_at,
            created_by, tenant_id
       FROM evaluations WHERE id = ?`,
    [input.evaluationId],
  );

  // Not found and not-yours answer the same way: a different answer would confirm the existence
  // of another company's evaluation.
  if (row === null || row.tenant_id !== input.tenantId) {
    throw new SaveRefused('not_yours', 'That price preview is not available. Calculate the price again.');
  }

  if (row.consumed_at !== null) {
    throw new SaveRefused(
      'consumed',
      'This price preview has already been saved. Calculate the price again to save another revision.',
    );
  }

  if (Date.parse(row.expires_at) <= Date.now()) {
    throw new SaveRefused(
      'expired',
      'This price preview is older than 30 minutes, so prices may have moved. Calculate it again before saving.',
    );
  }

  if (row.config_hash !== input.configHash) {
    throw new SaveRefused(
      'changed',
      'The building changed after the price was calculated, so the figure on screen is not this building. Calculate the price again.',
    );
  }

  return {
    id: row.id,
    configHash: row.config_hash,
    resultHash: row.result_hash,
    priceBookHash: row.price_book_hash,
    overrideVersion: Number(row.override_version),
    engineVersion: Number(row.engine_version),
    status: row.status,
    priceJson: row.price_json,
    linesJson: row.lines_json,
    membersJson: row.members_json,
    issuesJson: row.issues_json,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

/** Mark an evaluation as used, inside the same transaction that writes the revision. */
export async function consumeEvaluation(tx: Db, evaluationId: string): Promise<void> {
  await tx.run('UPDATE evaluations SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL', [
    now(),
    evaluationId,
  ]);
}

/**
 * Allocate the next quote number for a company, inside a transaction.
 *
 * `Q-1042` style, per company per year. The counter row is updated in the same transaction that
 * inserts the quote, so two simultaneous saves cannot take the same number — the constraint the
 * old licence server lacked, where two "Q-1042"s existed because the count was taken from a
 * separate read.
 */
export async function nextQuoteNumber(tx: Db, tenantId: string): Promise<string> {
  const year = new Date().getUTCFullYear();

  const existing = await tx.get<{ last_value: number }>(
    'SELECT last_value FROM quote_counters WHERE tenant_id = ? AND year = ?',
    [tenantId, year],
  );

  let next: number;
  if (existing === null) {
    next = 1;
    await tx.run('INSERT INTO quote_counters (tenant_id, year, last_value) VALUES (?, ?, ?)', [
      tenantId,
      year,
      next,
    ]);
  } else {
    next = Number(existing.last_value) + 1;
    await tx.run('UPDATE quote_counters SET last_value = ? WHERE tenant_id = ? AND year = ?', [
      next,
      tenantId,
      year,
    ]);
  }

  return `Q-${year}-${String(next).padStart(4, '0')}`;
}

/** Re-exported so a caller hashes the config the same way the evaluation did. */
export { canonicalHash };
