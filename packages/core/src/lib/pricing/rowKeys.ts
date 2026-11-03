/**
 * How one price-book row is identified, and how that identity is written.
 *
 * A company's price override names **one row** of the supplier's catalogue. That
 * sounds simple and is not: the book has no single key column. `gutter` has 824
 * rows and **621 of them have no product code at all**; `cost_sheeting` reuses
 * the code `CO35` for 24 different colours; `material_window` writes `#N/A` as
 * its code. A code-only key would collapse those rows into one, and an override
 * would silently apply to the wrong items.
 *
 * So each source declares its own natural key, and this module is the **only**
 * place that knows it. Two callers depend on that being one place:
 *
 *   - the catalogue API, which lists rows for an operator to price, and
 *   - the lookup, which has to recognise the row it just returned.
 *
 * If those two computed the key differently, an override would be stored under
 * one string and looked for under another: it would save successfully and do
 * nothing. `rowKeys.test.ts` compares the two paths against the real book for
 * exactly that reason.
 *
 * ## The key format
 *
 * `<source>:<field>=<value>&<field>=<value>…`, fields in the declared order,
 * values percent-encoded. Stable across books as long as the identity columns
 * are stable, readable in a database dump, and unambiguous because a separator
 * that appears inside a value is escaped.
 *
 * The key deliberately contains **no row id**. A published book is
 * content-addressed and a new publication renumbers `id`; a key built on `id`
 * would survive the row and die with the book.
 */

/** A price-book table whose rows a company may price itself. */
export interface CatalogueSource {
  /** The `source` in a row key. Also the table name, which is not accidental. */
  source: string;
  /** What an operator sees in the table filter. */
  label: string;
  /** The unit the row's price is per, for the UI. */
  unit: 'm' | 'sqm' | 'ea' | 'pack' | 'roll';
  /** Columns that identify one row, in the order they appear in the key. */
  identity: string[];
  /** The column an operator recognises the row by, for the catalogue list. */
  codeColumn: string | null;
  /** The column with the human description, for the catalogue list. */
  descriptionColumn: string;
  /** The column holding the price, in the book's dollars. */
  priceColumn: string;
  /**
   * Restricts the catalogue to rows the lookup can actually reach.
   *
   * `gutter` holds gutters, brackets, stop ends and outlets in one table; the
   * lookup only ever reads `GUTTER` and `GUTTER_BRACKET`. Listing the other rows
   * would offer an operator a price box whose value never reaches a quote.
   */
  filter?: string;
}

/**
 * Every source a company can price, and how it is identified.
 *
 * Verified unique against the real book by `rowKeys.test.ts`, which is the only
 * honest way to know: three of these needed two attempts to get right, and
 * `downpipe` looked unique on a four-column key until the colour was added.
 */
