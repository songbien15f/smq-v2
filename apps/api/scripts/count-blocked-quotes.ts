/**
 * Count saved quotes the editor would refuse to save again as they stand. Read-only.
 *
 * ## Why this exists
 *
 * A building outside the price book blocks saving (decision "Block saving", review
 * `docs/reviews/2026-11-13-quote-editor-overview.md` item 7). Old quotes saved before that rule can sit
 * outside the book, and then cannot be re-saved, not even to fix a typo in the customer's email, until
 * someone corrects the building. This script says how many quotes that is, before a release lands
 * the rule on real data.
 *
 * It runs the editor's own validator (`apps/client/.../validation.ts`) with the active book's bounds,
 * so the count cannot drift from what the screen does. It reads the current revision of each quote.
 * It writes nothing.
 *
 *   pnpm quotes:blocked                 # every company
 *   pnpm quotes:blocked -- --tenant demo-sheds
 *   pnpm quotes:blocked -- --list       # also name each blocked quote and its building issues
 */

import { normaliseShedConfig } from '@sq/core/domain';
import type { ShedConfig } from '@sq/core/domain';
import { createSqliteCatalogueSource } from '@sq/core/pricing';
import { dbConfigFromEnv, openDb } from '@sq/db';
import { activeBookHash, closeAllBooks, openBookDatabase } from '../src/lib/priceBook';
import { bookBounds } from '../../client/src/components/editor/bookBounds';
import { isBuildingIssue, validateDraft } from '../../client/src/components/editor/validation';

type Json = Record<string, unknown>;

function parse(text: string | null): Json {
  if (text === null || text === '') return {};
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' ? (value as Json) : {};
  } catch {
    return {};
  }
}

/** A string field, as the edit page reads one (`edit/page.tsx`). */
function text(source: Json, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slugIndex = args.indexOf('--tenant');
  const slug = slugIndex >= 0 ? args[slugIndex + 1] : undefined;
  const list = args.includes('--list');

  const db = openDb(dbConfigFromEnv());

  try {
    const hash = await activeBookHash(db);
    if (hash === null) {
      process.stderr.write('No price book is active, so there are no book bounds to check against.\n');
      process.exitCode = 1;
      return;
    }
    const catalogue = createSqliteCatalogueSource(openBookDatabase(hash)).load();
    const book = { nonStandardStructureCodes: catalogue.nonStandardStructureCodes };

    const params: string[] = [];
    let where = '';
    if (slug !== undefined) {
      where = 'WHERE t.slug = ?';
      params.push(slug);
    }

    const rows = await db.all<{
      id: string;
      number: string;
      company: string;
      site_json: string;
      config_json: string | null;
      customer_json: string | null;
    }>(
      `SELECT q.id, q.number, t.name AS company, q.site_json, r.config_json, r.customer_json
         FROM quotes q
         JOIN tenants t ON t.id = q.tenant_id
         LEFT JOIN quote_revisions r ON r.quote_id = q.id AND r.revision = q.current_revision
         ${where}
        ORDER BY t.name, q.number`,
      params,
    );

    let noBuilding = 0;
    let checked = 0;
    let blockedByBuilding = 0;
    let blockedByOpeningOrOption = 0;
    let blockedByCustomerOrSiteOnly = 0;
    let clean = 0;
    const byRule = new Map<string, number>();
    const named: string[] = [];

    for (const row of rows) {
      const raw = parse(row.config_json);
      // The edit page sends a quote with no frozen building to the read-only view (`edit/page.tsx`).
      if (row.config_json === null || Object.keys(raw).length === 0) {
        noBuilding += 1;
        continue;
      }
      checked += 1;

      const config: ShedConfig = normaliseShedConfig(raw);
      const customer = parse(row.customer_json);
      const site = parse(row.site_json);
      const issues = validateDraft(
        {
          config,
          customer: {
            firstName: text(customer, 'firstName'),
            lastName: text(customer, 'lastName'),
            email: text(customer, 'email'),
            phone: text(customer, 'phone'),
            mobile: text(customer, 'mobile'),
            fax: text(customer, 'fax'),
            address: text(customer, 'address'),
            suburb: text(customer, 'suburb'),
            state: text(customer, 'state'),
            postcode: text(customer, 'postcode'),
          },
          site: {
            address: text(site, 'address'),
            suburb: text(site, 'suburb'),
            state: text(site, 'state'),
            postcode: text(site, 'postcode'),
            deliveryAddress: text(site, 'deliveryAddress'),
            deliveryScope: text(site, 'deliveryScope'),
            deliveryAcknowledged: site.deliveryAcknowledged === true || site.deliveryAcknowledged === 'true',
          },
        } as Parameters<typeof validateDraft>[0],
        book,
        bookBounds(catalogue, config.span),
      );

      const building = issues.filter((issue) => isBuildingIssue(issue.path));
      const options = issues.filter((issue) => issue.path.startsWith('options-'));

      if (building.length > 0) {
        blockedByBuilding += 1;
        for (const rule of new Set(building.map((issue) => issue.path))) {
          byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
        }
        if (list) {
          named.push(`  ${row.company} ${row.number}: ${building.map((issue) => issue.short).join('; ')}`);
        }
      } else if (options.length > 0) {
        blockedByOpeningOrOption += 1;
        if (list) named.push(`  ${row.company} ${row.number}: ${options.map((issue) => issue.short).join('; ')}`);
      } else if (issues.length > 0) {
        blockedByCustomerOrSiteOnly += 1;
      } else {
        clean += 1;
      }
    }

    const out: string[] = [
      `Price book ${hash.slice(0, 12)}…${slug === undefined ? '' : `, company "${slug}"`}`,
      `Quotes: ${rows.length} (${noBuilding} with no stored building, not editable, skipped)`,
      `Checked: ${checked}`,
      `  Blocked by the building (outside the book or another building rule): ${blockedByBuilding}`,
      `  Blocked by a door, window or option that no longer fits: ${blockedByOpeningOrOption}`,
      `  Blocked only by customer/site fields: ${blockedByCustomerOrSiteOnly}`,
      `  Save as they stand: ${clean}`,
    ];
    if (byRule.size > 0) {
      out.push('Building rules hit (a quote can hit several):');
      for (const [rule, count] of [...byRule].sort((a, b) => b[1] - a[1])) out.push(`  ${rule}: ${count}`);
    }
    if (list && named.length > 0) out.push('Blocked quotes:', ...named);
    process.stdout.write(`${out.join('\n')}\n`);
  } finally {
    closeAllBooks();
    await db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
