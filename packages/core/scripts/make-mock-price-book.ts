/**
 * Build a mock price book from the real one, with every price moved by 10–30%.
 *
 * ## Why this exists
 *
 * The real book is a licensed supplier catalogue. Showing it to a prospective
 * customer is showing them somebody else's prices, and — worse for a demo — it
 * makes the numbers look authoritative when they are not. A mock book lets a
 * customer try the workflow on realistic figures without either problem.
 *
 * ## Two properties the mock must have
 *
 * 1. **Deterministic per row.** The same row always gets the same adjustment, so
 *    two quotes of the same shed produce the same price, and a demo cannot drift
 *    between two runs. The seed is derived from the row's own identity, not from a
 *    counter or the clock.
 * 2. **Bounded and signed.** Between 10% and 30%, up or down. A book that only
 *    went up would make the product look expensive; one that only went down would
 *    make it look like a bargain the customer later discovers is not real.
 *
 * Everything else is copied verbatim: dimensions, coverage, span tables, colour
 * names. Only money moves. The BOM's quantities come from the geometry tables, so
 * a mock that also changed those would be testing a different building.
 *
 * Usage:
 *   npx tsx scripts/make-mock-price-book.ts [--out <dir>] [--min 10] [--max 30]
 */

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const args = process.argv.slice(2);

/**
 * The workspace root, so `--from`/`--out` defaults mean the same thing however
 * this script is invoked.
 *
 * In the original single-app repository the script could assume `cwd` was the app.
 * It now lives in a workspace package, so a run from `packages/core` would look
 * for the dump in `packages/core/tools`, find nothing, and fail with a message
 * telling the reader to run a dumper that had already been run.
 */
function workspaceRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const cut = dir.lastIndexOf(sep);
    if (cut <= 0) return process.cwd();
    dir = dir.slice(0, cut);
  }
}

const root = workspaceRoot();

/** A flag's value, or the fallback. */
function arg(name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}

const sourceDir = resolve(root, arg('--from', 'tools/price-dump/out'));
const outDir = resolve(root, arg('--out', 'tools/price-dump/mock'));
const minPct = Number(arg('--min', '10'));
const maxPct = Number(arg('--max', '30'));

if (!existsSync(sourceDir)) {
  console.error(`No dump at ${sourceDir}. Run tools/price-dump/run.sh first.`);
  process.exit(2);
}
if (!(minPct > 0 && maxPct >= minPct)) {
  console.error('--min and --max must be positive, with --max at least --min.');
  process.exit(2);
}

/**
 * The adjustment for one row, as a signed fraction between `min` and `max`.
 *
 * Derived from the table name and the row's own identity, so it is stable across
 * runs and across machines. `sha256` rather than `Math.random`: a random book
 * would give a different price every time it was rebuilt, and a customer
 * comparing two demos would see the same shed at two prices.
 */
function adjustment(table: string, row: Record<string, unknown>, min: number, max: number): number {
  // The identity is the row's own values, not its position: a row inserted above
  // it in a later dump must not change this row's price.
  const identity = [
    row.code ?? row.grade ?? row.description ?? row.option_name ?? row.name ?? '',
    row.size ?? row.diameter ?? '',
    row.color ?? row.colour ?? '',
    row.state ?? '',
  ].join('|');

  const digest = createHash('sha256').update(`${table}\u0000${identity}`).digest();
  // Two independent draws: one picks a magnitude, the other a direction. Using
  // one number for both would correlate "how much" with "which way".
  const magnitude = min + (digest[0] / 255) * (max - min);
  const up = digest[1] % 2 === 0;
  return (up ? 1 : -1) * (magnitude / 100);
}

