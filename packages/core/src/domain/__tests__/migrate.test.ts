import { describe, expect, it } from 'vitest';
import { TEST_SHED } from '../defaults';
import { migrateShedConfig } from '../schema';

describe('migrateShedConfig', () => {
  it('đọc được revision cũ 4 vai trò màu, giữ ngoại hình', () => {
    const old = {
      structureType: 'gable',
      span: 12000,
      length: 24000,
      height: 4200,
      roofPitchDeg: 10,
      bays: 4,
      openings: [],
      options: [],
      charges: [],
      internalPressure: 'closed',
      windRegion: 'A',
      terrainCategory: 2.5,
      shieldingFactor: 1,
      importanceLevel: 1,
      topographyFactor: 1,
      stateCode: 'QLD',
      displayUnit: 'm',
      colors: { wall: '#111111', roof: '#222222', trim: '#333333', door: '#444444' },
    };
    const c = migrateShedConfig(old);
    expect(c.colors.wall).toBe('#111111');
    expect(c.colors.gutter).toBe('#333333');
    expect(c.colors.rollerDoor).toBe('#444444');
    expect(c.colors.barge).toBe('#333333');
  });

  it('điền trường mới cho revision cũ thiếu', () => {
    const c = migrateShedConfig({ span: 9000, length: 18000, bays: 3 });
    expect(c.wallProfile).toBe(TEST_SHED.wallProfile);
    expect(c.nomBaySpacing).toBe(6000);
    expect(c.sideOpening).toEqual({ front: false, back: false });
  });

  it('không throw với đầu vào rác', () => {
    /*
     * Rác **không** sinh ra một toà nhà: các chiều là `null`.
     *
     * Dòng đầu từng so với `TEST_SHED.span` (12 000) — nghĩa là đọc một file hỏng lại cho ra một nhà
     * 12 m có thể báo giá được. Đó đúng là lỗi đợt này sửa: không mô tả thì không có số.
     */
    expect(migrateShedConfig('not a config').span).toBeNull();
    expect(migrateShedConfig(null).bays).toBe(TEST_SHED.bays);
  });
});
