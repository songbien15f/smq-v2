/**
 * Wind region codes: what the certificate says, and what the price book is indexed by.
 *
 * ## The two questions, kept apart
 *
 * They look like the same question and are not:
 *
 *   "What does the certificate state?"   → `A5`, `A2`, `B1` — the document's own words.
 *   "Which rows of `devided` apply?"     → also `A5`, `A2`, … but only for the codes the book lists.
 *
 * This module is the only place that knows how the second follows from the first, so a quote can
 * print the certificate's code without the pricing path having to agree with it by accident.
 *
 * ## What the real data looks like
 *
 * Read from ShedSafe for all 47 buildings in the legacy licence database (2026-11-10):
 *
 * ```
 * "A1"  × 16    "A2" × 16    "A5" × 12    "B1" × 5
 * ```
 *
 * And from the reference price book's `devided` table:
 *
 * ```
 * A2 A3 A5 A6 B2 B3 B4 B5 B6 B7 C2 C3 C4 D2 D3 D4
 * ```
 *
 * Two things follow, and both matter:
 *
 * 1. **The book has no `A1` or `B1` rows.** Those sites exist and cannot be priced by this book, so
 *    the honest answer is "no rows" — which the frame path already turns into a labelled assumption.
 *    Inventing `A2` for `A1` would price a site the book was never asked about.
 * 2. **The codes are not interchangeable.** Measured on the reference book, `A2` gives a purlin span
 *    of 720 mm, `A5` gives 830 mm, `A6` gives 1 300 mm. Rewriting `A5` as `A2` is not a formatting
 *    difference; it is a smaller purlin at a shorter span than the certificate requires.
 */

/** The codes the reference book lists, for a UI that wants to offer a list. */
export const KNOWN_WIND_REGIONS = [
  'A1',
  'A2',
  'A3',
  'A5',
  'A6',
  'A7',
  'B1',
  'B2',
  'B3',
  'B4',
  'B5',
  'B6',
  'B7',
  'C1',
  'C2',
  'C3',
  'C4',
  'D2',
  'D3',
  'D4',
] as const;

/** The four AS/NZS 1170.2 regions, which is what a bare letter means. */
const BARE_REGIONS = ['A', 'B', 'C', 'D'] as const;
type BareRegion = (typeof BARE_REGIONS)[number];

/**
 * The region letter, or `null` when the code does not start with one.
 *
 * `"A5"` → `"A"`. `"a5"` → `"A"`. `"W41"` → `null` (an obsolete code the desktop's own notes warn
 * about), and `""` → `null`.
 */
export function windRegionLetter(code: string | null | undefined): BareRegion | null {
  const first = (code ?? '').trim().toUpperCase().charAt(0);
  return (BARE_REGIONS as readonly string[]).includes(first) ? (first as BareRegion) : null;
}

/**
 * The `devided` lookup key for a site.
 *
 * ## Order of preference
 *
 * 1. **A code the book lists, used unchanged.** `A5` stays `A5`. This is the case that matters: the
 *    certificate is specific and the book is specific, and they use the same vocabulary.
 * 2. **A bare region combined with a terrain digit.** `A` + terrain 2.5 → `A4` on a book that
 *    carries `A4` rows. This is the desktop's mapping
 *    (`getTerrainCategoryForDevided`: 2.5 → `4`, 2 → `2`, 3 → `3`), and it is used only when the
 *    stored value is a bare letter — a quote typed by hand before this field came from a certificate.
 * 3. **Anything else: returned as-is.** An unknown code that the book does not list has no rows, and
 *    the caller reports an assumption. Substituting a nearby code here would price a different site.
 *
 * The terrain digit mapping is the desktop's, deliberately: 2.5 m becomes code 4 on the books that
 * have it. This build keeps that mapping *and* keeps a deviation note, because the reference book has
 * no `A4` rows at all and the desktop's own mapping therefore finds nothing there.
 */
