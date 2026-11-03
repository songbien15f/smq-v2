/**
 * Reading the catalogue: the rows a company can price.
 *
 * The lookup answers "what does this shed need"; this module answers "what is in
 * the book", which is the question an operator has when they want to change one
 * price. They are different questions with different shapes:
 *
 *   - The lookup is asked a hundred times per quote and must be fast, so it
 *     prepares a handful of narrow statements.
 *   - The catalogue is asked once per screen, may filter on any column, and must
 *     be able to show a row that no quote happens to use today.
 *
 * What they must **not** disagree about is identity, so both build their keys
 * with `rowKeys.ts`. `rowKeys.test.ts` compares them against the real book.
 */

import type { DatabaseSync } from 'node:sqlite';
import { CATALOGUE_SOURCES, requireSource, rowKeyOf, type CatalogueSource } from './rowKeys';

/** One catalogue row, as the price editor shows it. */
export interface CatalogueRow {
  /** The identity an override names. */
  rowKey: string;
  source: string;
  /** The supplier's code, or `''` when the book has none. */
  code: string;
  description: string;
  /** The unit the price is per. */
  unit: string;
  /** The book's price, in whole cents. */
  baseCents: number;
  /** The company's price for this row, or `null` at the book's price. */
  overrideCents: number | null;
}

