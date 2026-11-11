import { describe, expect, it } from 'vitest';
import {
  downpipePalette,
  reconcileDownpipeColour,
  type ColourChoice,
} from '../downpipe';

/**
 * The rule: a downpipe's colour is limited by the material it is made of.
 *
 * Measured on the reference book (2026-11-11): PVC is stocked in **White alone**, steel in the
 * other 29 colours. The desktop enforces this by re-filtering the colour dropdown on every material
 * change (`OnChangeBasicDownpipeTypeEvent`); this build must do the same, or a quote carries a
 * Monument PVC pipe that no `downpipe` row prices.
 */

/** The book's colours, as the catalogue presents them: name, hex, permitted roles. */
const COLOURS: ColourChoice[] = [
  { name: 'White', hex: '#ffffff', roles: ['DOWNPIPE_PVC', 'DOWNPIPE_STEEL'] },
  { name: 'Shale Grey', hex: '#bdbfba', roles: ['WALL_SPEC', 'DOWNPIPE_STEEL'] },
  { name: 'Monument', hex: '#323232', roles: ['DOWNPIPE_STEEL'] },
  // Two book colours can share a hex; the check must not depend on which one is found first.
  { name: 'Z450 Galv', hex: '#b6b8b4', roles: ['DOWNPIPE_STEEL'] },
  { name: 'Z600 Galv', hex: '#b6b8b4', roles: ['DOWNPIPE_STEEL'] },
];

const MATERIALS = [
  { kind: 'PVC', colourNames: ['White'] },
  // White is **not** a steel colour on the reference book: the 29 steel rows exclude it. That
  // asymmetry is the whole rule — it is why PVC → steel must move off White.
  { kind: 'STEEL', colourNames: ['Shale Grey', 'Monument', 'Z450 Galv', 'Z600 Galv'] },
];

describe('downpipePalette', () => {
  it('resolves the book’s colour names to hexes', () => {
    expect(downpipePalette(COLOURS, ['White'])).toEqual(['#ffffff']);
  });

  it('drops a name the active colour table does not carry', () => {
    // A colour present in `downpipe` but inactive in `system_colour` is not offerable: the join the
    // desktop used drops it, and offering it would let a person pick a colour with no active price.
    expect(downpipePalette(COLOURS, ['Loft'])).toEqual([]);
  });

  it('returns undefined — not an empty list — for a material the book does not state', () => {
    // An empty palette and an unstocked material are different answers: the first is a rule, the
    // second is missing data, and the caller must not lock the field on missing data.
    expect(downpipePalette(COLOURS, undefined)).toBeUndefined();
  });

  it('lists a shared hex once', () => {
    expect(downpipePalette(COLOURS, ['Z450 Galv', 'Z600 Galv'])).toEqual(['#b6b8b4']);
  });
});

describe('reconcileDownpipeColour', () => {
  it('keeps the current colour when the new material still sells it', () => {
    // Switching steel → steel is not a colour change; the desktop keeps the selection.
    expect(
      reconcileDownpipeColour('#323232', 'STEEL', '#bdbfba', MATERIALS, COLOURS),
    ).toBe('#323232');
  });

  it('takes the only colour when one is stocked — PVC goes white', () => {
    // The desktop's `DataSource.Count == 1` branch, which is exactly PVC on this book.
    expect(
      reconcileDownpipeColour('#323232', 'PVC', '#bdbfba', MATERIALS, COLOURS),
    ).toBe('#ffffff');
  });

  it('falls back to the wall colour when several are sold and the current one is not', () => {
    // Steel sells Shale Grey, so a White downpipe becoming steel on a Shale Grey shed takes the
    // wall colour — the desktop's `else` branch.
    expect(
      reconcileDownpipeColour('#ffffff', 'STEEL', '#bdbfba', MATERIALS, COLOURS),
    ).toBe('#bdbfba');
  });

  it('leaves the value alone when the book stocks no colour for the material', () => {
    // `null` means "no rule applies", so the caller keeps what it had and the field shows the
    // mismatch. Inventing a colour here would be a quote the factory cannot paint.
    expect(
      reconcileDownpipeColour('#323232', 'COPPER', '#bdbfba', MATERIALS, COLOURS),
    ).toBeNull();
  });

  it('compares hexes case-insensitively, because stored colours are lowercased', () => {
    expect(
      reconcileDownpipeColour('#323232', 'steel', '#BDBFBA', MATERIALS, COLOURS),
    ).toBe('#323232');
  });
});