/** The columns that hold money, per table, so nothing else is touched. */
const PRICE_COLUMNS: Record<string, string[]> = {
  cost_apex: ['cost'],
  cost_bolt: ['cost', 'cost_pack'],
  cost_bracing: ['cost'],
  cost_bracket: ['cost'],
  cost_frame: ['cost'],
  cost_haunch: ['cost'],
  cost_purlin: ['cost'],
  cost_sheeting: ['cost'],
  cost_window: ['cost'],
  downpipe: ['downpipe_price'],
  flashing: ['flashing_price'],
  gutter: ['gutter_price'],
  misc_option: ['price'],
  padoor: ['padoor_price_zinc', 'padoor_price_color'],
  purlin: ['purlin_price'],
  rdoor_parts: ['rdoor_parts_price'],
  roller_door: ['price_zinc', 'price_color'],
  screws: ['screws_price', 'screw_price_pack'],
  skylight: ['price'],
  sliding_door: ['sld_price', 'sld_price_endwall', 'sld_price_sidewall', 'sld_price_endwall_hangar'],
  view_cost_sheeting: ['cost'],
  view_cost_window: ['cost'],
};

/**
 * Columns that look like money but must **not** move.
 *
 * `setting_price_coeffcient.price_coeffcient` is a margin multiplier, not a
 * price. Scaling it would compound with the price change and put the demo's totals
 * somewhere nobody intended.
 */
const NOT_A_PRICE = new Set(['setting_price_coeffcient']);

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let tablesChanged = 0;
/**
 * Columns that carry a supplier's product code, per table.
 *
 * ## Why these are scrambled, not copied
 *
 * A code like `FBI15403` is a distributor's SKU. Anyone in the Australian shed
 * trade reads the prefix and knows whose catalogue it is — so a demo that shows
 * real codes hands out the supplier's identity along with the workflow. The
 * prices were already moved 10–30%; the codes have to move too, or the book is
 * still a copy of somebody's catalogue with a sticker over the price.
 *
 * ## Why the mapping preserves sort order
 *
 * The lookup uses a code as a **tie-break** in fourteen `ORDER BY` clauses
 * (`ORDER BY width, height, rdoor_code`). Scrambling codes into arbitrary strings
 * would change which of two equally-sized rows wins, and the demo would quote a
 * different door than the real book does — the mock would be testing a different
 * building, which is the one thing it must not do.
 *
 * So the replacement keeps each code's position in the sorted order of that
 * column: the *n*-th smallest code becomes `DEMO-0001`, the next `DEMO-0002`.
 * Every `ORDER BY code` therefore produces the same sequence as before.
 */
const CODE_COLUMNS: Record<string, string[]> = {
  cost_apex: ['code'],
  cost_bolt: ['code'],
  cost_bracing: ['code'],
  cost_bracket: ['code'],
  // `cost_frame` carries a second code column beside `code`. It was found by
  // grepping the built book for a real SKU after the first pass, which is the only
  // way this kind of omission shows up: the column is not named in any query, so
  // nothing failed — the book simply still contained a supplier's code.
  cost_frame: ['code', 'plain_code'],
  cost_haunch: ['code'],
  cost_purlin: ['code'],
  cost_sheeting: ['code'],
  cost_window: ['code'],
  material_window: ['code'],
  downpipe: ['downpipe_product_code'],
  flashing: ['flashing_product_code'],
  gutter: ['gutter_product_code'],
  misc_option: ['product_code'],
  padoor: ['padoor_product_code'],
  purlin: ['purlin_product_code'],
  rdoor_parts: ['rdoor_parts_code'],
  // A roller door carries its painted variant's code in a second column —
  // `rdoor_code_color` beside `rdoor_code` — because the two finishes are two
  // catalogue items. Both are the supplier's.
  roller_door: ['rdoor_code', 'rdoor_code_color'],
  screws: ['screws_product_code'],
  // Named `skylight_productCode`, not `..._code`: the dump uses camel case in this
  // one table, which is why a scan by pattern found it and a review by eye did not.
  skylight: ['skylight_productCode'],
  sliding_door: ['sld_code'],
  view_cost_sheeting: ['code'],
  view_cost_window: ['code'],
};

