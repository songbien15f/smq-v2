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

/**
 * Importance level is 1 to 4, and a level above 2 must survive.
 *
 * ## The defect these exist for
 *
 * `importanceLevel` was typed `1 | 2` in both the strict schema and the tolerant one, and the
 * tolerant one repairs with `.catch()` — so a certificate reading **3 was stored as 1**, with no
 * error, no warning, and a quote that printed "Importance level 1" against a certificate saying 3.
 * Measured 2026-11-10: `normaliseShedConfig({ importanceLevel: 3 }).importanceLevel === 1`.
 *
 * The price book has no frame table for 3 or 4 (1 077 rows at level 1, 1 675 at level 2, none above),
 * so a level-3 quote prices its frame from one assumed section. That is the **honest** outcome and it
 * is reported as an assumption. Silently rewriting the level is not.
 */
describe('importance level 1 to 4', () => {
  it('giữ nguyên cả bốn mức qua normaliseShedConfig', () => {
    for (const level of [1, 2, 3, 4] as const) {
      const config = normaliseShedConfig({ ...DEFAULT_SHED, importanceLevel: level });
      expect(config.importanceLevel, `level ${level} must not be rewritten`).toBe(level);
    }
  });

  it('không hạ 3 và 4 xuống 1 — đây chính là lỗi cũ', () => {
    expect(normaliseShedConfig({ ...DEFAULT_SHED, importanceLevel: 3 }).importanceLevel).not.toBe(1);
    expect(normaliseShedConfig({ ...DEFAULT_SHED, importanceLevel: 4 }).importanceLevel).not.toBe(1);
  });

  it('một giá trị ngoài 1..4 vẫn rơi về default, không phải NaN', () => {
    expect(normaliseShedConfig({ ...DEFAULT_SHED, importanceLevel: 7 }).importanceLevel).toBe(
      DEFAULT_SHED.importanceLevel,
    );
  });

  it('default là 2, khớp desktop và khớp pinRequest', () => {
    expect(DEFAULT_SHED.importanceLevel).toBe(2);
  });
});
