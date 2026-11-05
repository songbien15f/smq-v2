import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '../defaults';
import { normaliseOption, resolveOption } from '../options';
import type { OutriggerOption } from '../types';

const outrigger = (patch: Partial<OutriggerOption> = {}): OutriggerOption => ({
  id: 'og-1',
  kind: 'outrigger',
  wall: 'left',
  bay: 0,
  length: 1900,
  ...patch,
});

describe('outrigger mounting height', () => {
  it('defaults to 2000 mm and never exceeds the wall', () => {
    const standard = normaliseOption(outrigger(), DEFAULT_SHED);
    expect(standard.kind === 'outrigger' && standard.height).toBe(2000);

    const tooHigh = normaliseOption(outrigger({ height: 99_000 }), DEFAULT_SHED);
    expect(tooHigh.kind === 'outrigger' && tooHigh.height).toBe(DEFAULT_SHED.height);
  });

  it('draws the bracket at its mounting height, not at the eave', () => {
    const resolved = resolveOption(outrigger({ height: 2400 }), DEFAULT_SHED);
    expect(resolved.zLow).toBe(2400);
    expect(resolved.zHigh).toBe(2400);
  });
});
