import { describe, expect, it } from 'vitest';
import type { Opening, ShedColors } from '../types';
import { TEST_SHED } from '../defaults';
import { openingParts, ROLLER_TRACK_WIDTH, TRACK_INSET } from '../openings3d';

/**
 * The opening hardware, asserted as data.
 *
 * These are the invariants a reviewer would check by eye — "does the roller door have guides",
 * "is the drum above the head", "is anything left covering the window glass" — written so they fail
 * when the geometry regresses instead of when somebody remembers to look at the page.
 *
 * The frame is wall-local millimetres with `z` pointing **into** the shed, so every piece of
 * hardware on the outside face must have `z < 0`. Getting that backwards is invisible in a type
 * check and was the bug that buried the editor's window frame inside the wall.
 */

function opening(overrides: Partial<Opening> & Pick<Opening, 'type'>): Opening {
  return {
    id: 'test',
    width: 2000,
    height: 2000,
    sill: 0,
    wall: 'front',
    align: 'custom',
    offset: 0,
    swing: null,
    track: null,
    ...overrides,
  };
}

const colors: ShedColors = TEST_SHED.colors;

describe('roller door', () => {
  const door = opening({ type: 'roller_door', width: 3600, height: 3600 });
  const parts = openingParts(door, 1000, colors);

  it('has a guide each side, a curtain, a head and a drum', () => {
    const kinds = parts.map((part) => part.kind);
    expect(kinds).toContain('guide-left');
    expect(kinds).toContain('guide-right');
    expect(kinds).toContain('curtain');
    expect(kinds).toContain('head');
    expect(kinds).toContain('drum');
  });

  it('puts the drum and the springs above the head', () => {
    const drum = parts.find((part) => part.kind === 'drum');
    const head = parts.find((part) => part.kind === 'head');
    expect(drum?.position[1] ?? 0).toBeGreaterThan(head?.position[1] ?? 0);
    expect(drum?.position[1] ?? 0).toBeGreaterThan(door.height);
  });

  it('stands every piece of hardware proud of the wall, never inside the shed', () => {
    for (const part of parts) expect(part.position[2]).toBeLessThan(0);
  });

  it('never puts a face coplanar with the wall surface', () => {
    /*
     * A guide's back face used to land exactly on `z = 0` — the cladding's outside plane — so the two
     * surfaces fought for the same depth and the wall flickered as the camera moved. Sunk 10 mm in,
     * the back face is inside the cladding volume and the front still stands clear.
     */
    for (const part of parts) {
      if (part.shape !== 'box' || part.size === undefined) continue;
      const back = part.position[2] + part.size[2] / 2;
      expect(Math.abs(back)).toBeGreaterThan(0.5);
    }
  });

  it('cuts the curtain with slat ribs rather than leaving one flat sheet', () => {
    expect(parts.filter((part) => part.kind.startsWith('slat-')).length).toBeGreaterThan(8);
  });

  it('keeps the curtain inside the opening so the guides are not buried', () => {
    const curtain = parts.find((part) => part.kind === 'curtain');
    expect(curtain?.size?.[0] ?? 0).toBeLessThan(door.width);
  });

  it('uses the same guide width as the 2D plan symbol', () => {
    // One number for both views: a plan tick and a 3D rail are the same 45 mm.
    const guide = parts.find((part) => part.kind === 'guide-left');
    expect(guide?.size?.[0]).toBe(ROLLER_TRACK_WIDTH);
  });
});

describe('window', () => {
  const win = opening({ type: 'window', width: 1800, height: 900, sill: 1800 });
  const parts = openingParts(win, 500, colors);

  it('has a frame ring, glass and a mullion above 900 mm', () => {
    const kinds = parts.map((part) => part.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['glass', 'frame-left', 'frame-right', 'frame-head', 'frame-sill', 'mullion']),
    );
  });

  it('leaves the glass visible: no solid part covers the whole opening', () => {
    // A single box larger than the hole is what the editor drew for a while: the glass sat on a
    // solid panel, so the window read as a painted rectangle.
    const solid = parts.filter((part) => part.kind !== 'glass' && part.shape === 'box');
    for (const part of solid) {
      const [w, h] = part.size ?? [0, 0];
      expect(w >= win.width && h >= win.height).toBe(false);
    }
  });

  it('omits the mullion on a narrow window', () => {
    const narrow = openingParts(opening({ type: 'window', width: 900, height: 900, sill: 1200 }), 0, colors);
    expect(narrow.some((part) => part.kind === 'mullion')).toBe(false);
  });

  it('sits at the sill it was given', () => {
    const glass = parts.find((part) => part.kind === 'glass');
    expect(glass?.position[1]).toBeCloseTo(win.sill + win.height / 2);
  });
});

