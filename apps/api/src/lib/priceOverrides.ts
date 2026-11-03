/**
 * A company's price overrides, read from the database ready to apply.
 *
 * ## Why the latest version wins, and nothing else
 *
 * Overrides are versioned so a quote can name the price set it was built from. Applying **every**
 * row from every version would mean an old price could beat a new one depending on row order — the
 * exact bug versioning exists to prevent. Only the highest version is live; the older ones are kept
 * because revisions already recorded them.
 *
 * ## Why a missing table is not an error
 *
 * The tables ship with the first migration, but a database restored from an older backup may not
 * have them. A company with no override table is a company using the shared book, which is the
 * normal state — not a reason to refuse to quote.
 */

import type { Db } from '@sq/db';
import type { OverrideSet } from '@sq/core/pricing';

/** The override set in force for a company, or an empty one. */
export async function loadOverrides(db: Db, tenantId: string): Promise<OverrideSet> {
  try {
    const latest = await db.get<{ version: number; id: string }>(
      'SELECT version, id FROM price_overrides WHERE tenant_id = ? ORDER BY version DESC LIMIT 1',
      [tenantId],
    );

    const overrides =
      latest === null
        ? []
        : (
            await db.all<{ row_key: string; unit_cost_cents: number }>(
              'SELECT row_key, unit_cost_cents FROM price_row_overrides WHERE override_id = ? AND tenant_id = ?',
              [latest.id, tenantId],
            )
          ).map((row) => ({ rowKey: row.row_key, unitCost: Number(row.unit_cost_cents) }));

    const custom = (
      await db.all<{
        source: string;
        name: string;
        code: string;
        description: string;
        unit: string;
        unit_cost_cents: number;
        mass_kg: number | null;
      }>(
        `SELECT source, name, code, description, unit, unit_cost_cents, mass_kg
           FROM company_catalogue_rows WHERE tenant_id = ?`,
        [tenantId],
      )
    ).map((row) => ({
      source: row.source,
      name: row.name,
      description: row.description,
      unit: row.unit,
      unitCost: Number(row.unit_cost_cents),
      massKg: row.mass_kg === null ? 0 : Number(row.mass_kg),
    }));

    return { overrides, custom, version: latest === null ? 0 : Number(latest.version) };
  } catch {
    /*
     * A database without these tables is a database from before the feature. Answering with an empty
     * set means the quote prices from the shared book — which is what that company has been getting
     * all along — rather than failing a sale over a missing table.
     */
    return { overrides: [], custom: [], version: 0 };
  }
}
