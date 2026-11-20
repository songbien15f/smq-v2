import { describe, expect, it } from 'vitest';
import {
  GUEST_DEFAULT_TYPES,
  guestDesignFromType,
  refitGuestOpenings,
  resizeGuestOpening,
  validateGuestDesign,
  type GuestBuildingTypeSpec,
  type GuestDesignInput,
} from '../guest';
import { applyGuestOps } from '../guestOps';

/**
 * Openings stay legal after every change (plan `guest-opening-placement`, follow-ups Task A).
 *
 * The fixture is the Riding Arena the other guest tests use: 15 m span, 8 × 3750 bays (a 30 m long
 * wall), a 5100 × 3600 roller door on the front wall and 3000 × 2100 doors on the left and right
 * walls, both centred at 13500 of 30000.
 */
const type = (id: string): GuestBuildingTypeSpec => {
  const found = GUEST_DEFAULT_TYPES.find((t) => t.id === id);
  if (found === undefined) throw new Error(`no type ${id}`);
  return found;
};

const arena = type('riding_arena');
const garage = type('garage');

/** The Riding Arena with a side door on each long wall, as the fixture describes it. */
function arenaWithSideDoors(): GuestDesignInput {
  const base = guestDesignFromType(arena);
  return {
    ...base,
    openings: [
      ...base.openings,
      { type: 'roller_door', wall: 'left', offset: 13500, size: { width: 3000, height: 2100 }, motorised: false },
      { type: 'roller_door', wall: 'right', offset: 13500, size: { width: 3000, height: 2100 }, motorised: false },
    ],
  };
}

/** Problems the checks find *about openings* — what "needs attention" on step ② is made of. */
const openingProblems = (design: GuestDesignInput, t: GuestBuildingTypeSpec) =>
  validateGuestDesign(design, t).filter((issue) => issue.path.startsWith('openings'));

describe('applyGuestOps keeps openings legal when the building changes', () => {
  it('slides both side doors in when four bays are removed', () => {
    const start = arenaWithSideDoors();
    const result = applyGuestOps(start, arena, [
      { op: 'removeBay', index: 0 },
      { op: 'removeBay', index: 0 },
      { op: 'removeBay', index: 0 },
      { op: 'removeBay', index: 0 },
    ]);

    // 30 m of wall becomes 15 m; a 3000 mm door needs 100 mm at the far end, so 15000 − 3000 − 100.
    expect(result.applied).toBe(4);
    expect(result.failures).toEqual([]);
    expect(result.design.building.bayWidths).toHaveLength(4);
    expect(result.design.openings[1]?.offset).toBe(11900);
    expect(result.design.openings[2]?.offset).toBe(11900);
    expect(openingProblems(result.design, arena)).toEqual([]);
  });

  it('re-centres a door resized to a bigger chip on the same wall', () => {
    const start = arenaWithSideDoors();
    const result = applyGuestOps(start, arena, [
      { op: 'resizeOpening', index: 1, size: { width: 5100, height: 3600 } },
    ]);

    expect(result.applied).toBe(1);
    expect(result.failures).toEqual([]);
    // Wanted = 13500 + (3000 − 5100) / 2 = 12450, which is also the centre of 5100 on a 30000 wall.
    expect(result.design.openings[1]?.offset).toBe(12450);
    expect(result.design.openings[1]?.size).toEqual({ width: 5100, height: 3600 });
    expect(openingProblems(result.design, arena)).toEqual([]);
  });

  it('accepts the size change and reports a door that fits nowhere, rather than leaving it silently illegal', () => {
    const start = arenaWithSideDoors();
    const result = applyGuestOps(start, arena, [{ op: 'setSpan', mm: 1800 }]);

    // The guest asked for the width, so the width applied; the 5100 mm front door cannot fit a
    // 1800 mm wall and is reported by index, the same way step ② shows it as needing attention.
    expect(result.applied).toBe(1);
    expect(result.design.building.span).toBe(1800);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.reason).toBe(
      'Opening 1 (roller_door on the front wall) no longer fits after this change.',
    );
  });
});