describe('PA door', () => {
  const door = opening({ type: 'pa_door', width: 900, height: 2100 });
  const parts = openingParts(door, 200, colors);

  it('has a frame, a leaf, hinges and a handle', () => {
    const kinds = parts.map((part) => part.kind);
    expect(kinds).toEqual(expect.arrayContaining(['frame-left', 'frame-right', 'leaf', 'handle']));
    expect(parts.filter((part) => part.kind.startsWith('hinge-'))).toHaveLength(3);
  });

  it('swings the leaf outward, away from the shed interior', () => {
    const leaf = parts.find((part) => part.kind === 'leaf');
    expect(leaf?.position[2] ?? 0).toBeLessThan(0);
    expect(leaf?.rotation?.[1] ?? 0).toBeGreaterThan(0);
  });

  it('hangs a right-hinged leaf on the far jamb, mirrored', () => {
    const right = openingParts(opening({ type: 'pa_door', width: 900, height: 2100, hinge: 'right' }), 200, colors);
    const left = openingParts(opening({ type: 'pa_door', width: 900, height: 2100, hinge: 'left' }), 200, colors);
    const rightLeaf = right.find((part) => part.kind === 'leaf');
    const leftLeaf = left.find((part) => part.kind === 'leaf');
    // Mirrored about the middle of the opening, and swung the other way.
    expect(rightLeaf?.position[0]).toBeCloseTo(200 + 900 - ((leftLeaf?.position[0] ?? 0) - 200));
    expect(Math.sign(rightLeaf?.rotation?.[1] ?? 0)).toBe(-Math.sign(leftLeaf?.rotation?.[1] ?? 1));
  });

  it('defaults to the left jamb when the config says nothing', () => {
    const silent = openingParts(opening({ type: 'pa_door', width: 900, height: 2100 }), 200, colors);
    const explicit = openingParts(opening({ type: 'pa_door', width: 900, height: 2100, hinge: 'left' }), 200, colors);
    expect(silent.map((part) => part.position)).toEqual(explicit.map((part) => part.position));
  });
});

describe('sliding door', () => {
  it('draws two leaves and two tracks for a double track with two leaves', () => {
    const parts = openingParts(
      opening({ type: 'sliding_door', width: 3600, height: 2400, track: 'double', leaves: 2 }),
      0,
      colors,
    );
    expect(parts.filter((part) => part.kind.endsWith('-panel'))).toHaveLength(2);
    expect(parts.filter((part) => part.kind.startsWith('track-top'))).toHaveLength(2);
  });

  it('draws one leaf when the door was sold with one, even on a double track', () => {
    const parts = openingParts(
      opening({ type: 'sliding_door', width: 3600, height: 2400, track: 'double', leaves: 1 }),
      0,
      colors,
    );
    expect(parts.filter((part) => part.kind.endsWith('-panel'))).toHaveLength(1);
    expect(parts.filter((part) => part.kind.startsWith('track-top'))).toHaveLength(2);
  });

  it('draws one track for a single track', () => {
    const parts = openingParts(
      opening({ type: 'sliding_door', width: 3600, height: 2400, track: 'single', leaves: 2 }),
      0,
      colors,
    );
    expect(parts.filter((part) => part.kind.startsWith('track-top'))).toHaveLength(1);
  });

  it('hangs the two leaves at different depths so they can pass each other', () => {
    const parts = openingParts(
      opening({ type: 'sliding_door', width: 3600, height: 2400, track: 'double', leaves: 2 }),
      0,
      colors,
    );
    const panels = parts.filter((part) => part.kind.endsWith('-panel'));
    expect(panels[0]?.position[2]).not.toBe(panels[1]?.position[2]);
  });

  it('sets the leaf depth from the same constant the plan uses', () => {
    const parts = openingParts(
      opening({ type: 'sliding_door', width: 3000, height: 2400, track: 'single', leaves: 1 }),
      0,
      colors,
    );
    const panel = parts.find((part) => part.kind.endsWith('-panel'));
    expect(panel?.position[2]).toBe(-TRACK_INSET - 25);
  });
});

describe('a plain opening', () => {
  it('has no parts: the wall is cut and nothing is fitted', () => {
    expect(openingParts(opening({ type: 'opening' }), 0, colors)).toEqual([]);
  });
});
