import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '@/domain/defaults';
import { normaliseOption } from '@/domain/options';
import type { SkylightOption } from '@/domain/types';
import type { PriceLookup } from '@/lib/pricing/types';
import { skylightLines } from '../options';

const skylight = (patch: Partial<SkylightOption> = {}): SkylightOption => ({
  id: `sk-${Math.random()}`,
  kind: 'skylight',
  bay: 0,
  alongBay: 0.5,
  width: 900,
  height: 900,
  ...patch,
});

function lookup(): PriceLookup {
  return {
    sheeting: (profile: string) => ({
      code: profile,
      description: profile,
      unitCost: 1000,
      massKg: 1,
      rowKey: `sheeting|${profile}`,
      profile,
      bmt: 0.42,
      coverageMm: 762,
      roofInternalSpanMm: 0,
      roofEndSpanMm: 0,
      wallInternalSpanMm: 0,
      wallEndSpanMm: 0,
      wallSideSpanMm: 0,
    }),
  } as unknown as PriceLookup;
}

describe('skylight type', () => {
  it('defaults to Corro and keeps TL-5', () => {
    const corro = normaliseOption(skylight(), DEFAULT_SHED);
    expect(corro.kind === 'skylight' && corro.skylightType).toBe('Corro');

    const tl5 = normaliseOption(skylight({ skylightType: 'TL-5' }), DEFAULT_SHED);
    expect(tl5.kind === 'skylight' && tl5.skylightType).toBe('TL-5');
  });

  it('prices each type on its own line', () => {
    const shed = {
      ...DEFAULT_SHED,
      options: [
        skylight({ skylightType: 'Corro' }),
        skylight({ skylightType: 'TL-5' }),
        skylight({ skylightType: 'TL-5' }),
      ],
    };
    const lines = skylightLines(shed, lookup());
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.quantity)).toEqual([1, 2]);
    expect(lines.map((line) => line.code)).toEqual(['Corro', 'TL-5']);
  });
});
