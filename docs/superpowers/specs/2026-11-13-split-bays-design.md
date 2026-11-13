# Split oversize bays in one click — short design (2026-11-13)

Review `docs/reviews/2026-11-13-quote-editor-overview.md` item 7, option C.

## Why
A building whose largest bay is above the price book's band cannot be saved (decision "Block saving"),
and that is right: the book has no members for it, so its price is not trustworthy. But an old quote in
that state (local DB: 46 quotes at 4 × 6000 mm against a 1000–4000 mm band) then needs a manual building
edit before even a customer-email fix can be saved. A new book that narrows the band will cause the same
thing again.

The desktop never produced such a bay: its Adjust bays rule sets `noBays = ceil(length / BayMax)`,
clamped to 2..30 (`ServiceStructureData.cs:309-324`). v2 has no equivalent.

## Goal / non-goals
- Goal: when the largest bay is above the book's max, offer one button that re-splits the length into the
  fewest equal bays that fit. The salesperson sees the new price (auto re-price, item 4) before saving.
- Non-goal: relaxing the save block (option B), or rewriting stored quotes (option D; revisions are
  immutable).
- Non-goal: bays **below** the min. Splitting cannot fix those, so no button appears.

## Approaches
- A: keep the rule, the person fixes bays by hand. No work, but a customer-only edit requires a building edit.
- B: allow saving an unchanged out-of-book building. This re-prices an untrustworthy building, which defeats the rule.
- **C (chosen):** a one-click split matching the desktop rule.
- D: bulk data fix. Rejected.

## Design
- **Core** (`packages/core/src/domain/bays.ts`): `baysToFit(length: number, maxBay: number): number`.
  It returns `ceil(length / maxBay)`, clamped by `clampBays` (2..30); for `length <= maxBay` it returns 2.
  This is the desktop rule verbatim.
- **Client:**
  - When the `shed-nomBaySpacing` issue is the "above the band" one (largest bay > `bounds.baySpacing.max`),
    the Shed group shows a button under that field's error: **"Split into N bays of X mm"**. N comes from
    `baysToFit`; X is `floor(length / N)`. The label states the result before the click.
  - Clicking it calls the existing `applyBays({ length, bays: N, nomBaySpacing: 0 })`. That is the same
    path as typing N in the Bays field, so length is kept, a per-bay array is discarded, and the
    "removes every option" confirm appears when options would be lost.
- **Example:** 24000 mm, 4 × 6000, band max 4000 → "Split into 6 bays of 4000 mm".
- **Docs:** add a reference § (Vietnamese) and mark item 7 as done in the review.

## Left to the builder / to verify
- **Remainder lengths** (e.g. 25000 → 7 × 3571 + remainder): the result must equal what typing 7 in Bays
  gives today. If typing a count itself raises "Spacing × bays ≠ length" on a remainder, that is a
  separate existing finding: report it, don't fix it here.
- Tests are opt-in (off). Self-verify on the test quote `8f0c1f05…` in the browser with saves stubbed:
  - the button appears with the label "Split into 6 bays of 4000 mm";
  - the click clears the issue and fires one `evaluate`;
  - Save becomes enabled.
