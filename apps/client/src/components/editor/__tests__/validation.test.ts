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
