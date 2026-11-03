import { describe, it, expect } from 'vitest';
import { parseShedText, CENTRE_RE } from '../fallbackParser';

describe('parseShedText', () => {
  it('reads width, length, height and bays from a sentence', () => {
    const out = parseShedText('12m wide, 24m long, 4.2m high, 4 bays');
    expect(out.span).toBe(12000);
    expect(out.length).toBe(24000);
    expect(out.height).toBe(4200);
    expect(out.bays).toBe(4);
  });
  it('reads a roller door with a size and a wall', () => {
    const out = parseShedText('a 4.2 x 3.6 roller door centred on the front wall');
    expect(out.openings).toHaveLength(1);
    expect(out.openings![0]).toMatchObject({ type: 'roller_door', width: 4200, height: 3600, wall: 'front', align: 'center' });
  });
  it('reads a PA door with an offset and a swing direction', () => {
    const out = parseShedText('a PA door on the left wall opening outward 900 x 2100, 500mm from the corner');
    expect(out.openings![0]).toMatchObject({ type: 'pa_door', wall: 'left', swing: 'outward', align: 'custom', offset: 500 });
  });
  it('recognises skillion and gable', () => {
    expect(parseShedText('a skillion shed').structureType).toBe('skillion');
    expect(parseShedText('a gable shed').structureType).toBe('gable');
  });
  it('reads a roof pitch', () => {
    expect(parseShedText('gable shed with a 15 degree roof pitch').roofPitchDeg).toBe(15);
  });
  it('reads a roof pitch stated as "roof pitch of N"', () => {
    expect(parseShedText('gable shed with a roof pitch of 15').roofPitchDeg).toBe(15);
  });
  it('recognises the "centred" spelling as the centre alignment', () => {
    expect(parseShedText('a roller door centred on the front wall').openings![0].align).toBe('center');
    expect(parseShedText('a roller door centered on the front wall').openings![0].align).toBe('center');
  });
  it('matches the "centered" spelling directly (the default cannot mask it here)', () => {
    // `align` defaults to 'center' whenever no match is found, so the test above
    // passes for either regex. Pin the pattern itself: `/\b(centre|center|middle)d?\b/i`
    // does NOT match "centered" — the trailing "ed" breaks the word boundary, and
    // the optional "d?" only allows a single trailing "d".
    expect(CENTRE_RE.test('centered')).toBe(true);
    expect(CENTRE_RE.test('centred')).toBe(true);
    expect(CENTRE_RE.test('centre')).toBe(true);
    expect(CENTRE_RE.test('middle')).toBe(true);
    expect(CENTRE_RE.test('centered on the front wall')).toBe(true);
  });
  it('returns an empty object for text it cannot read', () => {
    expect(parseShedText('hello there')).toEqual({});
  });
  it('never throws on junk input', () => {
    expect(() => parseShedText('### 12x?? 4 bays ¥¥')).not.toThrow();
  });
});
