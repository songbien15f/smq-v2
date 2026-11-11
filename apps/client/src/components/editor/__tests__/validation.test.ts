import { describe, it, expect } from 'vitest';
import { DEFAULT_SHED, normaliseShedConfig } from '@sq/core/domain';
import type { ShedConfig } from '@sq/core/domain';
import { validateDraft } from '../validation';

/**
 * The two rules that had been written in core and never called.
 *
 * Both report a building that **cannot be made** as it now stands, and both were unreachable: the
 * functions existed with tests of their own, and nothing in the editor consulted them. So a person
 * could lower the walls out from under a mezzanine, watch the plan redraw, and save a quote for a
 * building nobody can build — and a length its bays do not sum to produced no message at all.
 */

const customer = {
  firstName: 'Jo',
  lastName: 'Citizen',
  email: 'jo@example.com',
  address: '1 Test Rd, Brisbane QLD 4000',
};

const site = { address: '1 Test St, Brisbane QLD 4000', deliveryAcknowledged: true };

/** A valid building, so a failing assertion cannot be blamed on some other rule. */
function shed(overrides: Record<string, unknown> = {}): ShedConfig {
  return normaliseShedConfig({
    ...DEFAULT_SHED,
    structureType: 'gable',
    span: 12000,
    length: 24000,
    height: 4200,
    bays: 4,
    nomBaySpacing: 6000,
    windRegion: 'A',
    terrainCategory: 2.5,
    stateCode: 'QLD',
    ...overrides,
  });
}

/** The messages this module produced, for a readable failure. */
function messages(config: ShedConfig): string[] {
  return validateDraft({ config, customer, site }).map((issue) => issue.message);
}

describe('validateDraft — a building that is valid', () => {
  it('reports nothing about options or bays', () => {
    const issues = messages(shed());
    expect(issues.some((m) => /mezzanine/i.test(m))).toBe(false);
    expect(issues.some((m) => /bays is |bay length/i.test(m))).toBe(false);
  });
});

describe('validateDraft — options that no longer fit', () => {
  it('reports a mezzanine whose walls are too low to stand on', () => {
    /*
     * The scenario: a mezzanine is placed in a 4200 mm building, then the walls come down to
     * 2100 mm. `normaliseOption` clamps the slab level to `height - 300`, so nothing is drawn
     * outside the shed — but the result is a mezzanine nobody can stand on, which is a different
     * thing from the one that was placed.
     */
    const config = shed({
      height: 2100,
      options: [
        { id: 'm1', kind: 'mezzanine', width: 3000, depth: 3000, level: 2400, bay: 0, wall: 'left', offset: 500 },
      ],
    });

    const issues = validateDraft({ config, customer, site });
    const reported = issues.find((issue) => issue.path === 'options-m1');
    expect(reported).toBeDefined();
    expect(reported?.message).toMatch(/too low for a mezzanine/i);
    // The message says what the walls are, so the fix is visible without hunting.
    expect(reported?.message).toContain('2100');
  });

  it('leaves a mezzanine alone when the walls come back up', () => {
    const config = shed({
      height: 4200,
      options: [
        { id: 'm1', kind: 'mezzanine', width: 3000, depth: 3000, level: 2400, bay: 0, wall: 'left', offset: 500 },
      ],
    });
    expect(messages(config).some((m) => /mezzanine/i.test(m))).toBe(false);
  });
});

describe('validateDraft — a length the bays do not sum to', () => {
  it('reports the nominal spacing when it disagrees with the length', () => {
    /*
     * `reconcileBays` keeps these three fields consistent when a person edits them, so this only
     * arrives from somewhere else — a template, an imported file, a hand-edited row. It is the
     * desktop's own message, and it matters because a remainder means one bay is a different length
     * from the rest.
     *
     * `normaliseShedConfig` recomputes the spacing from the length, so the inconsistent pair is
     * assembled by hand here: that is the shape a stored revision would have.
     */
    const base = shed();
    const inconsistent: ShedConfig = { ...base, length: 24000, bays: 4, nomBaySpacing: 5000 };

    const issues = validateDraft({ config: inconsistent, customer, site });
    const reported = issues.find((issue) => issue.path === 'shed-nomBaySpacing');
    expect(reported).toBeDefined();
    expect(reported?.message).toContain('20000');
    expect(reported?.message).toContain('24000');
  });

  it('says nothing when the spacing and the length agree', () => {
    const config = shed();
    expect(config.nomBaySpacing * config.bays).toBe(config.length);
    expect(messages(config).some((m) => /Change the spacing or the bay count/i.test(m))).toBe(false);
  });
});

