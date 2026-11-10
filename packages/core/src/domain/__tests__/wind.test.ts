import { describe, expect, it } from 'vitest';
import { nearestTerrainCategory, windRegionCode, windRegionLetter } from '../wind';
import { normaliseShedConfig } from '../schema';
import { DEFAULT_SHED } from '../defaults';

/**
 * The wind region is a **certificate code**, not a letter.
 *
 * ## The measurements behind these tests
 *
 * Read from ShedSafe for all 47 buildings in the legacy licence database on 2026-11-10, the values
 * it returns are `A1` (×16), `A2` (×16), `A5` (×12), `B1` (×5). And from the reference price book's
 * `devided` table:
 *
 * ```
 * A2 → purlin_span 720    A5 → purlin_span 830    A6 → purlin_span 1300
 * ```
 *
 * So the codes are **not** interchangeable, and the old schema — `z.enum(['A','B','C','D'])` plus a
 * `.catch()` — rewrote every real certificate's `A5` to `A` before the pricing path saw it. That is
 * steel: a level-5 site priced with a level-2 purlin at a shorter span.
 */
describe('windRegion is kept exactly as the certificate states it', () => {
  it('keeps A5, A2 and B1 through the normaliser', () => {
    for (const code of ['A5', 'A2', 'B1', 'C3', 'D4'] as const) {
      expect(normaliseShedConfig({ ...DEFAULT_SHED, windRegion: code }).windRegion).toBe(code);
    }
  });

  it('does not rewrite A5 to A — the defect this fixes', () => {
    // Measured before the fix: normaliseShedConfig({windRegion:'A5'}).windRegion === 'A'.
    expect(normaliseShedConfig({ ...DEFAULT_SHED, windRegion: 'A5' }).windRegion).not.toBe('A');
  });

  it('accepts an obsolete code an old quote file still carries', () => {
    // `W41` and `N2` are the codes the desktop's own notes call obsolete. Refusing them would make an
    // old file impossible to open; pricing them reports a miss, which is visible.
    expect(normaliseShedConfig({ ...DEFAULT_SHED, windRegion: 'W41' }).windRegion).toBe('W41');
    expect(normaliseShedConfig({ ...DEFAULT_SHED, windRegion: 'N2' }).windRegion).toBe('N2');
  });

  it('still rejects something that is not a code', () => {
    // A sentence is not a wind region, and silently substituting `A` for one is how a quote ends up
    // priced against a default nobody chose.
    expect(normaliseShedConfig({ ...DEFAULT_SHED, windRegion: 'open country' }).windRegion).toBe(
      DEFAULT_SHED.windRegion,
    );
  });
});

describe('terrainCategory snaps a certificate fraction to a listed category', () => {
  it('2.68 and 2.92 both land on a category the book lists', () => {
    expect(nearestTerrainCategory(2.68)).toBe(2.5);
    expect(nearestTerrainCategory(2.92)).toBe(3);
    expect(nearestTerrainCategory(2.81)).toBe(3);
    expect(nearestTerrainCategory(1)).toBe(2);
  });

  it('the three listed values are unchanged', () => {
    expect(nearestTerrainCategory(2)).toBe(2);
    expect(nearestTerrainCategory(2.5)).toBe(2.5);
    expect(nearestTerrainCategory(3)).toBe(3);
  });
});

describe('windRegionCode — what the book is indexed by', () => {
  it('uses a specific certificate code unchanged', () => {
    // The case that matters: the certificate and the book speak the same language.
    expect(windRegionCode('A5', 2.5)).toBe('A5');
    expect(windRegionCode('A2', 3)).toBe('A2');
    expect(windRegionCode('b1', 2)).toBe('B1');
  });

  it('combines a bare region with the terrain digit when the book lists it', () => {
    // The exact combination wins whenever the book has it.
    expect(windRegionCode('A', 2, ['A2', 'A4', 'A5'])).toBe('A2');
    expect(windRegionCode('A', 2.5, ['A2', 'A4', 'A5'])).toBe('A4');
    // Without an `A4` row the nearest listed digit is used — never a code the book cannot answer.
    expect(windRegionCode('A', 2.5, ['A2', 'A5'])).toBe('A5');
  });

  it('uses the nearest listed digit when the book has no A4 — the terrain-2.5 case', () => {
    /*
     * The desktop numbers terrain 2.5 as digit `4`, and the reference book ships `A2`, `A3`, `A5`,
     * `A6` with **no `A4`**. Returning `A4` made the lookup miss and the frame fall back to an
     * assumed section, which is why a `terrainCategory: 2.5` quote came out unpriced.
     *
     * 3 and 5 bracket 4 equally; the first nearest wins, and either is a real row.
     */
    const book = ['A2', 'A3', 'A5', 'A6'];
    expect(book).not.toContain('A4');
    expect(['A3', 'A5']).toContain(windRegionCode('A', 2.5, book));
  });

  it('stays inside the region when snapping', () => {
    // A B region must never borrow an A row: different wind speed, different table.
    expect(windRegionCode('B', 2.5, ['A3', 'A5', 'B2', 'B4'])).toBe('B4');
    expect(windRegionCode('B', 2.5, ['A3', 'A5'])).toBe('B4');
  });

  it('falls back to the bare region on a book indexed by region alone', () => {
    expect(windRegionCode('A', 2.5, ['A', 'B'])).toBe('A');
  });

  it('does not invent a code for something the book cannot have', () => {
    // An obsolete code is returned as-is so the lookup misses and the frame reports an assumption.
    // Substituting `A2` would price a site nobody checked.
    expect(windRegionCode('W41', 2.5, ['A2'])).toBe('W41');
    // An **empty** region is not a bare region: there is nothing to look up, so nothing is invented.
    expect(windRegionCode('', 2.5, ['A2'])).toBe('');
  });

  it('never turns A5 into A2 — the two price differently', () => {
    // The whole point: A5 must not be narrowed to a bare letter and recombined.
    expect(windRegionCode('A5', 2, ['A2', 'A5'])).not.toBe('A2');
    expect(windRegionCode('A5', 3, ['A2', 'A5'])).toBe('A5');
  });
});

describe('windRegionLetter', () => {
  it('reads the region a code belongs to', () => {
    expect(windRegionLetter('A5')).toBe('A');
    expect(windRegionLetter('c3')).toBe('C');
    expect(windRegionLetter('D')).toBe('D');
  });

  it('is null for something that is not a region', () => {
    expect(windRegionLetter('W41')).toBeNull();
    expect(windRegionLetter('')).toBeNull();
    expect(windRegionLetter(null)).toBeNull();
  });
});
