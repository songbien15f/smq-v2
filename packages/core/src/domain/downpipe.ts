/**
 * Which colours a downpipe may be painted, given its material.
 *
 * ## The rule, and where it comes from
 *
 * The desktop's Downpipe Type is not a free-text field: it is `downpipe_kind`, and the two values
 * the book carries are `PVC` and `STEEL`. Changing it re-filters the downpipe colour list
 * (`OnChangeBasicDownpipeTypeEvent`, `QuoteDetailsView.Events.cs:696`), which calls
 * `FindDownpipeColors(kind, true)` — a distinct join of `downpipe` to `system_colour` on
 * `downpipe_color = colour_name` for that kind, keeping colours whose `colour_status = 1`.
 *
 * ## Why the join, and not the colour table's own role list
 *
 * `system_colour.option_spec_array` looks like the answer — it carries `DOWNPIPE_PVC` and
 * `DOWNPIPE_STEEL` — but it is **not** what the desktop reads, and on the reference book it is
 * wrong for PVC: measured 2026-11-11, `DOWNPIPE_PVC` lists all 30 active colours while the
 * `downpipe` table stocks exactly one PVC colour, White. Trusting the role list would have offered
 * 29 colours of pipe the factory does not sell.
 *
 * The real lists, measured on the same book:
 *
 * | kind  | colours stocked |
 * |-------|-----------------|
 * | PVC   | White — one row, which is why the desktop auto-picks index 0 |
 * | STEEL | 29 — every colour except White; five (`Bushland`, `Headland`, `Loft`, `Sandbank`,
 *               `Wilderness`) exist in `downpipe` but are inactive in `system_colour`, so the join
 *               drops them |
 *
 * ## Comparing by hex, not by name
 *
 * A quote stores colours as hex (`ShedColors`), because that is what the renderers paint; the book
 * names them. The catalogue already carries both (`ColourOption.name` and `.hex`), so the rule
 * translates the book's names once and then compares hexes. Two book colours can share a hex
 * (`Z450`/`Z600 Galv`); that makes the check permissive in one direction only — a permitted colour
 * is never rejected — which is the safe side of the error.
 *
 * Pure TypeScript: no React, no price-book import.
 */

/** A colour as the editor catalogue states it: the book's name, its hex, and its permitted roles. */
export interface ColourChoice {
  name: string;
  hex: string;
  roles: readonly string[];
}

/**
 * The hexes a downpipe of `kind` may be painted, resolved from the book's colour names.
 *
 * `undefined` for a kind the book does not stock: the caller must not treat that as "nothing
 * allowed", because an empty palette is indistinguishable from a broken one.
 */
export function downpipePalette(
  colours: readonly ColourChoice[],
  stockedNames: readonly string[] | undefined,
): string[] | undefined {
  if (stockedNames === undefined) return undefined;
  const byName = new Map(colours.map((colour) => [colour.name.trim().toLowerCase(), colour.hex]));
  const hexes: string[] = [];
  for (const name of stockedNames) {
    const hex = byName.get(name.trim().toLowerCase());
    if (hex !== undefined && !hexes.includes(hex)) hexes.push(hex);
  }
  return hexes;
}

/**
 * The colour a downpipe should be after its material changes.
 *
 * Mirrors the desktop's three branches, in the same order:
 *
 * 1. the current colour is still sold for this kind → keep it. A person who chose Monument did not
 *    ask to lose it by switching from steel to PVC only when PVC still offers it;
 * 2. only one colour is sold → take it. This is the desktop's `DataSource.Count == 1` branch, and
 *    on the reference book it is **PVC → White**, auto-picked for the same reason;
 * 3. several are sold → take the wall colour if it is one of them (the desktop sets the downpipe to
 *    the wall colour in its `else` branch), otherwise the first.
 *
 * Returns `null` only when the book stocks no colour for that kind — the caller then leaves the
 * value alone and the field shows the mismatch, rather than this function silently inventing a
 * colour the factory cannot paint.
 */
export function reconcileDownpipeColour(
  currentHex: string,
  kind: string,
  wallHex: string,
  palettes: readonly { kind: string; colourNames: readonly string[] }[],
  colours: readonly ColourChoice[],
): string | null {
  const stocked = palettes.find(
    (entry) => entry.kind.trim().toUpperCase() === kind.trim().toUpperCase(),
  );
  const palette = downpipePalette(colours, stocked?.colourNames);
  if (palette === undefined || palette.length === 0) return null;

  const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
  if (palette.some((hex) => same(hex, currentHex))) return currentHex;
  if (palette.length === 1) return palette[0]!;
  const wall = palette.find((hex) => same(hex, wallHex));
  return wall ?? palette[0]!;
}