export function windRegionCode(
  region: string | null | undefined,
  terrainCategory: number,
  bookCodes?: readonly string[],
): string {
  const code = (region ?? '').trim().toUpperCase();

  /*
   * An empty region is **not** a bare region.
   *
   * `""` means the field was never filled, and filling it here would price a site from a wind region
   * nobody entered. It is returned empty so the lookup misses and the frame reports an assumption —
   * which is the caller's decision to state, not this function's to hide. Note the difference from
   * `DEFAULT_SHED.windRegion`, which is `A`: a quote that *has* a default says so on screen.
   */
  if (code === '') return '';

  if (isSpecificCode(code)) return code;

  const letter = windRegionLetter(code);
  if (letter === null) {
    /*
     * Not a region at all — an obsolete `W41`, a typo. Returned unchanged so the lookup misses and
     * the frame reports why. Substituting a nearby code here would price a different site.
     */
    return code;
  }

  const terrain = terrainDigit(terrainCategory);
  const combined = `${letter}${terrain}`;

  if (bookCodes === undefined) return combined;

  /* The exact combination, when the book lists it — the normal case. */
  if (bookCodes.includes(combined)) return combined;
  /* A book indexed by region alone (some are) still prices from a bare letter. */
  if (bookCodes.includes(letter)) return letter;

  /*
   * The book has the region but not this terrain digit.
   *
   * This is real and it is why `A4` exists in the mapping but not in the reference book: the desktop
   * numbers terrain 2.5 as `4`, and the book ships `A2`, `A3`, `A5`, `A6` — no `A4` at all. Returning
   * `A4` there makes the lookup miss and the whole frame fall back to an assumed section, which is how
   * a `terrainCategory: 2.5` quote (a very common Australian case) ended up unpriced.
   *
   * So the nearest listed digit **within the same region** is used, and the choice is an assumption
   * the caller can report. Nearest rather than lowest: it is the smaller change to the design, and
   * for terrain 2.5 the neighbours 3 and 5 bracket it.
   */
  const sameRegion = bookCodes
    .filter((code) => windRegionLetter(code) === letter)
    .map((code) => ({ code, digit: Number(code.slice(1)) }))
    .filter((entry) => Number.isFinite(entry.digit));
  if (sameRegion.length === 0) return combined;

  const target = Number(terrain);
  let best = sameRegion[0] as { code: string; digit: number };
  for (const entry of sameRegion) {
    if (Math.abs(entry.digit - target) < Math.abs(best.digit - target)) best = entry;
  }
  return best.code;
}

/** True when the code carries a terrain digit of its own — `A5`, `B1`, `C4`. */
function isSpecificCode(code: string): boolean {
  return /^[A-D]\d+$/.test(code);
}

/**
 * The desktop's terrain → code digit mapping.
 *
 * 2 → `2`, 2.5 → `4`, 3 → `3`. The desktop writes `2.5` as `4` because the tables were numbered that
 * way; a value outside the three (a fractional terrain from a certificate, e.g. `2.68`) rounds to the
 * nearest known category first, so it lands on a row that exists rather than generating `A3` from a
 * number the book never heard of.
 */
export function terrainDigit(terrainCategory: number): string {
  if (!Number.isFinite(terrainCategory)) return '2';
  if (terrainCategory >= 2.9) return '3';
  if (terrainCategory >= 2.2) return '4';
  return '2';
}

/**
 * The nearest terrain category the book lists, for a certificate that reports a fraction.
 *
 * ShedSafe answers `2.68` and `2.92`; the book's terrain list is `2`, `2.5` and `3`. Storing the
 * certificate's fraction would make every lookup miss, so it is snapped — and the quote records the
 * snapped value, because that is the one it was priced from.
 *
 * ## Bounds live in the schema, not here
 *
 * This function snaps anything to one of three values, including rubbish: `9` becomes `3`. That is
 * fine **because it is never called on rubbish** — `terrainCategorySchema` refuses a value outside
 * 1–4 with a `.refine` before this runs, and the tolerant schema's `.catch()` then applies the
 * documented default. Keeping the refusal in one place means the two callers cannot disagree about
 * what is plausible.
 */
export function nearestTerrainCategory(value: number): 2 | 2.5 | 3 {
  const options: readonly (2 | 2.5 | 3)[] = [2, 2.5, 3];
  if (!Number.isFinite(value)) return 2;
  let best: 2 | 2.5 | 3 = 2;
  for (const option of options) {
    if (Math.abs(option - value) < Math.abs(best - value)) best = option;
  }
  return best;
}
