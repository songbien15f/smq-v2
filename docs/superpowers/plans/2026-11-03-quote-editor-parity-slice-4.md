# Quote editor parity — Implementation plan, slice 4

**Goal:** the placement rules the desktop applies when a door is put on a wall, plus removal cascade and the wipe that follows a dimension change.

**Spec:** `docs/superpowers/specs/2026-11-03-quote-editor-parity-design.md` §6.

## Model gap (recorded)

v2 has no infill-column or roof-sheet grid model, so three desktop rules cannot be
implemented faithfully and are **not** faked:

- **R3 infill column** and **R5 infill ±250 / cleanup 750–450** — no column model.
- **R11 track segments 1000–6000** — the track is a door property, not a length.
- **R12 skylight snap to roof sheets** — no sheet grid; skylights anchor to a bay fraction.

`R9 "two empty side walls"` is also deferred: the desktop's own note says the rule's
wording is imprecise, and a wrong version blocks the first door on a shed. It returns
in slice 7 with the category dock, where the operator can see why a wall is refused.

## Task 1: `placementRules.ts`

**Files:** `packages/core/src/domain/placementRules.ts` (new); test
`packages/core/src/domain/__tests__/placementRules.test.ts`.

- `OpeningPlacement` result: `{ok, opening}` | `{refused, reason}` | `{proposals: {label, opening}[]}`.
- `placeOpening(request, shed)` — R10 roller minimum (height 2000, width 1000) as a
  resize proposal; R1 100 mm wall margin; R2 overlap with an opening on the same wall
  as a left/right proposal; otherwise ok.
- `carryBeamRefusal(shed)` — R7: refuse when the wall run (span) exceeds 15 000 mm.
- `removeOpeningWithCascade(id, shed)` — clears `carry_beam.openingId` that pointed at it.
- `removeOptionWithCascade(id, shed)`.
- `wipeOptions(shed)` — drops every option, keeps openings and charges.
- `shouldWipeOptions(before, after)` — true when options exist and span, height, pitch
  or bay count changed.

## Task 2: wire the refusal

**Files:** `packages/core/src/domain/optionRules.ts` (carry-beam case), `apps/client/src/store/useShedStore.ts`.

- `refusePlacement('carry_beam', shed)` uses `carryBeamRefusal`.
- The store's `addOpening` runs `placeOpening` and applies a proposal's opening when the
  caller passes one; the plain add still refuses with the sentence.
