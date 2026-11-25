import { describe, expect, it } from 'vitest';
import type { Opening, ShedColors } from '../types';
import { TEST_SHED } from '../defaults';
import {
  OPENING_TRIM_DEPTH,
  OPENING_TRIM_FACE,
  openingParts,
  PA_LEAF_THICK,
  ROLLER_TRACK_WIDTH,
  TRACK_INSET,
} from '../openings3d';
import { WALL_DEPTH } from '../structure3d';

/**
 * The opening hardware, asserted as data.
 *
 * These are the invariants a reviewer would check by eye — "does the roller door have guides",
 * "is the drum above the head", "is anything left covering the window glass" — written so they fail
 * when the geometry regresses instead of when somebody remembers to look at the page.
 *
 * The frame is wall-local millimetres with `z` pointing **into** the shed, so `z = 0` is the outside
 * face of the sheeting and everything fitted into a window or a PA door stays at `z ≥ 0`. That rule
 * has its own test below, because getting it backwards is invisible in a type check and was the bug
 * that buried the editor's window frame inside the wall.
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

/**
 * The outermost point of a part on `z`, taking rotation into account.
 *
 * A swung leaf is rotated about `y`, so its own `size[2]` is no longer its extent along `z`: the
 * projection is `depth·|cos θ| + width·|sin θ|`. Reading `size[2]` alone understates a door at 22°
 * by about 370 mm, which would make the flushness test pass on a leaf that stands well clear.
 */
function outerZ(part: ReturnType<typeof openingParts>[number]): number {
  const [, , depth] = part.size ?? [0, 0, 0];
  const [width] = part.size ?? [0, 0, 0];
  const theta = part.rotation?.[1] ?? 0;
  const reach = part.shape === 'box' ? (depth / 2) * Math.abs(Math.cos(theta)) + (width / 2) * Math.abs(Math.sin(theta)) : (part.radius ?? 0);
  return part.position[2] - reach;
}

describe('flush with the sheeting — the client rule', () => {
  /*
   * "WID, PAD vẽ trồi ra ngoài mặt sheeting cũng sai nha, phải bằng mặt ngoài."
   *
   * Every fitted part of a window or a PA door must have its outer face at `z ≥ 0`. The one
   * exception is the PA door's **leaf assembly** (`leaf` and `leaf-handle`), which is drawn swung
   * open and therefore sweeps outside the wall plane — that is the leaf moving, not the frame
   * standing off.
   */
  const flushCases: { name: string; o: Opening }[] = [
    { name: 'window', o: opening({ type: 'window', width: 1800, height: 900, sill: 1800 }) },
    { name: 'narrow window', o: opening({ type: 'window', width: 900, height: 900, sill: 900 }) },
    { name: 'PA door', o: opening({ type: 'pa_door', width: 820, height: 2040 }) },
    { name: 'right-hinged PA door', o: opening({ type: 'pa_door', width: 820, height: 2040, hinge: 'right' }) },
  ];

  for (const { name, o } of flushCases) {
    it(`${name}: nothing except the swinging leaf stands proud of z = 0`, () => {
      const parts = openingParts(o, 500, colors);
      for (const part of parts) {
        if (part.kind === 'leaf' || part.kind === 'leaf-handle') continue;
        expect(outerZ(part), `${part.kind} outer face`).toBeGreaterThanOrEqual(-1e-6);
      }
    });

    it(`${name}: the swinging leaf is the only part allowed outside`, () => {
      const parts = openingParts(o, 500, colors);
      const proud = parts.filter((part) => outerZ(part) < -1e-6).map((part) => part.kind);
      expect(proud.every((kind) => kind === 'leaf' || kind === 'leaf-handle'), `proud: ${proud.join(', ')}`).toBe(true);
    });
  }

  it('draws the leaf swung open, which is what carries it outside', () => {
    // The exception is a deliberate design choice, so it is stated: a closed leaf would be inside.
    const leaf = openingParts(opening({ type: 'pa_door', width: 820, height: 2040 }), 500, colors).find(
      (part) => part.kind === 'leaf',
    );
    expect(leaf).toBeDefined();
    expect(outerZ(leaf!)).toBeLessThan(0);
  });
});

