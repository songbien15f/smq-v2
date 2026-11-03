/**
 * Which of the engine's notes a customer may read, and how they are worded.
 *
 * ## Why this is a list rather than a filter
 *
 * The customer document used to print every issue whose severity was not
 * `warning`. The engine's messages are written for an operator: "No
 * structure-to-section table is loaded, so a wide portal is priced as light
 * steel", "the price book's unit for this material is read as pack, which the
 * book does not state". Printed on a quote, those sentences tell a customer the
 * number was guessed — which is worse than the number being approximate, because
 * it destroys the quote's credibility on every page it appears.
 *
 * So the split is explicit: a code either has customer wording here, or it is
 * internal and never reaches the document. **An unknown code is internal.** A new
 * issue code added by the engine must not leak by default; it has to be given a
 * customer sentence deliberately.
 *
 * ## What a customer is entitled to
 *
 * Not the engine's vocabulary, but the substance: that the frame section is
 * confirmed at engineering, that a footing allowance is included, that the
 * skylight is an allowance rather than a firm price. Those are facts about *this*
 * quote, and hiding them would be the opposite failure — a quote that looks
 * firmer than it is.
 *
 * The rule for the wording: say what is **included** and what happens **next**.
 * Never say what the software could not read.
 */

/**
 * Customer wording by issue code.
 *
 * `null` means "internal only". Written out rather than implied by omission, so a
 * reviewer can see the decision for every code the engine can emit.
 */
export const CUSTOMER_NOTE_BY_CODE: Record<string, string | null> = {
  // The frame section. A customer needs to know the section is confirmed at
  // engineering; they do not need to know a span table is missing from the
  // software.
  FRAME_SECTION_ASSUMED:
    'Frame members are priced as the standard section for this span and wind classification. Engineering review confirms the final section before manufacture.',

  // Footings. Same shape: what is allowed for, and what confirms it.
  FOOTING_ASSUMED:
    'A footing allowance is included in the price. The footing detail is confirmed at engineering review, before manufacture.',

  // A skylight priced as a roof sheet is a material difference in what is being
  // bought, so the customer must be told it is an allowance.
  SKYLIGHT_ASSUMED:
    'The skylight is included as an allowance. Its final price depends on the roof sheet and flashing it replaces, and is confirmed with the engineering detail.',

  // A mezzanine at a storage rate is the same kind of statement: an allowance,
  // not a firm price for a specific floor load.
  MEZZANINE_RATE_ASSUMED:
    'The mezzanine is priced as a light storage floor. A heavier floor load is quoted separately once the use is known.',

  // Wall girts priced from the roof purlin material. This one *is* printed: the
  // substitution changes what is being supplied, not merely how a price book row was
  // read. A girt carries wall loads and a purlin carries roof loads, and they are not
  // interchangeable sections — the same reasoning as the skylight and mezzanine
  // allowances above.
  GIRT_PRICE_FROM_PURLIN:
    'Wall girts are priced using the roof purlin section as an allowance. The final girt specification is confirmed with the engineering detail before manufacture.',

  // --- Internal. Never printed on a customer document. -------------------
  //
  // A substituted terrain row, an assumed unit of measure, or a mocked line are
  // all statements about the *price book*, not about the building. They belong in
  // the operator's deviation list, where somebody can act on them.
  TERRAIN_SUBSTITUTED: null,
  MOCKED_LINES: null,
  DOOR_ACCESSORIES_ASSUMED: null,
};

/**
 * The customer-facing sentence for an issue code, or `null` when it is internal.
 *
 * Codes that end in `UNIT_ASSUMED_` are internal by family: they describe how a
 * price-book row was interpreted, which is a data-quality note for the operator
 * and nothing a customer can act on.
 */
export function customerNoteFor(code: string): string | null {
  if (code.startsWith('UNIT_ASSUMED_')) return null;
  // `undefined` (an unknown code) is treated the same as an explicit `null`.
  // Safe by default: a new engine code must be given a sentence before it can
  // appear on a customer's document.
  return CUSTOMER_NOTE_BY_CODE[code] ?? null;
}

/** Whether an issue code is internal-only. Used by tests and the deviation list. */
export function isInternalCode(code: string): boolean {
  return customerNoteFor(code) === null;
}