/**
 * A placeholder for the *n*-th distinct code of a column.
 *
 * Fixed width and a leading letter, so the strings sort the way the numbers do —
 * `DEMO-0002` before `DEMO-0010` — which is what keeps a tie-break stable.
 */
function placeholder(index: number): string {
  return `DEMO-${String(index + 1).padStart(4, '0')}`;
}

/**
 * Replace every code in `column` with a placeholder, preserving sort order.
 *
 * A blank code stays blank: `gutter` has 621 rows with no product code at all, and
 * inventing one there would change which rows the catalogue lists as distinct.
 */
function scrambleCodes(rows: Record<string, unknown>[], column: string): number {
  const present = rows
    .map((row) => row[column])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '');

  if (present.length === 0) return 0;

  const ordered = [...new Set(present)].sort();
  const mapping = new Map<string, string>();
  ordered.forEach((code, index) => mapping.set(code, placeholder(index)));

  let changed = 0;
  for (const row of rows) {
    const value = row[column];
    if (typeof value !== 'string' || value.trim() === '') continue;
    row[column] = mapping.get(value) ?? value;
    changed++;
  }
  return changed;
}

let codesChanged = 0;
let valuesChanged = 0;

for (const file of readdirSync(sourceDir).filter((name) => name.endsWith('.json')).sort()) {
  const table = file.slice(0, -5);
  const rows = JSON.parse(readFileSync(join(sourceDir, file), 'utf8')) as unknown;

  if (!Array.isArray(rows)) {
    // A meta file, copied as-is.
    writeFileSync(join(outDir, file), JSON.stringify(rows));
    continue;
  }

  /**
   * Codes are scrambled for **every** table that carries one, including tables
   * with no price column. A code leaks the supplier whether or not it sits beside
   * a number.
   */
  const codeColumns = CODE_COLUMNS[table] ?? [];
  for (const column of codeColumns) {
    codesChanged += scrambleCodes(rows as Record<string, unknown>[], column);
  }

  const columns = NOT_A_PRICE.has(table) ? [] : (PRICE_COLUMNS[table] ?? []);
  if (columns.length === 0) {
    writeFileSync(join(outDir, file), `${JSON.stringify(rows)}\n`);
    continue;
  }

  let touched = false;
  for (const row of rows as Record<string, unknown>[]) {
    const factor = 1 + adjustment(table, row, minPct, maxPct);
    for (const column of columns) {
      const value = row[column];
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
      // Four decimals, like the source: a price book's precision, not a float's.
      row[column] = Math.round(value * factor * 10000) / 10000;
      valuesChanged++;
      touched = true;
    }
  }

  if (touched) tablesChanged++;
  writeFileSync(join(outDir, file), `${JSON.stringify(rows)}\n`);
}

// Anything that is not JSON (a README, a summary) is copied so the dump is whole.
for (const file of readdirSync(sourceDir).filter((name) => !name.endsWith('.json'))) {
  cpSync(join(sourceDir, file), join(outDir, file));
}

/**
 * Mark the dump as a sample.
 *
 * The importer reads this file and records `book_kind = 'sample'` in the
 * published book. That flag is what lets the demo show a read-only price list to
 * a stranger: showing one is only safe while the book is a sample, and a
 * directory named `mock` is a convention rather than a guarantee.
 *
 * A file **inside the dump**, rather than a flag passed to the importer, because
 * the dump is what gets copied between machines — the marking has to travel with
 * it.
 */
writeFileSync(
  join(outDir, 'BOOK_KIND.json'),
  `${JSON.stringify(
    {
      kind: 'sample',
      note: 'Prices moved 10-30% from the licensed supplier book. Not for quoting a customer.',
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

console.log(`Wrote the mock book to ${outDir}`);
console.log(`  ${tablesChanged} tables repriced, ${valuesChanged} values moved by ${minPct}–${maxPct}%`);
console.log(`  ${codesChanged} product codes replaced with placeholders`);
console.log('\nPublish it with:');
console.log(`  npx tsx scripts/import-price-book.ts ${outDir}`);