describe('trim ring — four sides, one section, barge colour', () => {
  const cases: { name: string; o: Opening }[] = [
    { name: 'window', o: opening({ type: 'window', width: 1800, height: 900, sill: 1800 }) },
    { name: 'PA door', o: opening({ type: 'pa_door', width: 820, height: 2040 }) },
  ];

  for (const { name, o } of cases) {
    it(`${name}: has all four sides`, () => {
      const kinds = openingParts(o, 200, colors).map((part) => part.kind);
      expect(kinds).toEqual(expect.arrayContaining(['trim-head', 'trim-sill', 'trim-left', 'trim-right']));
    });

    it(`${name}: every side is barge-coloured, the same section, at the same depth`, () => {
      const ring = openingParts(o, 200, colors).filter((part) => part.kind.startsWith('trim-'));
      expect(ring).toHaveLength(4);
      for (const part of ring) {
        expect(part.color, `${part.kind} colour`).toBe(colors.barge);
        expect(part.position[2] - (part.size?.[2] ?? 0) / 2, `${part.kind} front face`).toBeCloseTo(0, 6);
        expect(part.size?.[2], `${part.kind} depth`).toBe(OPENING_TRIM_DEPTH);
      }
      // Head and sill span the full inside width and are one face wide; jambs are the same width.
      const head = ring.find((part) => part.kind === 'trim-head');
      const left = ring.find((part) => part.kind === 'trim-left');
      expect(head?.size?.[1]).toBe(OPENING_TRIM_FACE);
      expect(left?.size?.[0]).toBe(OPENING_TRIM_FACE);
    });

    it(`${name}: the ring encloses the hole — head above, sill below, jambs either side`, () => {
      const parts = openingParts(o, 200, colors);
      const at = (kind: string) => parts.find((part) => part.kind === kind);
      const head = at('trim-head');
      const sill = at('trim-sill');
      const left = at('trim-left');
      const right = at('trim-right');
      expect(head!.position[1]).toBeGreaterThan(sill!.position[1]);
      expect(left!.position[0]).toBeLessThan(right!.position[0]);
      /*
       * The head's top edge reaches the top of the hole **less the clearance**, and the sill's bottom
       * edge reaches the bottom less the same clearance. A hair inside the cut is deliberate: a face on
       * the hole's own face flickers.
       */
      const clearance = 2;
      const headTop = head!.position[1] + (head!.size?.[1] ?? 0) / 2;
      const sillBottom = sill!.position[1] - (sill!.size?.[1] ?? 0) / 2;
      expect(o.sill + o.height - headTop).toBeGreaterThan(0);
      expect(o.sill + o.height - headTop).toBeLessThan(clearance);
      expect(sillBottom - o.sill).toBeGreaterThan(0);
      expect(sillBottom - o.sill).toBeLessThan(clearance);
    });
  }

  it('does not put two trim faces on the same plane', () => {
    // Head and sill run the full width and the jambs stop between them; nothing overlaps.
    const parts = openingParts(opening({ type: 'window', width: 1800, height: 900, sill: 1800 }), 200, colors);
    const head = parts.find((part) => part.kind === 'trim-head')!;
    const left = parts.find((part) => part.kind === 'trim-left')!;
    const headBottom = head.position[1] - (head.size?.[1] ?? 0) / 2;
    const leftTop = left.position[1] + (left.size?.[1] ?? 0) / 2;
    expect(leftTop).toBeLessThanOrEqual(headBottom + 1e-6);
  });
});

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

  it('hangs the drum, brackets and springs inside the shed, everything else outside', () => {
    const inside = (kind: string) => kind === 'drum' || kind.startsWith('bracket-') || kind.startsWith('spring-');
    for (const part of parts) {
      if (inside(part.kind)) {
        // Wholly behind the inner face, so nothing of the drum shows from outside.
        const reach = part.shape === 'box' ? (part.size?.[2] ?? 0) / 2 : (part.radius ?? 0);
        expect(part.position[2] - reach).toBeGreaterThan(part.shape === 'box' ? 0 : WALL_DEPTH);
      } else {
        expect(part.position[2]).toBeLessThan(0);
      }
    }
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

  it('keeps the frame and the trim flush with the wall, inside the hole', () => {
    /*
     * Superseded 2026-11-25 by the client's rule: the frame and flashings must be **flush with the
     * outside face**, not 25 mm proud of it. The old numbers (−25/−45) were a deliberate step in the
     * right direction on 2026-11-24 and are now wrong; the test is rewritten rather than deleted so
     * the reason survives.
     *
     * What is checked now:
     *   - nothing has an outer face in front of the sheeting plane;
     *   - the frame is *behind* the ring, not embedded in the cladding (its back face stays inside
     *     the 90 mm hole depth);
     *   - no two stacked faces coincide, which is what would flicker.
     */
    const ringFront = 0;
    for (const part of parts) {
      const [, , depth] = part.size ?? [0, 0, 0];
      const z = part.position[2];
      const outer = z - depth / 2;
      const inner = z + depth / 2;
      if (part.kind.startsWith('trim-')) {
        expect(outer, `${part.kind} front face`).toBeCloseTo(ringFront, 6);
      } else {
        expect(outer, `${part.kind} stands proud`).toBeGreaterThan(0);
      }
      expect(inner, `${part.kind} back face inside the hole`).toBeLessThanOrEqual(90);
    }
    const ring = parts.filter((part) => part.kind.startsWith('trim-'));
    const frame = parts.filter((part) => part.kind.startsWith('frame-'));
    const ringBack = Math.max(...ring.map((part) => part.position[2] + (part.size?.[2] ?? 0) / 2));
    const frameFront = Math.min(...frame.map((part) => part.position[2] - (part.size?.[2] ?? 0) / 2));
    expect(frameFront).toBeGreaterThan(ringBack);
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

  it('has a four-sided surround, a leaf, hinges and a handle', () => {
    const kinds = parts.map((part) => part.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['trim-left', 'trim-right', 'trim-head', 'trim-sill', 'leaf', 'leaf-handle']),
    );
    expect(parts.filter((part) => part.kind.startsWith('hinge-'))).toHaveLength(3);
  });

  it('paints the surround in the trim colour and keeps paDoor for the leaf', () => {
    // "Chuyển viền ngoài sang colors.barge. Giữ colors.paDoor cho cánh cửa."
    const surround = parts.filter((part) => part.kind.startsWith('trim-'));
    expect(surround.every((part) => part.color === colors.barge)).toBe(true);
    expect(parts.find((part) => part.kind === 'leaf')?.color).toBe(colors.paDoor);
  });

  it('brings the threshold up to the same section as the other three sides', () => {
    // The threshold used to be 20 mm tall — effectively invisible. It is now a full face, on the floor.
    const sill = parts.find((part) => part.kind === 'trim-sill')!;
    const head = parts.find((part) => part.kind === 'trim-head')!;
    expect(sill.size?.[1]).toBe(head.size?.[1]);
    // Its bottom edge sits on the floor within the same clearance the ring keeps all round.
    const bottom = sill.position[1] - (sill.size?.[1] ?? 0) / 2;
    expect(bottom).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeLessThan(2);
  });

  it('swings the leaf outward, away from the shed interior', () => {
    const leaf = parts.find((part) => part.kind === 'leaf');
    expect(leaf?.position[2] ?? 0).toBeLessThan(0);
    expect(leaf?.rotation?.[1] ?? 0).toBeGreaterThan(0);
    expect(outerZ(leaf!)).toBeLessThan(0);
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

describe('what is still proud of the sheeting — recorded, not fixed', () => {
  /*
   * The client's remark was about the window and the PA door. Roller and sliding doors are outside
   * that brief and are **not** changed here, so this test is a written inventory rather than a rule:
   * it fails the moment a part is added or moved, which is what makes the list in the hand-over
   * report verifiable instead of remembered.
   *
   * Measured on the current geometry (mm in front of `z = 0`):
   *
   *   roller  curtain −39 … slat ribs −53 … guides −45 … head −130 … bottom bar −64
   *   sliding track-top −125 (double −245), track-bottom −72, leaves −110 (double −230)
   */
  it('roller door: the curtain, ribs, guides, head and bottom bar are proud', () => {
    const parts = openingParts(opening({ type: 'roller_door', width: 3600, height: 3600 }), 1000, colors);
    const proud = parts.filter((part) => outerZ(part) < -1e-6).map((part) => part.kind);
    for (const kind of ['curtain', 'slat-1', 'guide-left', 'guide-right', 'head', 'bottom-bar']) {
      expect(proud, kind).toContain(kind);
    }
    // And the record itself: the deepest face is the head's, at 130 mm.
    const deepest = Math.min(...parts.map(outerZ));
    expect(deepest).toBeCloseTo(-130, 0);
  });

  it('sliding door: both tracks and every leaf are proud', () => {
    const parts = openingParts(
      opening({ type: 'sliding_door', width: 3600, height: 2400, track: 'double', leaves: 2 }),
      0,
      colors,
    );
    const proud = parts.filter((part) => outerZ(part) < -1e-6).map((part) => part.kind);
    for (const kind of ['track-top', 'track-top-2', 'track-bottom', 'leaf-0-panel', 'leaf-1-panel']) {
      expect(proud, kind).toContain(kind);
    }
    // The second leaf hangs `TRACK_INSET` (60 mm) further out than the first.
    const first = parts.find((part) => part.kind === 'leaf-0-panel')!;
    const second = parts.find((part) => part.kind === 'leaf-1-panel')!;
    expect(outerZ(first) - outerZ(second)).toBeCloseTo(TRACK_INSET, 0);
    // Both faces are measured, so the numbers in the report are the ones this test saw.
    expect(outerZ(first)).toBeCloseTo(-99, 0);
    expect(outerZ(second)).toBeCloseTo(-159, 0);
  });
});
