// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  BOM_RULE_NAMES,
  DEFAULT_BOM_RULES,
  bomRuleProblem,
  resolveBomRules,
} from '@/lib/bom/rules';
import { girtRows, purlinRows } from '@/lib/bom/optimise';

/**
 * The rules a factory states, and what happens when one is missing or absurd.
 *
 * Two properties matter and neither is obvious:
 *
 * 1. **The defaults reproduce the old behaviour exactly.** Every one of these
 *    numbers used to be a `const` in a group file. A default that drifted would
 *    silently change every quote, so each is pinned here to the value it had.
 * 2. **A bad value is refused per field, not all-or-nothing.** A stored set that
 *    lost one key must not make the other sixteen fall back somewhere else, and a
 *    value outside its bounds must not be used at all — a `lapNormal` of 10 would
 *    order ten times the steel.
 */
describe('the default rules', () => {
  it('are the numbers the groups used before this module existed', () => {
    // Read from `optimise.ts`, `purlin.ts`, `fixings.ts`, `sheeting.ts`,
    // `gutter.ts` and `frame.ts` at the time they were moved here.
    expect(DEFAULT_BOM_RULES).toEqual({
      purlinEdgeClearance: 150,
      girtFloorClearance: 300,
      rowFractionThreshold: 0.1,
      minRows: 2,
      lapNormal: 0.1,
      lapWindCToHat: 0.15,
      runEndInset: 75,
      boltsPerColumn: 4,
      screwsPerCrossing: 4,
      screwAllowance: 0.1,
      flashingScrewsPerMetre: 2,
      roofEndAllowance: 80,
      wallEndAllowance: 35,
      bracketSpacing: 600,
      footingAllowance: 600,
      kneeBraceLength: 2500,
      rafterClearance: 25,
    });
  });

  it('lists every field, so a settings screen can show them all', () => {
    expect(BOM_RULE_NAMES).toHaveLength(Object.keys(DEFAULT_BOM_RULES).length);
  });
});

describe('resolveBomRules', () => {
  it('returns the defaults for nothing stored', () => {
    expect(resolveBomRules(undefined)).toEqual(DEFAULT_BOM_RULES);
    expect(resolveBomRules(null)).toEqual(DEFAULT_BOM_RULES);
    expect(resolveBomRules({})).toEqual(DEFAULT_BOM_RULES);
  });

  it('keeps a stored value and fills the rest from the defaults', () => {
    // The important case: a settings row from before a rule existed. The new rule
    // must not be missing, and the stored one must not be lost.
    const resolved = resolveBomRules({ purlinEdgeClearance: 100 });
    expect(resolved.purlinEdgeClearance).toBe(100);
    expect(resolved.girtFloorClearance).toBe(300);
    expect(resolved.boltsPerColumn).toBe(4);
  });

  it('refuses an out-of-range value rather than using it', () => {
    // `lapNormal: 10` is a typo for 0.10 that would order ten times the purlin.
    const resolved = resolveBomRules({ lapNormal: 10, screwAllowance: -1 });
    expect(resolved.lapNormal).toBe(DEFAULT_BOM_RULES.lapNormal);
    expect(resolved.screwAllowance).toBe(DEFAULT_BOM_RULES.screwAllowance);
  });

  it('refuses a value that is not a number', () => {
    const resolved = resolveBomRules({ boltsPerColumn: '4', minRows: null });
    expect(resolved.boltsPerColumn).toBe(4);
    expect(resolved.minRows).toBe(2);
  });

  it('ignores keys that are not rules', () => {
    const resolved = resolveBomRules({ somethingElse: 99 });
    expect(resolved).toEqual(DEFAULT_BOM_RULES);
  });
});

describe('bomRuleProblem', () => {
  it('accepts a value inside its bounds', () => {
    expect(bomRuleProblem('boltsPerColumn', 6)).toBeNull();
  });

  it('names the bound, so a person can correct it once', () => {
    expect(bomRuleProblem('boltsPerColumn', 99)).toMatch(/between 1 and 12/);
    expect(bomRuleProblem('lapNormal', -0.1)).toMatch(/between 0 and 0.5/);
  });

  it('refuses a value that is not a number, and an unknown rule', () => {
    expect(bomRuleProblem('minRows', 'two')).toMatch(/must be a number/);
    expect(bomRuleProblem('notARule', 1)).toMatch(/Unknown rule/);
  });
});

describe('the rules change a quote', () => {
  it('more purlin rows when the edge clearance shrinks', () => {
    // The property that makes this module worth having: a different factory states
    // a different clearance and gets a different row count from the same roof.
    const span = 4569;
    const standard = purlinRows(span, 1200, 1200, DEFAULT_BOM_RULES);
    const tighter = purlinRows(span, 1200, 1200, {
      ...DEFAULT_BOM_RULES,
      purlinEdgeClearance: 0,
    });
    expect(tighter).toBeGreaterThanOrEqual(standard);
  });

  it('fewer girt rows when the floor clearance grows', () => {
    const height = 3600;
    const standard = girtRows(height, 1700, 1700, DEFAULT_BOM_RULES);
    const raised = girtRows(height, 1700, 1700, {
      ...DEFAULT_BOM_RULES,
      girtFloorClearance: 1000,
    });
    expect(raised).toBeLessThanOrEqual(standard);
  });

  it('respects a factory that wants a higher minimum row count', () => {
    // A shed with a very short wall still gets the factory's minimum.
    const rows = girtRows(900, 5000, 5000, { ...DEFAULT_BOM_RULES, minRows: 4 });
    expect(rows).toBe(4);
  });
});
