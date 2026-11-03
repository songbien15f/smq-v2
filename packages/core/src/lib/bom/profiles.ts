/**
 * Factory profiles: three suppliers, three sets of rules.
 *
 * ## What these are, and what they are not
 *
 * A **profile** is one factory's answer to the questions a quote depends on: how
 * close the first purlin sits to the edge, how much lap a run needs, how many
 * bolts hold a column, how far a sheet runs past the eave. Two Australian
 * fabricators do not agree on any of them, so a product that ships one set of
 * numbers can only ever quote for one factory.
 *
 * These three are **illustrative**, not anybody's real specification. They exist
 * so the mechanism can be shown, chosen, and tested before a real customer's
 * figures are known — and so a demo can say "this is what switching supplier
 * changes" with real numbers behind it.
 *
 * ## Why the default is a profile and not a bare set of numbers
 *
 * `default` is the rules this build has always used, named. A company that never
 * chooses one gets it, and a quote records `default` rather than nothing, so the
 * question "which method produced this quantity" always has an answer.
 *
 * ## Why the ids are stable strings
 *
 * A profile id ends up inside a saved revision. Renaming one would orphan every
 * quote that named it, so the ids are fixed and only the labels can change.
 */

import { DEFAULT_BOM_RULES, resolveBomRules, type BomRules } from './rules';

/** One factory's method, as a company can select it. */
export interface FactoryProfile {
  /** Stable id. Appears in a saved revision; never rename it. */
  id: string;
  /** What a person sees. */
  name: string;
  /** One line on what makes this factory different, for a settings screen. */
  summary: string;
  /** The rules. */
  rules: BomRules;
}

/**
 * Three profiles, and each differs in a way a quote can show.
 *
 * The differences are chosen to be visible rather than realistic: a smaller edge
 * clearance adds purlin rows, a higher screw allowance adds packs, a larger
 * footing allowance adds steel to every column. A profile whose numbers moved
 * nothing would demonstrate nothing.
 */
export const FACTORY_PROFILES: FactoryProfile[] = [
  {
    id: 'default',
    name: 'Standard (this build’s defaults)',
    summary: '150 mm purlin edge, 300 mm floor clearance, 4 bolts a column, 10% screw allowance.',
    rules: DEFAULT_BOM_RULES,
  },
  {
    id: 'close-spaced',
    name: 'Light sections, tighter fixing',
    summary:
      'A 5% screw allowance instead of 10%, 3 screws a crossing instead of 4, and a 450 mm footing — a factory quoting thin high-tensile steel.',
    rules: {
      ...DEFAULT_BOM_RULES,
      /**
       * These four are chosen because each one **moves a quantity**, which a
       * demonstration profile has to do.
       *
       * An earlier version changed the purlin edge clearance from 150 to 100 mm and
       * nothing moved: on a 9 m span the row count went from 3.683 to 3.724 and both
       * round to 4. A profile that changes no number demonstrates nothing, so the
       * clearance is left alone and the differences are ones a quote can show.
       */
      screwAllowance: 0.05,
      screwsPerCrossing: 3,
      footingAllowance: 450,
      wallEndAllowance: 25,
    },
  },
  {
    id: 'heavy-fixing',
    name: 'Heavy fixing and deeper footings',
    summary:
      '6 bolts a column, 15% screw allowance, 5 screws a crossing and 900 mm footings — a specification for exposed or cyclonic sites.',
    rules: {
      ...DEFAULT_BOM_RULES,
      boltsPerColumn: 6,
      screwsPerCrossing: 5,
      screwAllowance: 0.15,
      flashingScrewsPerMetre: 3,
      footingAllowance: 900,
      lapNormal: 0.12,
      lapWindCToHat: 0.2,
    },
  },
];

/** The profile a company gets when it has chosen none. */
export const DEFAULT_PROFILE_ID = 'default';

/** The profile with this id, or the default one. */
export function profileById(id: string | null | undefined): FactoryProfile {
  if (id === null || id === undefined || id === '') return FACTORY_PROFILES[0];
  return FACTORY_PROFILES.find((profile) => profile.id === id) ?? FACTORY_PROFILES[0];
}

/**
 * Read a stored profile back, whatever shape it is in.
 *
 * The settings blob is JSON in a column, and a row written before this field
 * existed simply has no such key. That is not a corrupt row — it is every company
 * that existed before the feature — and returning `undefined` for it crashed the
 * pricing path with "Cannot read properties of undefined (reading 'rules')", a
 * 500 on every quote in the product. The tests all passed, because a test builds
 * its company from `DEFAULT_COMPANY_SETTINGS`, which has the key.
 *
 * So the read is total: `null`, absent, a string, an object with a mangled id — all
 * of them resolve to something a quote can be priced with. The rules go through
 * `resolveBomRules`, which takes what is usable per field and refuses what is out
 * of range, so one bad number in a stored blob cannot take the whole quote down.
 */
export function normaliseBomProfile(value: unknown): { id: string; name: string; rules: BomRules } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' && record.id.trim() !== '' ? record.id : DEFAULT_PROFILE_ID;
  const named = profileById(id);
  return {
    id,
    name: typeof record.name === 'string' && record.name.trim() !== '' ? record.name : named.name,
    rules: resolveBomRules(record.rules),
  };
}

/**
 * The rules a company quotes under, from its stored profile.
 *
 * A stored profile whose rules were edited keeps those edits — a company that
 * tuned one number expects it used, not replaced by the named profile's copy. An
 * absent profile is the default.
 *
 * `undefined` is accepted as well as `null`, because this is a boundary: the
 * value comes out of a JSON column that may predate the field. Refusing it there
 * means every caller has to remember, and one that forgets crashes a quote.
 */
export function rulesForCompany(
  stored: { id: string; name: string; rules: BomRules } | null | undefined,
): { rules: BomRules; profile: string } {
  const profile = normaliseBomProfile(stored ?? null);
  if (profile === null) return { rules: DEFAULT_BOM_RULES, profile: DEFAULT_PROFILE_ID };
  return { rules: profile.rules, profile: profile.id };
}
