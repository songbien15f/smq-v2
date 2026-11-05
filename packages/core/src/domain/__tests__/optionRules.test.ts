import { describe, it, expect } from 'vitest';
import { DEFAULT_SHED } from '../defaults';
import type { ShedConfig } from '../types';
import { defaultOptionsFor } from '../options';
import { optionsThatNoLongerFit, placementRefusals, refusePlacement } from '../optionRules';

/**
 * The rules around placing an option.
 *
 * The desktop's `ProposeAdd` layer could not be ported — it is bound to its own IoC container and DTO
 * model. What is here instead is the part that can be stated plainly, and each rule is pinned so a
 * future change to a bound cannot quietly make a placement impossible or possible.
 */

/** A shed with the given overrides, normalised enough for the rules. */
function shed(overrides: Partial<ShedConfig> = {}): ShedConfig {
  return { ...DEFAULT_SHED, ...overrides };
}

describe('refusePlacement', () => {
  it('allows a placement the building has room for', () => {
    expect(refusePlacement('skylight', shed())).toBeNull();
    expect(refusePlacement('awning', shed())).toBeNull();
    expect(refusePlacement('outrigger', shed())).toBeNull();
  });

  it('refuses a mezzanine when the walls are too low to stand on', () => {
    // 2100 mm level plus 300 mm headroom is the floor; below it there is nowhere legal to put the
    // slab, and `normaliseOption` would clamp it to a level nobody can stand at.
    const refusal = refusePlacement('mezzanine', shed({ height: 2200 }));

    expect(refusal).not.toBeNull();
    expect(refusal?.reason).toMatch(/at least 2400 mm/i);
    expect(refusal?.reason).toMatch(/2200 mm/);
  });

  it('allows a mezzanine at exactly the minimum height', () => {
    expect(refusePlacement('mezzanine', shed({ height: 2400 }))).toBeNull();
  });

  it('refuses a mezzanine whose slab would cut through a door', () => {
    /*
     * The desktop's `AddMezzamineRule` walks the options on the walls the slab touches and
     * counts the ones it would cut through (`:130-200`). It **warned**; this refuses,
     * because a slab through a door cannot be built and a warning is what a person clicks
     * past. The sentence names the culprit, which is the value of the check.
     *
     * A mezzanine defaults to `back_left` at 2400 mm, so a door on the back or left wall
     * **taller than the slab** is in the way. A 2040 mm PA door is not: it clears 2400 mm
     * with 360 mm to spare, which is the case the test below checks. A roller door at
     * 2700 mm does reach it.
     */
    const withDoor = shed({
      openings: [
        {
          id: 'd1',
          type: 'roller_door',
          width: 2400,
          height: 2700,
          sill: 0,
          wall: 'left',
          align: 'center',
          offset: null,
          swing: null,
          track: null,
        },
      ],
    });
    const refusal = refusePlacement('mezzanine', withDoor);
    expect(refusal).not.toBeNull();
    expect(refusal?.reason).toMatch(/roller door/);
  });

  it('allows a mezzanine when the door is on a wall it does not touch', () => {
    // A default mezzanine sits at `back_left`, so a door on the front wall is clear of it.
    const withFrontDoor = shed({
      openings: [
        {
          id: 'd1',
          type: 'pa_door',
          width: 820,
          height: 2040,
          sill: 0,
          wall: 'front',
          align: 'center',
          offset: null,
          swing: null,
          track: null,
        },
      ],
    });
    expect(refusePlacement('mezzanine', withFrontDoor)).toBeNull();
  });

  it('names how many openings are in the way when there is more than one', () => {
    const twoDoors = shed({
      openings: [
        {
          id: 'd1', type: 'roller_door', width: 2400, height: 2700, sill: 0, wall: 'left',
          align: 'center', offset: null, swing: null, track: null,
        },
        {
          id: 'd2', type: 'sliding_door', width: 2400, height: 2600, sill: 0, wall: 'back',
          align: 'center', offset: null, swing: null, track: null,
        },
      ],
    });
    const refusal = refusePlacement('mezzanine', twoDoors);
    expect(refusal?.reason).toMatch(/2 openings/);
    expect(refusal?.reason).toMatch(/roller door/);
    expect(refusal?.reason).toMatch(/sliding door/);
  });

  it('allows a mezzanine over a window that sits below its slab', () => {
    // A window at sill 600 with a 600 head tops out at 1200 — well under a 2400 slab.
    const lowWindow = shed({
      openings: [
        {
          id: 'w1', type: 'window', width: 900, height: 600, sill: 600, wall: 'left',
          align: 'center', offset: null, swing: null, track: null,
        },
      ],
    });
    expect(refusePlacement('mezzanine', lowWindow)).toBeNull();
  });

  it('refuses a second gable infill only when both ends are closed', () => {
    const oneEnd = { ...shed(), options: defaultOptionsFor('gable_infill', shed()).slice(0, 1) };
    // One end filled: adding again fills the other, which is a real change.
    expect(refusePlacement('gable_infill', oneEnd)).toBeNull();

    const bothEnds = { ...shed(), options: defaultOptionsFor('gable_infill', shed()) };
    const refusal = refusePlacement('gable_infill', bothEnds);
    expect(refusal?.reason).toMatch(/both gable ends are already closed/i);
  });

  it('refuses a second overhang or cladding band, which would sit on top of the first', () => {
    const withOverhang = { ...shed(), options: defaultOptionsFor('overhang', shed()) };
    expect(refusePlacement('overhang', withOverhang)?.reason).toMatch(/already an overhang/i);

    const withCladding = { ...shed(), options: defaultOptionsFor('horizontal_cladding', shed()) };
    expect(refusePlacement('horizontal_cladding', withCladding)?.reason).toMatch(/already a cladding band/i);
  });

  it('refuses a dividing wall in a shed too narrow to hold one', () => {
    const refusal = refusePlacement('dividing_wall', shed({ span: 800, length: 800 }));
    expect(refusal?.reason).toMatch(/at least 900 mm/i);
  });

  it('names the building in the refusal, so the operator knows what to change', () => {
    const refusal = refusePlacement('stable', shed({ span: 1200, length: 1200 }));
    expect(refusal?.reason).toMatch(/1200 mm/);
  });
});

