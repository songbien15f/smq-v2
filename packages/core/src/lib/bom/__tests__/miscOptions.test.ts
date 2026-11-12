import { describe, expect, it } from 'vitest';
import { TEST_SHED } from '@/domain/defaults';
import type { MiscOption } from '@/domain/types';
import type { PriceLookup } from '@/lib/pricing/types';
import { miscOptionLines } from '../groups/misc';

function lookupFor(known: Record<string, { code: string; unitCost: number; massKg: number }>): PriceLookup {
  return {
    miscOption: (name: string) =>
      known[name] === undefined
        ? undefined
        : {
            code: known[name].code,
            description: name,
            unitCost: known[name].unitCost,
            massKg: known[name].massKg,
            rowKey: `misc_option|${name}`,
          },
  } as unknown as PriceLookup;
}

const misc = (patch: Partial<MiscOption> = {}): MiscOption => ({
  id: 'mo-1',
  kind: 'misc_option',
  name: 'Insulation',
  quantity: 1,
  unit: 'ea',
  ...patch,
});

describe('miscOptionLines', () => {
  it('prices one line from the catalogue, quantity × unit price', () => {
    const shed = { ...TEST_SHED, options: [misc({ quantity: 3 })] };
    const { lines, unknown } = miscOptionLines(
      shed,
      lookupFor({ Insulation: { code: 'INS', unitCost: 1250, massKg: 2 } }),
    );

    expect(unknown).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      group: 'misc',
      code: 'INS',
      description: 'Insulation',
      unit: 'ea',
      quantity: 3,
      unitCost: 1250,
      amount: 3750,
      massKg: 6,
    });
  });

  it('reports a name the book does not price instead of inventing a line', () => {
    const shed = { ...TEST_SHED, options: [misc({ name: 'Unobtainium' })] };
    const { lines, unknown } = miscOptionLines(shed, lookupFor({}));
    expect(lines).toEqual([]);
    expect(unknown).toEqual(['Unobtainium']);
  });

  it('skips a blank name and falls back to `ea` for an unknown unit', () => {
    const shed = {
      ...TEST_SHED,
      options: [misc({ name: '  ' }), misc({ id: 'mo-2', unit: 'furlong' })],
    };
    const { lines, unknown } = miscOptionLines(
      shed,
      lookupFor({ Insulation: { code: 'INS', unitCost: 100, massKg: 0 } }),
    );
    expect(unknown).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0].unit).toBe('ea');
  });
});
