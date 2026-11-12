// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROFILE_ID,
  FACTORY_PROFILES,
  profileById,
  rulesForCompany,
} from '@/lib/bom/profiles';
import { DEFAULT_BOM_RULES } from '@/lib/bom/rules';
import { readActiveBookHash, openPublishedBook } from '@/lib/pricing/publish';
import { createLookup } from '@/lib/pricing/lookup';
import { normaliseDimensionedShed } from '@/domain/schema';
import { buildBomWithEvidence } from '@/lib/bom/build';

/**
 * The profiles have to *do* something.
 *
 * An earlier draft of the second profile changed the purlin edge clearance from
 * 150 mm to 100 mm and moved no number at all: on a 9 m span the row count went
 * from 3.683 to 3.724 and both round to four. A profile that changes nothing
 * demonstrates nothing, and worse, a customer switching to it would believe they
 * had changed their method when they had not. So this file asserts that each
 * profile produces a **different bill of materials** from the default.
 */
describe('the factory profiles', () => {
  it('includes the default first, and it is the rules this build always used', () => {
    expect(FACTORY_PROFILES[0].id).toBe(DEFAULT_PROFILE_ID);
    expect(FACTORY_PROFILES[0].rules).toEqual(DEFAULT_BOM_RULES);
  });

  it('gives every profile a stable id, a name and a summary', () => {
    const ids = new Set<string>();
    for (const profile of FACTORY_PROFILES) {
      expect(profile.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(profile.name.trim()).not.toBe('');
      expect(profile.summary.trim()).not.toBe('');
      expect(ids.has(profile.id), `duplicate id ${profile.id}`).toBe(false);
      ids.add(profile.id);
    }
  });

  it('resolves an unknown id to the default rather than to nothing', () => {
    // A revision naming a profile that was later removed must still price, and the
    // default is the only honest answer.
    expect(profileById('does-not-exist').id).toBe(DEFAULT_PROFILE_ID);
    expect(profileById(null).id).toBe(DEFAULT_PROFILE_ID);
  });

  it('keeps a company’s edited rules rather than replacing them with the profile', () => {
    // A company that tuned one number expects it used. Replacing the set with the
    // named profile's copy would silently undo their edit.
    const edited = { ...DEFAULT_BOM_RULES, boltsPerColumn: 8 };
    const resolved = rulesForCompany({ id: 'default', name: 'Mine', rules: edited });
    expect(resolved.rules.boltsPerColumn).toBe(8);
    expect(resolved.profile).toBe('default');
  });

  it('falls back to the default rules when a company chose nothing', () => {
    expect(rulesForCompany(null)).toEqual({
      rules: DEFAULT_BOM_RULES,
      profile: DEFAULT_PROFILE_ID,
    });
  });
});

describe('each profile changes the bill of materials', () => {
  const root = 'data/price-books';
  const hash = readActiveBookHash(root);

  /** The building every profile is compared on. */
  const shed = normaliseDimensionedShed({
    structureType: 'gable',
    span: 9000,
    length: 24000,
    bays: 8,
    height: 3600,
    roofPitchDeg: 10,
    windRegion: 'A',
    terrainCategory: 2,
    importanceLevel: 1,
    internalPressure: 'closed',
    stateCode: 'QLD',
    colors: {
      wall: '#1a3b47',
      roof: '#1a3b47',
      barge: '#1a3b47',
      downpipe: '#1a3b47',
      gutter: '#1a3b47',
      window: '#1a3b47',
      paDoor: '#1a3b47',
      rollerDoor: '#1a3b47',
      slidingDoor: '#1a3b47',
      dividingWall: '#1a3b47',
    },
    options: [],
    openings: [],
    charges: [],
  } as never)!;

  const totalFor = (profileIndex: number): number | null => {
    if (hash === null) return null;
    const book = openPublishedBook(hash, root);
    try {
      const lookup = createLookup(book);
      const built = buildBomWithEvidence(shed, lookup, undefined, FACTORY_PROFILES[profileIndex].rules);
      return built.bom.totalCost;
    } finally {
      book.close();
    }
  };

  it('prices every profile differently from the default', () => {
    // Needs a published book. Without one the assertion would pass vacuously, so
    // the test says which case it is in rather than skipping silently.
    const base = totalFor(0);
    if (base === null) {
      // No book in this checkout: the structural tests above still hold.
      expect(hash).toBeNull();
      return;
    }

    for (let index = 1; index < FACTORY_PROFILES.length; index++) {
      const total = totalFor(index);
      expect(total, FACTORY_PROFILES[index].id).not.toBe(base);
    }
  })!;

  it('moves in the direction its summary claims', () => {
    const base = totalFor(0);
    if (base === null) return;
    // `close-spaced` uses fewer screws and shallower footings, so it is cheaper;
    // `heavy-fixing` uses more of both, so it is dearer. A profile whose name says
    // one thing and whose numbers do another is a profile nobody can trust.
    const light = totalFor(1);
    const heavy = totalFor(2);
    expect(light!).toBeLessThan(base);
    expect(heavy!).toBeGreaterThan(base);
  })!;
});
