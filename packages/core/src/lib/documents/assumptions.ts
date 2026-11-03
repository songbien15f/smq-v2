/**
 * What a quote covers, in the company's own words.
 *
 * A customer is entitled to understand **what was allowed for** — the frame, the cladding, the
 * fixings — and the company must be able to say it in its own voice. So these are settings, not
 * constants.
 *
 * **They describe scope, not arithmetic.** No formula, no rate, no margin. A customer who reads
 * "sheets are counted for every roof plane" learns what the number covers; a competitor reading the
 * same line learns nothing about how the price is built. The rule for anyone editing them: say what
 * is included, never how it was calculated.
 */

/** One scope note: a heading and a paragraph, shown on the quote as written. */
export interface AssumptionNote {
  title: string;
  body: string;
}

/**
 * The starting set, written for an Australian shed buyer.
 *
 * Every sentence answers "what did you allow for?", and none states a rate, a formula or a
 * multiplier. These ship as the default for a company that has not written its own.
 */
export const DEFAULT_ASSUMPTIONS: AssumptionNote[] = [
  {
    title: 'Frame',
    body: 'The frame is priced from the supplier’s current book for the section nominated for this span and wind classification. A wider span or a higher wind rating calls for a heavier section, and the price reflects that.',
  },
  {
    title: 'Roof and wall cladding',
    body: 'Sheets are counted for every roof plane and every wall, allowing for the eaves and the ridge. Sheets are cut to the length each run needs, so a longer building or a steeper pitch means longer sheets rather than more of them.',
  },
  {
    title: 'Purlins, girts and bracing',
    body: 'Purlins and girts are spaced to what the cladding and the wind classification allow, and wind bracing is allowed for on the walls and in the roof plane. Openings that a brace cannot cross are taken into account.',
  },
  {
    title: 'Guttering, flashing and downpipes',
    body: 'Gutter runs the full length of each eave, with brackets, stop ends and a downpipe at each corner. Ridge capping, barge flashing, eave capping and corner flashing are included, finished in the colours selected on this quote.',
  },
  {
    title: 'Doors, windows and openings',
    body: 'Doors and windows are priced from the supplier’s catalogue at the nearest standard size that fits the opening. Door tracks, mullions and jamb flashing are included with the door.',
  },
  {
    title: 'Fixings',
    body: 'Structural bolts, brackets, screws and rivets are allowed for the whole building, supplied in the packs the supplier sells. Screw heads are colour matched to the sheeting they go through.',
  },
  {
    title: 'Site conditions',
    body: 'The building is priced for the wind region, terrain category and importance level stated on this quote. A site in a different classification, or a change of site, requires the quote to be reassessed.',
  },
  {
    title: 'What this quotation does not include',
    body: 'Unless stated on this quote: council fees and approvals, engineering certification for a specific site, slab and footings, erection labour, crane hire, site access works, and any variation requested after the order is placed.',
  },
  {
    title: 'Engineering review',
    body: 'Every quotation is subject to engineering review before release for manufacture. The review confirms the section sizes and the fixing details for the site; it does not change the scope described here.',
  },
];

/** True when every note has a heading and a body. */
export function isValidAssumptions(value: unknown): value is AssumptionNote[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as AssumptionNote).title === 'string' &&
      (entry as AssumptionNote).title.trim() !== '' &&
      typeof (entry as AssumptionNote).body === 'string' &&
      (entry as AssumptionNote).body.trim() !== '',
  );
}

/**
 * The notes to show for a company: its own when it has written any, the defaults otherwise.
 *
 * Never a mix, so a company that has edited them sees exactly what it wrote — and a company that has
 * never opened the settings screen still sends a quote that says what it covers. An empty list is
 * treated as "not written" rather than "nothing included", because a quote with no scope notes reads
 * as though nothing was allowed for.
 */
export function assumptionsFor(saved: unknown): AssumptionNote[] {
  return isValidAssumptions(saved) && saved.length > 0 ? saved : DEFAULT_ASSUMPTIONS;
}
