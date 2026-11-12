import { describe, expect, it } from 'vitest';
import { TEST_SHED } from '../defaults';
import { normaliseOption, resolveOption } from '../options';
import type { AwningOption } from '../types';

const awning = (patch: Partial<AwningOption> = {}): AwningOption => ({
  id: 'aw-1',
  kind: 'awning',
  wall: 'front',
  align: 'center',
  offset: null,
  width: 3000,
  depth: 1000,
  ...patch,
});

describe('awning pitch', () => {
  it('defaults to 5 degrees and clamps a wild value to 45', () => {
    const standard = normaliseOption(awning(), TEST_SHED);
    expect(standard.kind === 'awning' && standard.pitchDeg).toBe(5);

    const steep = normaliseOption(awning({ pitchDeg: 90 }), TEST_SHED);
    expect(steep.kind === 'awning' && steep.pitchDeg).toBe(45);
  });

  it('drops the outer edge by the pitch over the projection', () => {
    const resolved = resolveOption(awning({ pitchDeg: 10 }), TEST_SHED);
    // tan(10°) × 1000 mm ≈ 176 mm below the wall height.
    expect(resolved.zHigh).toBe(TEST_SHED.height);
    expect(resolved.zLow).toBe(TEST_SHED.height - 176);
  });

  it('leaves a flat awning at wall height', () => {
    const resolved = resolveOption(awning({ pitchDeg: 0 }), TEST_SHED);
    expect(resolved.zLow).toBe(TEST_SHED.height);
  });
});
