/**
 * The numbers in a bill of materials that belong to a factory rather than to
 * geometry.
 *
 * ## Why this module exists
 *
 * Every shed company buys from its own supplier, and suppliers differ on the
 * things a quote is built from: how close the first purlin sits to the edge, how
 * much lap a run needs where two stock lengths meet, how many bolts hold a column,
 * how much a screw order is allowed to over-run. Today those numbers are spread
 * across eight files as `const` declarations, which means supporting a second
 * factory is eight edits in eight places — and the eighth is the one that gets
 * missed.
 *
 * This is the single place. A company's rules come from its settings; absent, they
 * are the values below, which are the ones this build has always used. **Nothing
 * changes for an existing quote**: the defaults reproduce the current behaviour
 * exactly, so a saved revision re-renders identically.
 *
 * ## What is deliberately not here
 *
 * Geometry that follows from the building — half the span over the cosine of the
 * pitch, the diagonal of a rectangle, the number of corners on a rectangular shed
 * — is arithmetic, not policy. Putting it in a settings table would invite someone
 * to change it and produce a quote for a building that cannot be built. The line
 * is: **a number a factory would state in its own price list belongs here; a
 * number that follows from the shape does not.**
 */

/**
 * One company's bill-of-materials rules.
 *
 * Every field has a default, and the defaults are the values this build has always
 * used — a company that sets none gets exactly today's behaviour.
 */
export interface BomRules {
  /** Clearance between the first purlin and the roof edge, mm. */
  purlinEdgeClearance: number;
  /** Clearance between the first girt and the floor, mm. */
  girtFloorClearance: number;
  /**
   * A fractional row is dropped rather than added when it is at or below this.
   *
   * A sliver of leftover span is not worth an extra row; a factory states this as
   * "round up when the gap is more than a tenth".
   */
  rowFractionThreshold: number;
  /** Fewest purlin or girt rows a roof or wall can have. */
  minRows: number;
  /** Overlap added to a purlin or girt run where two stock lengths meet. */
  lapNormal: number;
  /** The larger overlap on a TopHat frame in wind region C. */
  lapWindCToHat: number;
  /** How far the first and last member of a run sit in from the corner, mm. */
  runEndInset: number;
  /** Bolts per column, for the pinned-footing case. */
  boltsPerColumn: number;
  /** Screws per purlin or girt crossing, at every sheet. */
  screwsPerCrossing: number;
  /** The allowance added to a screw count before rounding to packs. */
  screwAllowance: number;
  /** Screws per metre of flashing. */
  flashingScrewsPerMetre: number;
  /** Roof sheets extend this far past the eave and the ridge, mm. */
  roofEndAllowance: number;
  /** Wall sheets extend this far past the top and bottom, mm. */
  wallEndAllowance: number;
  /** Gutter brackets are fitted at this spacing along the run, mm. */
  bracketSpacing: number;
  /** The column length added for a footing when the design states none, mm. */
  footingAllowance: number;
  /** The knee brace's length on a TopHat frame, mm. */
  kneeBraceLength: number;
  /** How far a rafter extends past the purlin and column, mm. */
  rafterClearance: number;
}

/**
 * What this build has always used.
 *
 * Each value was read out of the group that used it, so a company that sets no
 * rules gets the same quote it got before this module existed. A test pins every
 * field against those groups.
 */
export const DEFAULT_BOM_RULES: BomRules = {
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
};

/** The bounds a rule must fall inside to be accepted. */
const LIMITS: Record<keyof BomRules, { min: number; max: number }> = {
  purlinEdgeClearance: { min: 0, max: 600 },
  girtFloorClearance: { min: 0, max: 1000 },
  rowFractionThreshold: { min: 0, max: 0.5 },
  minRows: { min: 1, max: 10 },
  lapNormal: { min: 0, max: 0.5 },
  lapWindCToHat: { min: 0, max: 0.5 },
  runEndInset: { min: 0, max: 500 },
  boltsPerColumn: { min: 1, max: 12 },
  screwsPerCrossing: { min: 1, max: 12 },
  screwAllowance: { min: 0, max: 0.5 },
  flashingScrewsPerMetre: { min: 0, max: 12 },
  roofEndAllowance: { min: 0, max: 500 },
  wallEndAllowance: { min: 0, max: 500 },
  bracketSpacing: { min: 100, max: 2000 },
  footingAllowance: { min: 0, max: 2000 },
  kneeBraceLength: { min: 0, max: 6000 },
  rafterClearance: { min: 0, max: 500 },
};

/** Every rule name, for a UI that lists them and a test that checks them all. */
export const BOM_RULE_NAMES = Object.keys(DEFAULT_BOM_RULES) as (keyof BomRules)[];

/**
 * A company's rules, with every missing or unusable value replaced by the default.
 *
 * **Per field, not all-or-nothing.** A stored set that lost one key — an older
 * settings version, a hand-edited row — must not make the other sixteen fall back
 * to something else. And a value outside its bounds is refused rather than used: a
 * `lapNormal` of `10` would order ten times the steel, and the person who typed it
 * would see a quote that is wrong by a factor nobody can explain.
 */
export function resolveBomRules(stored: unknown): BomRules {
  const rules: BomRules = { ...DEFAULT_BOM_RULES };
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return rules;

  const record = stored as Record<string, unknown>;
  for (const name of BOM_RULE_NAMES) {
    const value = record[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const limit = LIMITS[name];
    if (value < limit.min || value > limit.max) continue;
    rules[name] = value;
  }
  return rules;
}

/**
 * Why a stored value would be refused, or `null` when it is usable.
 *
 * Returned as a message rather than a boolean because the caller is a settings
 * screen, and "that is not allowed" without saying which bound is how a person
 * guesses wrong twice.
 */
export function bomRuleProblem(name: string, value: unknown): string | null {
  if (!BOM_RULE_NAMES.includes(name as keyof BomRules)) return `Unknown rule: ${name}`;
  const limit = LIMITS[name as keyof BomRules];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${name} must be a number`;
  }
  if (value < limit.min || value > limit.max) {
    return `${name} must be between ${limit.min} and ${limit.max}`;
  }
  return null;
}

/**
 * The rules a quote is priced under.
 *
 * Held on the pricing context beside the margin, for the same reason: a saved
 * revision must be able to say which rules produced its quantities. The engine
 * reads them from here rather than from module constants.
 */
export interface BomPolicy {
  rules: BomRules;
  /**
   * The name of the factory profile these rules describe, for the record.
   *
   * A revision that stored the numbers but not where they came from could not
   * answer "why is this purlin spacing different from the one we quoted last
   * month".
   */
  profile: string;
}
