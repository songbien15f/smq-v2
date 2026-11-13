# Split oversize bays — Implementation Plan

> **For agentic workers:** executed Native (inline), per the user's "Duyệt, làm luôn".

**Goal:** One button that re-splits a building whose largest bay is above the book's band into the fewest equal bays that fit.

**Architecture:** A pure rule in core (`baysToFit`). The Shed group shows the button under the `shed-nomBaySpacing` error, and the click goes through the existing `applyBays` path.

**Tech Stack:** TypeScript, React (Next.js client), `@sq/core`.

**Spec:** `docs/superpowers/specs/2026-11-13-split-bays-design.md`

## Global Constraints
- Rule copied verbatim from the desktop: `ceil(length / maxBay)` clamped 2..30; `length <= maxBay` → 2 (`ServiceStructureData.cs:309-324`).
- Button copy: `Split into N bays of X mm`, where X = `floor(length / N)`.
- Tests are opt-in (off): self-verify with typecheck, the existing suites, and a browser run with saves stubbed. Never save quote `8f0c1f05…`.
- After editing core, rebuild it (`pnpm build:inc`): apps read `dist`.

## Review Focus
- A bay **below** the min: no button.
- A remainder length (e.g. 25000): the result equals what typing N in Bays gives.
- Options placed: the "removes every option" confirm still asks; cancelling leaves the building unchanged.
- Uneven bays where one bay is too big: the split resets to equal bays.
- No book band (`bounds.baySpacing === null`): no button.

---

### Task 1: `baysToFit` in core
**Files:** Modify `packages/core/src/domain/bays.ts` (after `clampBays`).
**Produces:** `export function baysToFit(length: number, maxBay: number): number`, exported through `@sq/core/domain`. Check that the domain index re-exports `bays.ts` with `export *`.
- [ ] Implement it with a doc comment citing the desktop lines.
- [ ] `pnpm --filter @sq/core typecheck`, then `pnpm build:inc`. Expected: clean.

### Task 2: Split button in the Shed group
**Files:** Modify `apps/client/src/components/editor/details/ShedGroup.tsx` (under the `shed-nomBaySpacing` error, around `:582`).
**Consumes:** `baysToFit`, `largestBay` (`../bookBounds`), `bookBounds(catalogue, span).baySpacing`, and `applyBays` from `useShedDimensions`.
- [ ] Show the button only when all of these hold:
  - `config.length !== null`;
  - the book band is non-null;
  - `largestBay(config).mm > band.max`.
- [ ] On click, call `applyBays({ length, bays: N, nomBaySpacing: 0 })`.
- [ ] `pnpm --filter @sq/client typecheck` and `pnpm --filter @sq/client test`. Expected: clean, 66/66.

### Task 3: Verify and document
- [ ] Browser check on `/quotes/8f0c1f05…/edit` with `POST /api/sq/quotes` stubbed:
  - the label reads `Split into 6 bays of 4000 mm`;
  - the click clears the bay issue and sends one `evaluate`;
  - Save is enabled.
- [ ] Remainder check: compare against typing 7 bays at length 25000.
- [ ] Reference § in `docs/smartquote-quote-editor-reference.md`; mark review item 7 done.
