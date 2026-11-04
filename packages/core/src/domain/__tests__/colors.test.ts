import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '../defaults';
import { COLOUR_ROLES, doorColour, migrateColors } from '../colors';

describe('migrateColors', () => {
  it('giữ nguyên ngoại hình của bản ghi 4 vai trò cũ', () => {
    const c = migrateColors({ wall: '#111111', roof: '#222222', trim: '#333333', door: '#444444' });
    expect(c.wall).toBe('#111111');
    expect(c.roof).toBe('#222222');
    expect([c.barge, c.gutter, c.downpipe]).toEqual(['#333333', '#333333', '#333333']);
    expect([c.window, c.paDoor, c.rollerDoor, c.slidingDoor]).toEqual([
      '#444444',
      '#444444',
      '#444444',
      '#444444',
    ]);
  });

  it('trả default cho đầu vào không đọc được', () => {
    expect(migrateColors(null)).toEqual(DEFAULT_SHED.colors);
    expect(migrateColors({ wall: 42 })).toEqual(DEFAULT_SHED.colors);
  });

  it('mọi vai trò đều có trong default', () => {
    expect(COLOUR_ROLES).toHaveLength(10);
    for (const role of COLOUR_ROLES) {
      expect(DEFAULT_SHED.colors[role]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('doorColour', () => {
  it('chọn vai trò theo loại cửa', () => {
    const c = DEFAULT_SHED.colors;
    expect(doorColour(c, 'window')).toBe(c.window);
    expect(doorColour(c, 'pa_door')).toBe(c.paDoor);
    expect(doorColour(c, 'sliding_door')).toBe(c.slidingDoor);
    expect(doorColour(c, 'roller_door')).toBe(c.rollerDoor);
    expect(doorColour(c, 'opening')).toBe(c.wall);
  });
});
