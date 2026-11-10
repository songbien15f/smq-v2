import { describe, expect, it } from 'vitest';
import { averageHeightMm, ridgeHeightMm } from '../roof';

/**
 * The desktop's own formula, reproduced.
 *
 * ## Why a test per divisor rather than one worked example
 *
 * The divisor is the whole substance of the function: `4` for a gable, `2` for a skillion, from
 * `UcShowBuildingParameterss.cs:786-841`. A test with one building would pass with either divisor
 * swapped, because both produce plausible-looking metres. These numbers are computed by hand from the
 * formula and written as literals, so a change to the divisor fails the test rather than quietly
 * changing every council application the company lodges.
 *
 * Hand arithmetic for the gable case below (span 12 000, pitch 15°, height 3 600):
 *   tan(15°) = 0.267949
 *   rise = (12 000 / 4) × 0.267949 = 3 000 × 0.267949 = 803.85
 *   average = 3 600 + 803.85 = 4 403.85 → 4 404
 */
describe('averageHeightMm', () => {
  const gable = { structureType: 'gable' as const, span: 12000, height: 3600, roofPitchDeg: 15 };

  it('gable chia 4', () => {
    expect(averageHeightMm(gable)).toBe(4404);
  });

  it('skillion chia 2 — cùng công trình, cùng pitch, khác mái', () => {
    const skillion = { ...gable, structureType: 'skillion' as const };
    // rise = (12 000 / 2) × 0.267949 = 6 000 × 0.267949 = 1 607.69
    // average = 3 600 + 1 607.69 = 5 207.69 → 5 208
    expect(averageHeightMm(skillion)).toBe(5208);
  });

  it('skillion cao hơn gable với cùng span và pitch — đây là hệ quả của divisor', () => {
    const skillion = { ...gable, structureType: 'skillion' as const };
    expect(averageHeightMm(skillion)).toBeGreaterThan(averageHeightMm(gable) as number);
  });

  it('pitch 0 trả null, không trả wall height', () => {
    expect(averageHeightMm({ ...gable, roofPitchDeg: 0 })).toBeNull();
  });

  it('span hoặc height bằng 0 trả null', () => {
    expect(averageHeightMm({ ...gable, span: 0 })).toBeNull();
    expect(averageHeightMm({ ...gable, height: 0 })).toBeNull();
  });

  it('pitch lớn hơn cho average cao hơn', () => {
    const shallow = averageHeightMm({ ...gable, roofPitchDeg: 5 }) as number;
    const steep = averageHeightMm({ ...gable, roofPitchDeg: 25 }) as number;
    expect(steep).toBeGreaterThan(shallow);
  });
});

describe('ridgeHeightMm', () => {
  const gable = { structureType: 'gable' as const, span: 12000, height: 3600, roofPitchDeg: 15 };

  it('gable: đỉnh = wall + (span/2)·tan(pitch)', () => {
    // 3 600 + 6 000 × 0.267949 = 3 600 + 1 607.69 = 5 207.69 → 5 208
    expect(ridgeHeightMm(gable)).toBe(5208);
  });

  it('ridge luôn cao hơn average trên cùng một mái', () => {
    expect(ridgeHeightMm(gable) as number).toBeGreaterThan(averageHeightMm(gable) as number);
  });

  it('skillion: đỉnh = wall + span·tan(pitch)', () => {
    // 3 600 + 12 000 × 0.267949 = 3 600 + 3 215.39 = 6 815.39 → 6 815
    expect(ridgeHeightMm({ ...gable, structureType: 'skillion' as const })).toBe(6815);
  });
});
