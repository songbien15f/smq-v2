import { describe, expect, it } from 'vitest';
import { TEST_SHED } from '@/domain/defaults';
import type {  Opening, ShedConfig, DimensionedShed } from '@/domain/types';
import {
  buildDoorFrameMembers,
  doorFrameSetback,
  headerLengthMm,
  mullionLengthMm,
  rollerDoorColumnCount,
  type DoorFrameGeometry,
} from '../doorFrames';

const shed = (patch: Partial<DimensionedShed> = {}): DimensionedShed => ({ ...TEST_SHED, ...patch });

const roller = (patch: Partial<Opening> = {}): Opening => ({
  id: 'rd-1',
  type: 'roller_door',
  width: 3000,
  height: 2400,
  sill: 0,
  wall: 'front',
  align: 'center',
  offset: null,
  swing: null,
  track: null,
  series: 'B',
  ...patch,
});

/** The reference book's sections for a 12 m gable: DM = Z15019, DH = C15012. */
const geometry = (patch: Partial<DoorFrameGeometry> = {}): DoorFrameGeometry => ({
  headerSection: 'C15012',
  mullionSection: 'Z15019',
  mullionDepth: 65,
  endColumnDepth: 152,
  girtDepth: 64,
  centreMm: 90,
  kneeEdgeCode: 92,
  endRafterDepth: 152,
  footingAllowanceMm: 450,
  postInGround: true,
  ...patch,
});

describe('doorFrameSetback', () => {
  it('sets the frame in by half the girt and column depth less the punch centre', () => {
    // (2 × 64 + 152 − 90) / 2 = 95.
    expect(doorFrameSetback(geometry())).toBe(95);
  });

  it('truncates, because a framework clash is a clash', () => {
    // (2 × 63 + 151 − 90) / 2 = 93.5 → 93.
    expect(doorFrameSetback(geometry({ girtDepth: 63, endColumnDepth: 151 }))).toBe(93);
  });
});

describe('rollerDoorColumnCount', () => {
  it('gives two posts for an ordinary door', () => {
    expect(rollerDoorColumnCount(shed(), roller(), [])).toBe(2);
  });

  it('gives none when the corner columns already stand where the posts would', () => {
    /*
     * The desktop's odd case: one door, equal gaps either side, and `gap + curtain/2`
     * measuring exactly 215 mm. A style-B door's curtain is 100 mm, so the gap is 165 mm
     * and a 3 000 mm door needs a 3 330 mm wall.
     */
    const wall = 3000 + 2 * 165;
    expect(rollerDoorColumnCount(shed({ span: wall }), roller(), [])).toBe(0);
  });

  it('still gives two posts when the gaps are equal but the wrong size', () => {
    // Equal gaps of 500 mm: symmetric, but the corner columns do not line up with the
    // jambs, so the door still needs its posts.
    expect(rollerDoorColumnCount(shed({ span: 4000 }), roller(), [])).toBe(2);
  });
});

describe('headerLengthMm', () => {
  it('spans between the infill columns either side of the door', () => {
    // Columns at 2 000 and 6 000; a door 4 500..7 500 sits between 2 000 and... the
    // first column at or past its far edge is none, so the header is the clear opening.
    const positions = [2000, 6000];
    const door = roller({ width: 3000, align: 'custom', offset: 3000 });
    // Door 3 000..6 000. The column at 6 000 is at its far edge, and it is index 1 of the
    // run, so the header laps 45 mm past the column before it.
    expect(headerLengthMm(shed(), door, positions)).toBe(6000 - 2000 + 45);
  });

  it('falls back to the clear opening when the gable has no infill columns', () => {
    // A style-B curtain is 100 mm, so a 3 000 mm door's clear opening is 2 900.
    const door = roller({ width: 3000 });
    expect(headerLengthMm(shed(), door, [])).toBe(2900);
  });

  it('laps 45 mm when the far column is the end of the run', () => {
    // Columns 1 000, 3 000, 7 000. A door 1 000..3 000: the first column at or past its
    // far edge is index 1, which takes the lap.
    const door = roller({ width: 2000, align: 'custom', offset: 1000 });
    expect(headerLengthMm(shed(), door, [1000, 3000, 7000])).toBe(3000 - 1000 + 45);
  });

  it('takes the curtain off a style-A door at 50 mm, not 100', () => {
    const door = roller({ width: 3000, series: 'A' });
    expect(headerLengthMm(shed(), door, [])).toBe(2950);
  });
});

