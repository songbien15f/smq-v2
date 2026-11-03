/**
 * How a product name is reduced to what a person means by it.
 *
 * Two callers need the *same* answer, and if they disagreed an item would import
 * successfully and never be found again:
 *
 *   - the spreadsheet importer, which decides whether two rows name one item;
 *   - the company catalogue, which has to answer the engine when it asks for
 *     `115 Quad` and the customer's sheet said `115-Quad`.
 *
 * It lives in its own module because `excel.ts` imports the catalogue (for the
 * group units) and the catalogue needs this — importing it from `excel.ts` would
 * close a cycle.
 *
 * Case, surrounding space, repeated space and punctuation between words are all
 * noise in a spreadsheet: `115 Quad`, `115  quad` and `115-Quad` are one gutter.
 * What is **not** noise is a word, so nothing is dropped: `C15024` and
 * `C15024 Duragal` stay different products at different prices.
 */
export function normaliseDescription(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
