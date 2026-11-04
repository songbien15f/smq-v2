import { describe, expect, it } from 'vitest';
import { DEFAULT_ADDITION_LINES, additionsTotalCents } from '../additions';

describe('additionsTotalCents', () => {
  it('adds GST to labour and equipment, and not to the fees', () => {
    const lines = [
      { ...DEFAULT_ADDITION_LINES[0], enabled: true, quantity: 8, unitPriceCents: 5000 }, // concreter, taxable
      { ...DEFAULT_ADDITION_LINES.find((line) => line.id === 'council')!, enabled: true, quantity: 1, unitPriceCents: 20000 },
    ];
    // 8 × $50 = $400, +10% GST = $440; council $200 as-is → $640.
    expect(additionsTotalCents(lines)).toBe(64_000);
  });

  it('ignores a line whose flag is off, even with a quantity', () => {
    const lines = [
      { ...DEFAULT_ADDITION_LINES[0], enabled: false, quantity: 8, unitPriceCents: 5000 },
    ];
    expect(additionsTotalCents(lines)).toBe(0);
  });

  it('rounds once per line, so cents are exact', () => {
    const lines = [
      { ...DEFAULT_ADDITION_LINES[0], enabled: true, quantity: 3, unitPriceCents: 333 },
    ];
    // 999 × 1.1 = 1098.9 → 1099, not 999 + a rounded tax.
    expect(additionsTotalCents(lines)).toBe(1099);
  });

  it('ships the desktop categories', () => {
    expect(DEFAULT_ADDITION_LINES.map((line) => line.id)).toEqual([
      'concreter', 'electrician', 'labourer1', 'labourer2', 'equipment', 'distributor',
      'accommodation', 'council', 'engineering', 'rubbish', 'delivery', 'concrete', 'demolition',
    ]);
    expect(DEFAULT_ADDITION_LINES.filter((line) => line.taxable).map((line) => line.id)).toEqual([
      'concreter', 'electrician', 'labourer1', 'labourer2', 'equipment', 'distributor',
    ]);
  });
});