export const CATALOGUE_SOURCES: CatalogueSource[] = [
  {
    source: 'cost_frame',
    label: 'Frame sections',
    unit: 'm',
    // `code` alone repeats for two Duragal variants of the same section.
    identity: ['code', 'description'],
    codeColumn: 'code',
    descriptionColumn: 'description',
    priceColumn: 'cost',
  },
  {
    source: 'cost_purlin',
    label: 'Purlins and girts',
    unit: 'm',
    identity: ['code', 'description'],
    codeColumn: 'code',
    descriptionColumn: 'description',
    priceColumn: 'cost',
  },
  {
    /**
     * Girt material, when a book sells it apart from the purlin.
     *
     * Declared even though the reference book has no such table, so that a company
     * which *does* price girts separately can override and re-price those rows. A
     * source left out of this list is a source whose rows cannot be addressed by an
     * override at all: the override saves, and every quote quietly keeps using the
     * purlin's price.
     */
    source: 'cost_girt',
    label: 'Wall girts',
    unit: 'm',
    identity: ['code', 'description'],
    codeColumn: 'code',
    descriptionColumn: 'description',
    priceColumn: 'cost',
  },
  {
    source: 'view_cost_sheeting',
    label: 'Sheeting',
    unit: 'm',
    // One code per profile, one row per colour and thickness.
    identity: ['code', 'colour_name', 'bmt'],
    codeColumn: 'code',
    descriptionColumn: 'description',
    priceColumn: 'cost',
  },
  {
    source: 'gutter',
    label: 'Gutter and brackets',
    unit: 'm',
    // Most gutter rows have no product code, so size and finish are the identity.
    identity: ['gutter_size', 'state', 'color', 'gutter_type'],
    codeColumn: 'gutter_product_code',
    descriptionColumn: 'gutter_size',
    priceColumn: 'gutter_price',
    filter: "gutter_type IN ('GUTTER','GUTTER_BRACKET')",
  },
  {
    source: 'misc_option',
    label: 'Miscellaneous options',
    unit: 'ea',
    // The table has no unique code — 125 rows, many with an empty product code —
    // so the name is the identity. It is also how the lookup finds a row.
    identity: ['option_name'],
    codeColumn: 'product_code',
    descriptionColumn: 'option_name',
    priceColumn: 'price',
  },
  {
    source: 'flashing',
    label: 'Flashing',
    unit: 'm',
    identity: ['flashing_type', 'flashing_size', 'flashing_color'],
    codeColumn: 'flashing_product_code',
    descriptionColumn: 'flashing_size',
    priceColumn: 'flashing_price',
  },
  {
    source: 'downpipe',
    label: 'Downpipes',
    unit: 'm',
    // Size, kind and type are not enough: the colour and the state separate rows.
    identity: ['downpipe_size', 'downpipe_kind', 'downpipe_type', 'state', 'downpipe_color'],
    codeColumn: 'downpipe_product_code',
    descriptionColumn: 'downpipe_size',
    priceColumn: 'downpipe_price',
  },
  {
    source: 'screws',
    label: 'Screws',
    unit: 'pack',
    identity: ['screws_product_code', 'screws_type', 'screws_size', 'screws_color'],
    codeColumn: 'screws_product_code',
    descriptionColumn: 'screws_size',
    priceColumn: 'screw_price_pack',
  },
  {
    source: 'cost_bolt',
    label: 'Bolts',
    unit: 'pack',
    identity: ['code', 'description'],
    codeColumn: 'code',
    descriptionColumn: 'description',
    priceColumn: 'cost_pack',
  },
  {
    source: 'cost_bracket',
    label: 'Brackets',
    unit: 'ea',
    identity: ['code', 'description'],
    codeColumn: 'code',
    descriptionColumn: 'description',
    priceColumn: 'cost',
  },
  {
    source: 'cost_bracing',
    label: 'Bracing',
    unit: 'roll',
    identity: ['code'],
    codeColumn: 'code',
    descriptionColumn: 'description',
    priceColumn: 'cost',
  },
  {
    source: 'padoor',
    label: 'Personal access doors',
    unit: 'ea',
    // Two rows share a code, colour and angle but differ in width.
    identity: ['padoor_product_code', 'padoor_color', 'padoor_angle', 'width'],
    codeColumn: 'padoor_product_code',
    descriptionColumn: 'padoor_name',
    priceColumn: 'padoor_price_zinc',
  },
  {
    source: 'roller_door',
    label: 'Roller doors',
    unit: 'ea',
    identity: ['rdoor_code'],
    codeColumn: 'rdoor_code',
    descriptionColumn: 'rdoor_name',
    priceColumn: 'price_zinc',
  },
  {
    source: 'sliding_door',
    label: 'Sliding doors',
    unit: 'ea',
    identity: ['sld_id'],
    codeColumn: 'sld_code',
    descriptionColumn: 'sld_size',
    priceColumn: 'sld_price',
  },
  {
    source: 'cost_window',
    label: 'Windows',
    unit: 'ea',
    // The price lives on `cost_window` (one row per colour), not on the size
    // table, so the window's own id would identify the size and not the price.
    identity: ['id'],
    codeColumn: null,
    descriptionColumn: 'lyves_code',
    priceColumn: 'cost',
  },
];

/** The source declarations by name, for a lookup that has a table in hand. */
export const SOURCE_BY_NAME: Record<string, CatalogueSource> = Object.fromEntries(
  CATALOGUE_SOURCES.map((entry) => [entry.source, entry]),
);

/** A key component: a column name and the value the row held. */
export type KeyPart = [field: string, value: unknown];

/**
 * Build a row key from a source and its identity values.
 *
 * A missing value becomes the empty string rather than the word `null`: a gutter
 * row with no state and a row whose state is the text `null` are different rows,
 * and the book contains the former.
 */
export function buildRowKey(source: string, parts: KeyPart[]): string {
  const encoded = parts
    .map(([field, value]) => `${encodeURIComponent(field)}=${encodeURIComponent(stringify(value))}`)
    .join('&');
  return `${source}:${encoded}`;
}

/** A database value as the text a key stores. */
function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    // A REAL price or thickness prints the same on every platform this runs on;
    // `1.5` must not become `1.5000000000000002` and stop matching.
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
  }
  return String(value);
}

/**
 * The row key for a row, using the source's declared identity columns.
 *
 * `row` is a raw database row, so the columns are the book's own names.
 */
export function rowKeyOf(source: string, row: Record<string, unknown>): string {
  const declared = SOURCE_BY_NAME[source];
  if (declared === undefined) throw new Error(`Unknown price source: ${source}`);
  return buildRowKey(
    source,
    declared.identity.map((field): KeyPart => [field, row[field]]),
  );
}

/**
 * The source and identity of a row key, for diagnostics and for the orphan check.
 *
 * Returns `null` for a string this module did not build, so a hand-edited row in
 * the database cannot make the page throw.
 */
export function parseRowKey(key: string): { source: string; parts: Record<string, string> } | null {
  const colon = key.indexOf(':');
  if (colon <= 0) return null;
  const source = key.slice(0, colon);
  if (SOURCE_BY_NAME[source] === undefined) return null;

  const parts: Record<string, string> = {};
  for (const pair of key.slice(colon + 1).split('&')) {
    if (pair === '') continue;
    const equals = pair.indexOf('=');
    if (equals <= 0) return null;
    parts[decodeURIComponent(pair.slice(0, equals))] = decodeURIComponent(pair.slice(equals + 1));
  }
  return { source, parts };
}

/** A source declaration by name, or a throw naming what was asked for. */
export function requireSource(source: string): CatalogueSource {
  const declared = SOURCE_BY_NAME[source];
  if (declared === undefined) throw new Error(`Unknown price source: ${source}`);
  return declared;
}
