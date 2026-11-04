import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '../defaults';
import { baySpacingMismatch, reconcileBays } from '../bays';
import { normaliseShedConfig } from '../schema';

describe('reconcileBays', () => {
  it('tính bays và spacing từ length', () => {
    expect(reconcileBays({ length: 24000, bays: 4, nomBaySpacing: 0 })).toEqual({
      length: 24000,
      bays: 4,
      nomBaySpacing: 6000,
    });
  });

  it('tính length từ spacing × bays', () => {
    const r = reconcileBays({ length: 0, bays: 6, nomBaySpacing: 5000 });
    expect(r.length).toBe(30000);
    expect(r.bays).toBe(6);
    expect(r.nomBaySpacing).toBe(5000);
  });

  it('báo lệch khi spacing × bays khác length', () => {
    expect(baySpacingMismatch({ length: 24000, bays: 4, nomBaySpacing: 5000 })).toBe(true);
    expect(baySpacingMismatch({ length: 24000, bays: 4, nomBaySpacing: 6000 })).toBe(false);
  });
});

describe('normaliseShedConfig với trường mới', () => {
  it('điền default cho config cũ thiếu hết', () => {
    const c = normaliseShedConfig({ span: 9000, length: 18000, bays: 3 });
    expect(c.span).toBe(9000);
    expect(c.nomBaySpacing).toBe(6000);
    expect(c.wallProfile).toBe(DEFAULT_SHED.wallProfile);
    expect(c.footingType).toBe(DEFAULT_SHED.footingType);
    expect(c.endOpening).toEqual({ left: false, right: false });
    expect(c.buildingClass).toBeNull();
  });
});