describe('applyGuestOps places a new or moved opening on the nearest legal spot', () => {
  it('never leaves a door flush against the corner post', () => {
    const start = arenaWithSideDoors();
    const result = applyGuestOps(start, arena, [
      { op: 'addOpening', kind: 'window', wall: 'back', size: { width: 1200, height: 900 }, offset: 0 },
    ]);

    expect(result.applied).toBe(1);
    const added = result.design.openings.at(-1);
    // 100 mm is the engine's wall margin: offset 0 would sit inside the corner post.
    expect(added?.offset).toBe(100);
    expect(openingProblems(result.design, arena)).toEqual([]);
  });

  it('centres a new opening when the visitor named no position', () => {
    const start = arenaWithSideDoors();
    const result = applyGuestOps(start, arena, [
      { op: 'addOpening', kind: 'window', wall: 'back', size: { width: 1200, height: 900 } },
    ]);

    expect(result.applied).toBe(1);
    // Back wall is the span, 15000 mm: (15000 − 1200) / 2 = 6900.
    expect(result.design.openings.at(-1)?.offset).toBe(6900);
    expect(openingProblems(result.design, arena)).toEqual([]);
  });

  it('stops a move at the legal margin instead of 0 or past the wall end', () => {
    const start = arenaWithSideDoors();

    const toStart = applyGuestOps(start, arena, [{ op: 'moveOpening', index: 1, wall: 'left', offset: 0 }]);
    expect(toStart.applied).toBe(1);
    expect(toStart.design.openings[1]?.offset).toBe(100);

    const toFar = applyGuestOps(start, arena, [{ op: 'moveOpening', index: 1, wall: 'left', offset: 29900 }]);
    expect(toFar.applied).toBe(1);
    expect(toFar.design.openings[1]?.offset).toBe(26900);
    expect(openingProblems(toFar.design, arena)).toEqual([]);
  });

  it('still refuses a third door on a full garage wall', () => {
    // Two 820 mm personal-access doors fill the 6000 mm garage's left wall: 2 × 820 + margins.
    const base = guestDesignFromType(garage);
    const full: GuestDesignInput = {
      ...base,
      openings: [
        ...base.openings,
        { type: 'pa_door', wall: 'left', offset: 100, size: { width: 820, height: 2040 } },
        { type: 'pa_door', wall: 'left', offset: 1020, size: { width: 820, height: 2040 } },
      ],
    };
    const before = full.openings.length;
    const result = applyGuestOps(full, garage, [
      { op: 'addOpening', kind: 'pa_door', wall: 'left', size: { width: 820, height: 2040 } },
    ]);

    // The type's own limit is what refuses it first, and the design is untouched.
    expect(result.applied).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.design.openings).toHaveLength(before);
  });
});

describe('refitGuestOpenings', () => {
  it('returns the same object when every opening is already legal', () => {
    const start = arenaWithSideDoors();
    const result = refitGuestOpenings(start, arena);

    // Same reference, not an equal copy: the caller uses identity to decide whether to re-render.
    expect(result.design).toBe(start);
    expect(result.stuck).toEqual([]);
  });

  it('reports an opening that fits nowhere and leaves it where it was', () => {
    const narrow: GuestDesignInput = {
      ...arenaWithSideDoors(),
      building: { ...arenaWithSideDoors().building, span: 1800 },
    };
    const result = refitGuestOpenings(narrow, arena);

    // Index 0 is the 5100 mm front door on an 1800 mm wall.
    expect(result.stuck).toEqual([0]);
    expect(result.design.openings[0]?.offset).toBe(narrow.openings[0]?.offset);
    // The side doors are unaffected and stay centred.
    expect(result.design.openings[1]?.offset).toBe(13500);
  });

  it('reports the side doors when their wall has no length, and leaves them where they were', () => {
    /*
     * A bay list can be emptied by a malformed document even though `validateGuestDesign` refuses it.
     * Length is then 0 — a number, not "unknown" — so the side doors have nowhere to sit. They are
     * reported, not dropped, and keep their offset so the check keeps naming them.
     */
    const base = arenaWithSideDoors();
    const noLength: GuestDesignInput = { ...base, building: { ...base.building, bayWidths: [] } };
    const result = refitGuestOpenings(noLength, arena);

    expect(result.stuck).toEqual([1, 2]);
    expect(result.design.openings[0]?.offset).toBe(base.openings[0]?.offset);
    expect(result.design.openings[1]?.offset).toBe(13500);
  });
});

describe('resizeGuestOpening', () => {
  it('keeps the opening centred on its own centre line', () => {
    const start = arenaWithSideDoors();
    const result = resizeGuestOpening(start, arena, 1, { width: 4200, height: 3600 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 13500 − (4200 − 3000) / 2 = 12900, and (30000 − 4200) / 2 = 12900 as well.
    expect(result.design.openings[1]?.offset).toBe(12900);
    expect(result.design.openings[1]?.size).toEqual({ width: 4200, height: 3600 });
  });

  it('returns the placement reason when the new size fits nowhere on the wall', () => {
    const narrow: GuestDesignInput = {
      ...arenaWithSideDoors(),
      building: { ...arenaWithSideDoors().building, span: 1800 },
    };
    const result = resizeGuestOpening(narrow, arena, 0, { width: 5100, height: 3600 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The engine's own sentence, passed through: the guest sees why, not just "it did not fit".
    expect(result.reason).toMatch(/wider than the 1800 mm wall allows/i);
  });

  it('refuses a side resize when the wall has no length, with the engine reason', () => {
    /*
     * A bay list emptied by a malformed document gives a 0 mm wall rather than a "no dimensions"
     * shed: `length` is the sum of the bays, and it is a number even when there are none. So the
     * resize is refused with the real reason instead of being applied to a wall that does not exist.
     * (`resizeGuestOpening`'s "keep the position, take the size" branch is for an undefined building
     * size, which a `GuestDesignInput` cannot produce — it is a guard, not a path the page reaches.)
     */
    const base = arenaWithSideDoors();
    const noLength: GuestDesignInput = { ...base, building: { ...base.building, bayWidths: [] } };
    const result = resizeGuestOpening(noLength, arena, 1, { width: 4200, height: 3600 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/wider than the 0 mm wall allows/i);
  });
});