export interface CatalogueQuery {
  /** Free text against the code and description. */
  search?: string;
  /** One source, or every source when absent. */
  source?: string;
  /** Only rows the company has priced. */
  overriddenOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface CataloguePage {
  rows: CatalogueRow[];
  /** Rows matching the query, across every source. */
  total: number;
  limit: number;
  offset: number;
}

/** The most rows one request returns. */
export const MAX_PAGE = 200;

/** Dollars → whole cents, the same conversion the lookup uses. */
function cents(dollars: unknown): number {
  const value = typeof dollars === 'number' ? dollars : Number(dollars);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/** A database value as display text, with `null` as the empty string. */
function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * The SQL that produces the catalogue columns for one source.
 *
 * The identity columns are selected alongside the display ones because the key is
 * built in JavaScript, by the same function the lookup uses. Building it in SQL
 * would mean two implementations of one identity — exactly the drift this design
 * exists to prevent.
 */
function selectFor(source: CatalogueSource): string {
  const identity = source.identity.join(', ');
  const code = source.codeColumn === null ? "'' AS code" : `${source.codeColumn} AS code`;
  return `SELECT ${identity}, ${code}, ${source.descriptionColumn} AS description, ${source.priceColumn} AS price FROM ${source.source}`;
}

/** The `WHERE` fragment for a search, and the values it binds. */
function whereFor(source: CatalogueSource, search: string): { sql: string; values: string[] } {
  const clauses: string[] = [];
  const values: string[] = [];

  if (source.filter !== undefined) clauses.push(`(${source.filter})`);

  if (search !== '') {
    // Matched against the code and the description, both of which are what an
    // operator types. `LIKE` with a leading wildcard cannot use an index, but the
    // largest source is 612 rows and the whole book is 3,250, so a scan is
    // cheaper than maintaining a search index.
    const columns =
      source.codeColumn === null
        ? [source.descriptionColumn]
        : [source.codeColumn, source.descriptionColumn];
    const any = columns.map((column) => `COALESCE(${column}, '') LIKE ?`).join(' OR ');
    clauses.push(`(${any})`);
    for (let i = 0; i < columns.length; i++) values.push(`%${search}%`);
  }

  return { sql: clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`, values };
}

/**
 * Read one page of the catalogue.
 *
 * `prices` is the company's current set, applied here rather than in the UI so
 * the override and the book's price always arrive together and cannot be shown
 * out of step.
 */
export function readCatalogue(
  db: DatabaseSync,
  query: CatalogueQuery,
  prices: Map<string, number>,
): CataloguePage {
  const limit = Math.min(Math.max(1, query.limit ?? 50), MAX_PAGE);
  const offset = Math.max(0, query.offset ?? 0);
  const search = (query.search ?? '').trim();

  const sources =
    query.source === undefined || query.source === ''
      ? CATALOGUE_SOURCES
      : [requireSource(query.source)];

  const rows: CatalogueRow[] = [];

  for (const source of sources) {
    const where = whereFor(source, search);
    const statement = db.prepare(`${selectFor(source)}${where.sql}`);
    const raw = statement.all(...where.values) as Record<string, unknown>[];

    for (const row of raw) {
      const rowKey = rowKeyOf(source.source, row);
      const overrideCents = prices.get(rowKey) ?? null;
      if (query.overriddenOnly === true && overrideCents === null) continue;
      rows.push({
        rowKey,
        source: source.source,
        code: text(row.code),
        description: text(row.description),
        unit: source.unit,
        baseCents: cents(row.price),
        overrideCents,
      });
    }
  }

  // A stable order across sources: by source as declared, then by description.
  // Without the source component two rows from different tables could interleave
  // and the page boundaries would move between requests.
  const order = new Map(CATALOGUE_SOURCES.map((entry, index) => [entry.source, index]));
  rows.sort((a, b) => {
    const bySource = (order.get(a.source) ?? 0) - (order.get(b.source) ?? 0);
    if (bySource !== 0) return bySource;
    const byDescription = a.description.localeCompare(b.description);
    return byDescription !== 0 ? byDescription : a.rowKey.localeCompare(b.rowKey);
  });

  return {
    rows: rows.slice(offset, offset + limit),
    total: rows.length,
    limit,
    offset,
  };
}

/**
 * How many rows each source holds, for the grouped price list.
 *
 * The price editor lists 2,401 rows in fourteen groups. Without a count beside
 * each group the operator has to open all fourteen to find the one they want, and
 * a group holding one row looks exactly like one holding six hundred. The counts
 * come from the book in one pass — a few milliseconds, far cheaper than an
 * operator clicking through groups to find out.
 */
export function sourceCounts(db: DatabaseSync): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const source of CATALOGUE_SOURCES) {
    const where = source.filter === undefined ? '' : ` WHERE ${source.filter}`;
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM ${source.source}${where}`)
      .get() as { n: number } | undefined;
    counts[source.source] = row === undefined ? 0 : Number(row.n);
  }
  return counts;
}

/**
 * Every row key the book contains.
 *
 * Used to detect an override that names a row the current book no longer has.
 * Building all 3,250 keys costs a few milliseconds and happens only when the
 * price screen loads, which is the right trade for telling an operator the truth
 * about their own prices.
 */
export function bookRowKeys(db: DatabaseSync): Set<string> {
  const keys = new Set<string>();
  for (const source of CATALOGUE_SOURCES) {
    const where = source.filter === undefined ? '' : ` WHERE ${source.filter}`;
    const rows = db.prepare(`SELECT * FROM ${source.source}${where}`).all() as Record<
      string,
      unknown
    >[];
    for (const row of rows) keys.add(rowKeyOf(source.source, row));
  }
  return keys;
}

/**
 * The book's own price for a set of row keys.
 *
 * A bulk edit names keys the operator selected, which may be anywhere in the
 * book. Looking each one up through the paged catalogue would be wrong (the page
 * is capped) and slow (it would scan every source per page). This walks each
 * source once and keeps only the keys asked for, so the cost is one scan
 * regardless of how many rows were selected.
 */
export function basePricesFor(db: DatabaseSync, keys: string[]): Map<string, number> {
  const wanted = new Set(keys);
  const found = new Map<string, number>();

  for (const source of CATALOGUE_SOURCES) {
    const where = source.filter === undefined ? '' : ` WHERE ${source.filter}`;
    const rows = db.prepare(`${selectFor(source)}${where}`).all() as Record<string, unknown>[];
    for (const row of rows) {
      const key = rowKeyOf(source.source, row);
      if (wanted.has(key)) found.set(key, cents(row.price));
    }
    // Every key found: no need to scan the remaining sources.
    if (found.size === wanted.size) break;
  }

  return found;
}
