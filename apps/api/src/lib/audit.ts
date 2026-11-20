/**
 * The audit log's one write path.
 *
 * Every platform write is recorded here, **inside the same transaction as the change it describes**:
 * a row that says "type disabled" must not survive a rollback of the disable itself, and a change
 * that commits must not be missing from the log.
 *
 * ## Why it lives in `lib/`
 *
 * It used to be private to `routes/admin.ts`, which was fine while that was the only file writing
 * platform data. `routes/guestTypesAdmin.ts` writes platform data too (the Guest page's building
 * types are a platform catalogue), and a second copy of this insert would be a second place to get
 * the columns wrong. Moving it changed no behaviour: same SQL, same fields.
 *
 * `audit_events` is append-only — nothing in the product updates or deletes a row.
 */

import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';

export interface AuditEntry {
  actorId: string;
  actorEmail: string;
  /** A dotted verb, e.g. `company.create`, `guest_type.update`. */
  action: string;
  /** The kind of thing changed, e.g. `guest_building_type`. */
  targetType: string;
  targetId: string;
  /** One line a person reads in the audit screen, in past tense. */
  summary: string;
}

/** Write one audit row. Call it with the transaction that is making the change, not the pool. */
export async function audit(tx: Db, entry: AuditEntry): Promise<void> {
  await tx.run(
    `INSERT INTO audit_events (id, at, actor_id, actor_email, action, target_type, target_id, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId(), now(), entry.actorId, entry.actorEmail, entry.action, entry.targetType, entry.targetId, entry.summary],
  );
}
