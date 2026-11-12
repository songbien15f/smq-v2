import { describe, expect, it } from 'vitest';
import { TEST_SHED } from '@/domain/defaults';
import type { Opening } from '@/domain/types';
import {
  buildingSlidingDoors,
  headFlashingType,
  slidingDoorMembers,
  splitRun,
} from '../slidingDoors';

const sliding = (patch: Partial<Opening> = {}): Opening => ({
  id: 'sld-1',
  type: 'sliding_door',
  width: 3000,
  height: 2100,
  sill: 0,
  wall: 'front',
  align: 'center',
  offset: null,
  swing: null,
  track: 'single',
  ...patch,
});

describe('splitRun', () => {
  it('leaves a run shorter than a stock length as one piece', () => {
    expect(splitRun(3000)).toEqual({ quantity: 1, eachMm: 3000 });
  });

  it('splits a long run into equal pieces, not a long one and an offcut', () => {
    // 13 000 over 6 000 is 3 pieces, so 4 333 each. Two of 6 000 and one of 1 000 would
    // leave an offcut nobody can use and a joint without a bracket.
    expect(splitRun(13000)).toEqual({ quantity: 3, eachMm: 4333 });
  });

  it('gives exactly the stock length when the run divides evenly', () => {
    expect(splitRun(12000)).toEqual({ quantity: 2, eachMm: 6000 });
  });

  it('gives nothing for a run of zero', () => {
    expect(splitRun(0)).toEqual({ quantity: 0, eachMm: 0 });
  });
});

describe('headFlashingType', () => {
  it('uses the deep flashing for a double track', () => {
    expect(headFlashingType(sliding({ track: 'double' }))).toBe('SLD_HEAD_FLASHING');
  });

  it('uses the shallow one for a single track', () => {
    expect(headFlashingType(sliding({ track: 'single' }))).toBe('SLD_SINGLE_HEAD_FLASHING');
  });

  it('treats a door with no track as single, which is what the book sells', () => {
    expect(headFlashingType(sliding({ track: 'none' }))).toBe('SLD_SINGLE_HEAD_FLASHING');
  });
});

describe('slidingDoorMembers', () => {
  it('gives a door a head beam and a head flashing', () => {
    const members = slidingDoorMembers(TEST_SHED, sliding());
    expect(members.map((member) => member.item)).toEqual(['sld_header', 'sld_head_flashing']);
    expect(members[0]?.lengthMm).toBe(3000);
    expect(members[0]?.quantity).toBe(1);
  });

  it('laps the flashing 200 mm past the beam it covers', () => {
    // A flashing exactly as long as the beam has nothing to turn down at either end, and
    // the rain goes behind it.
    const members = slidingDoorMembers(TEST_SHED, sliding());
    const header = members.find((member) => member.item === 'sld_header')!;
    const flashing = members.find((member) => member.item === 'sld_head_flashing')!;
    expect(flashing.lengthMm - header.lengthMm).toBe(200);
  });

  it('splits a wide door into equal pieces', () => {
    const wide = sliding({ width: 7000 });
    const header = slidingDoorMembers(TEST_SHED, wide).find(
      (member) => member.item === 'sld_header',
    );
    expect(header?.quantity).toBe(2);
    expect(header?.lengthMm).toBe(3500);
  });

  it('gives nothing for a door that is not a sliding door', () => {
    expect(slidingDoorMembers(TEST_SHED, sliding({ type: 'pa_door' }))).toEqual([]);
  });
});

describe('buildingSlidingDoors', () => {
  it('covers every sliding door and no other opening', () => {
    const shed = {
      ...TEST_SHED,
      openings: [
        sliding({ id: 'a' }),
        sliding({ id: 'b', width: 4000 }),
        { ...sliding({ id: 'c' }), type: 'pa_door' as const },
      ],
    };
    const members = buildingSlidingDoors(shed);
    const ids = new Set(members.map((member) => member.openingId));
    expect([...ids].sort()).toEqual(['a', 'b']);
    // Two members per door.
    expect(members).toHaveLength(4);
  });

  it('gives nothing on a building with no sliding door', () => {
    expect(buildingSlidingDoors(TEST_SHED)).toEqual([]);
  });
});