describe('validateDraft — a cantilever past what the standard series carries', () => {
  /*
   * The desktop refuses a cantilever over 1 400 mm on a standard structure
   * (`ValidateDesignInfoBlock`, `Error.cs:320`) and skips the check for a non-standard one, which
   * is a building the factory designs to order.
   *
   * The limit lives here rather than in the option's own clamp because it is a **design** rule, not
   * a geometric one: `normaliseOption` still allows 3 000 mm, which is what a custom structure can
   * use. Blocking at the option level would make the non-standard case impossible to express.
   */
  const cantilever = (length: number) =>
    shed({
      options: [
        { id: 'c1', kind: 'cantilever', wall: 'front', bay: 0, length },
      ],
    });

  const standard = { nonStandardStructureCodes: ['CGB', 'CSB'] };

  it('blocks a 1 500 mm cantilever on a standard structure, and says the limit', () => {
    const issues = validateDraft({ config: cantilever(1500), customer, site }, standard);
    const reported = issues.find((issue) => issue.path === 'design-cantilever');
    expect(reported).toBeDefined();
    expect(reported?.message).toContain('1500');
    expect(reported?.message).toContain('1400');
  });

  it('allows 1 400 mm exactly — the desktop’s limit is inclusive', () => {
    const issues = validateDraft({ config: cantilever(1400), customer, site }, standard);
    expect(issues.some((issue) => issue.path === 'design-cantilever')).toBe(false);
  });

  it('allows a long cantilever on a non-standard building', () => {
    /*
     * `custom_gable` maps to the book's `CGB` sub-code, which is flagged `is_nonstandard = 1`. The
     * point of reading the flag from the book rather than comparing display names — as the desktop
     * does — is that renaming a row cannot switch the rule back on.
     */
    const config = { ...cantilever(2500), structureType: 'custom_gable' as never };
    const issues = validateDraft({ config, customer, site }, standard);
    expect(issues.some((issue) => issue.path === 'design-cantilever')).toBe(false);
  });

  it('does not run when no book is passed, because the flag is the book’s', () => {
    // Documented rather than accidental: without the catalogue the editor cannot know which
    // structures are non-standard, and guessing "standard" would block a custom building.
    const issues = validateDraft({ config: cantilever(2500), customer, site });
    expect(issues.some((issue) => issue.path === 'design-cantilever')).toBe(false);
  });
});

describe('validateDraft — bays that differ on purpose', () => {
  /*
   * The desktop's `Adjust Bay Spacing` panel produces bays of different lengths, and the frame table is
   * keyed by the **largest** one, so unequal bays are a real building — not an arithmetic accident.
   *
   * Before this, `validateDraft` refused any length that did not divide evenly by the bay count, and
   * refused a nominal spacing that no bay matched. Both rules were right while equal division was the
   * only way to describe a shed. With an array they contradict the panel that creates the array.
   */
  const uneven = shed({
    length: 14000,
    bays: 3,
    bayWidths: [4000, 4000, 6000],
  });

  it('accepts bays that differ when the array says so', () => {
    const issues = validateDraft({ config: uneven, customer, site });
    expect(issues.some((issue) => issue.path === 'shed-bays')).toBe(false);
    expect(issues.some((issue) => issue.path === 'shed-nomBaySpacing')).toBe(false);
  });

  it('still reports an uneven division nobody asked for', () => {
    // No array: the remainder came from arithmetic, and one bay really is a different length.
    const accidental = { ...shed({ length: 14000, bays: 3 }), bayWidths: undefined };
    const issues = validateDraft({ config: accidental, customer, site });
    expect(issues.some((issue) => issue.path === 'shed-bays')).toBe(true);
  });

  it('accepts the same building divided evenly', () => {
    const even = { ...shed({ length: 14000, bays: 2, bayWidths: [7000, 7000] }) };
    const issues = validateDraft({ config: even, customer, site });
    expect(issues.some((issue) => issue.path === 'shed-bays')).toBe(false);
  });
});