describe('placementRefusals', () => {
  it('answers every kind at once, for a catalogue that must explain a disabled button', () => {
    const refusals = placementRefusals(shed({ height: 2200, span: 800, length: 800 }), [
      'skylight',
      'mezzanine',
      'dividing_wall',
      'awning',
    ]);

    const kinds = refusals.map((refusal) => refusal.kind);
    expect(kinds).toContain('mezzanine');
    expect(kinds).toContain('dividing_wall');
    // A skylight needs 900 mm of roof and this shed is 800 mm across, so it is refused too.
    expect(kinds).toContain('skylight');
    // An awning has no rule of its own: a rule that guesses is worse than no rule, so the list must
    // not invent a refusal for it.
    expect(kinds).not.toContain('awning');
  });
});

describe('optionsThatNoLongerFit', () => {
  it('reports a mezzanine the walls have dropped below', () => {
    const placed = { ...shed({ height: 3000 }), options: defaultOptionsFor('mezzanine', shed({ height: 3000 })) };
    // The operator then lowered the walls.
    const problems = optionsThatNoLongerFit({ ...placed, height: 2000 });

    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe('mezzanine');
    expect(problems[0]?.reason).toMatch(/too low for a mezzanine/i);
  });

  it('reports nothing for a shed that still fits', () => {
    const placed = { ...shed({ height: 3000 }), options: defaultOptionsFor('mezzanine', shed({ height: 3000 })) };
    expect(optionsThatNoLongerFit(placed)).toEqual([]);
  });

  it('reports a dividing wall the shed has become too narrow for', () => {
    // Placed in a wide shed, then the span is reduced below the two-margin minimum.
    const placed = { ...shed({ span: 6000, length: 6000 }), options: defaultOptionsFor('dividing_wall', shed()) };
    const problems = optionsThatNoLongerFit({ ...placed, span: 800, length: 800 });

    expect(problems.some((problem) => problem.kind === 'dividing_wall')).toBe(true);
  });
});