describe('mullionLengthMm', () => {
  it('stops a free-standing post at the header', () => {
    // Door head 2 400 + 290 (style B) + 450 footing = 3 140.
    const door = roller({ height: 2400, series: 'B' });
    expect(mullionLengthMm(shed(), door, geometry(), [])).toBe(3140);
  });

  it('runs a post that lands under an infill column up to the roof', () => {
    // The post is a rafter-side member: it goes to the eave and follows the pitch.
    const door = roller({ height: 2400, width: 3000, align: 'custom', offset: 4000 });
    const onColumn = [4500, 8000];
    const withColumn = mullionLengthMm(shed(), door, geometry(), onColumn);
    const freeStanding = mullionLengthMm(shed(), door, geometry(), []);
    expect(withColumn).not.toBe(freeStanding);
    expect(withColumn).toBeGreaterThan(0);
  });

  it('gives a style-A door 150 mm above the head and a B 290', () => {
    const a = mullionLengthMm(shed(), roller({ series: 'A', height: 2400 }), geometry(), []);
    const b = mullionLengthMm(shed(), roller({ series: 'B', height: 2400 }), geometry(), []);
    expect(b - a).toBe(140);
  });

  it('drops the footing for a post bolted to a slab', () => {
    const inGround = mullionLengthMm(shed(), roller(), geometry(), []);
    const onSlab = mullionLengthMm(shed(), roller(), geometry({ postInGround: false }), []);
    expect(inGround - onSlab).toBe(450);
  });
});

describe('buildDoorFrameMembers', () => {
  it('gives every roller door a header and a post pair', () => {
    const members = buildDoorFrameMembers(shed({ openings: [roller()] }), geometry(), []);
    const header = members.find((member) => member.item === 'door_header');
    const column = members.find((member) => member.item === 'door_column');
    expect(header?.section).toBe('C15012');
    expect(header?.quantity).toBe(1);
    expect(column?.section).toBe('Z15019');
    expect(column?.quantity).toBe(2);
  });

  it('adds a second header for a style-AA door', () => {
    const withAA = shed({ openings: [roller({ series: 'AA' })] });
    const header = buildDoorFrameMembers(withAA, geometry(), []).find(
      (member) => member.item === 'door_header',
    );
    expect(header?.quantity).toBe(2);
  });

  it('adds a dropper only for a door 5 100 mm or wider', () => {
    const narrow = buildDoorFrameMembers(shed({ openings: [roller()] }), geometry(), []);
    expect(narrow.some((member) => member.item === 'door_dropper')).toBe(false);

    // A 5 100 door needs a wall at least 5 300 wide with the 100 mm margins.
    const wide = shed({ span: 6000, openings: [roller({ width: 5100 })] });
    const dropper = buildDoorFrameMembers(wide, geometry(), []).find(
      (member) => member.item === 'door_dropper',
    );
    expect(dropper?.section).toBe('C15012');
    expect(dropper?.lengthMm).toBe(1000);
    expect(dropper?.quantity).toBe(1);
  });

  it('frames each door separately when a wall has two', () => {
    const two = shed({
      span: 9000,
      openings: [
        roller({ id: 'a', width: 2400, align: 'custom', offset: 200 }),
        roller({ id: 'b', width: 2400, align: 'custom', offset: 6000 }),
      ],
    });
    const members = buildDoorFrameMembers(two, geometry(), []);
    const headers = members.filter((member) => member.item === 'door_header');
    expect(headers).toHaveLength(2);
    expect(headers.map((header) => header.openingId).sort()).toEqual(['a', 'b']);
  });

  it('gives back nothing when the book names no door sections', () => {
    // A book with no `DM`/`DH` cannot describe the frame. An empty list is honest; a
    // guessed section would price steel nobody sells.
    const none = buildDoorFrameMembers(
      shed({ openings: [roller()] }),
      geometry({ headerSection: null, mullionSection: null }),
      [],
    );
    expect(none).toEqual([]);
  });

  it('frames a roller door but ignores every other opening type', () => {
    const mixed = shed({
      openings: [
        roller({ id: 'rd' }),
        {
          id: 'pd',
          type: 'pa_door',
          width: 820,
          height: 2040,
          sill: 0,
          wall: 'left',
          align: 'center',
          offset: null,
          swing: null,
          track: null,
        },
      ],
    });
    const members = buildDoorFrameMembers(mixed, geometry(), []);
    expect(members.every((member) => member.openingId === 'rd')).toBe(true);
  });
});
