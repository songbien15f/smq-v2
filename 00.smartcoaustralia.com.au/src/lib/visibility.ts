/**
 * Section visibility for the page globals.
 *
 * The rule is deliberately asymmetric: only an explicit `false` hides a section.
 * Content seeded before the switch existed, and any section an editor never
 * opened, keeps rendering — a missing value must never blank a live page.
 *
 * Groups carry the flag inside themselves (`section.visible`); arrays carry it on
 * a sibling boolean (`page.certificationsVisible`). See
 * `src/fields/visible.ts` for why the two shapes differ.
 */

type FlagCarrier = { visible?: boolean | null } | boolean | null | undefined

/**
 * `isSectionVisible(group)` for a group section, or
 * `isSectionVisible(page.qaItemsVisible)` for an array section.
 *
 * Arrays additionally render nothing when empty, so callers combine this with a
 * length check as usual.
 */
export function isSectionVisible(flag: FlagCarrier): boolean {
  if (typeof flag === 'boolean') return flag
  return (flag as { visible?: boolean | null } | null | undefined)?.visible !== false
}

/** Both conditions for an array section: switched on and not empty. */
export function isListVisible<T>(flag: FlagCarrier, list: readonly T[] | null | undefined): boolean {
  return isSectionVisible(flag) && Boolean(list?.length)
}
