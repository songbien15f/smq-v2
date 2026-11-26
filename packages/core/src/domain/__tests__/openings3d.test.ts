import { describe, expect, it } from 'vitest';
import type { Opening, ShedColors } from '../types';
import { TEST_SHED } from '../defaults';
import {
  OPENING_CLEARANCE,
  OPENING_TRIM_DEPTH,
  OPENING_TRIM_FACE,
  openingParts,
  PA_LEAF_THICK,
  ROLLER_GUIDE_SINK,
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
   * Every fitted part of an opening must have its outer face at `z ≥ 0`. The **only** exception in the
   * whole set is the PA door's leaf assembly (`leaf`, `leaf-handle`), which is drawn swung open and
   * therefore sweeps outside the wall plane — that is the leaf moving, not the frame standing off.
   *
   * A roller door has **no** exception (round 3): it is mounted on the inside face of the opening, so
   * nothing of it belongs in front of the sheeting at all.
   */
  const flushCases: { name: string; o: Opening; except: string[] }[] = [
    { name: 'window', o: opening({ type: 'window', width: 1800, height: 900, sill: 1800 }), except: [] },
    { name: 'narrow window', o: opening({ type: 'window', width: 900, height: 900, sill: 900 }), except: [] },
    { name: 'PA door', o: opening({ type: 'pa_door', width: 820, height: 2040 }), except: ['leaf', 'leaf-handle'] },
    {
      name: 'right-hinged PA door',
      o: opening({ type: 'pa_door', width: 820, height: 2040, hinge: 'right' }),
      except: ['leaf', 'leaf-handle'],
    },
    {
      name: 'roller door',
      o: opening({ type: 'roller_door', width: 3600, height: 3600 }),
      except: [],
    },
  ];

  for (const { name, o, except } of flushCases) {
    it(`${name}: nothing${except.length === 0 ? '' : ' except the swinging leaf'} stands proud of z = 0`, () => {
      const parts = openingParts(o, 500, colors);
      for (const part of parts) {
        if (except.includes(part.kind)) continue;
        expect(outerZ(part), `${part.kind} outer face`).toBeGreaterThanOrEqual(-1e-6);
      }
    });

    it(`${name}: only the stated exception may be outside`, () => {
      const parts = openingParts(o, 500, colors);
      const proud = parts.filter((part) => outerZ(part) < -1e-6).map((part) => part.kind);
      expect(proud.every((kind) => except.includes(kind)), `proud: ${proud.join(', ')}`).toBe(true);
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

describe('roller door — mounted on the inside face', () => {
  /*
   * A roller door in an Australian shed is fixed to the **inside** of the opening: the guides bolt to
   * the inner face of the reveal, the curtain hangs from the front of the drum. Drawn the old way —
   * curtain, ribs, guides and a 130 mm head standing outside the sheeting — it read as a shutter bolted
   * to the wall. These tests are the drawing's version of "installed properly".
   */
  const roller = opening({ type: 'roller_door', width: 3600, height: 3600 });
  const parts = openingParts(roller, 1000, colors);
  const at = (kind: string) => parts.find((part) => part.kind === kind);
  /** A box's near and far face on z. */
  const faces = (kind: string): [number, number] => {
    const part = at(kind)!;
    const [sx = 0, , sz = 0] = part.size ?? [];
    const t = part.rotation?.[1] ?? 0;
    const half = (sz / 2) * Math.abs(Math.cos(t)) + (sx / 2) * Math.abs(Math.sin(t));
    return [part.position[2] - half, part.position[2] + half];
  };

  it('rule 2: the jambs reach the floor of the reveal and meet the head', () => {
    /*
     * With no sill, the jambs must run all the way down: the head takes one face off the top, and
     * nothing takes one off the bottom. Drawn with the four-sided formula (`innerH − 2·face`) they
     * stopped 46.5 mm short of the floor, leaving a notch of grey sheeting at the foot of each jamb,
     * exactly where the base trim ends (round 3b review).
     *
     * The expected numbers are read off the parts, not written by hand: `head` gives the top, and the
     * ring's own clearance gives the bottom.
     */
    const head = at('trim-head')!;
    const headBottom = head.position[1] - (head.size?.[1] ?? 0) / 2;
    const revealFloor = 0 + OPENING_CLEARANCE; // the door's sill is 0; the ring clears the cut edge
    for (const kind of ['trim-left', 'trim-right']) {
      const jamb = at(kind)!;
      const bottom = jamb.position[1] - (jamb.size?.[1] ?? 0) / 2;
      const top = jamb.position[1] + (jamb.size?.[1] ?? 0) / 2;
      expect(bottom, `${kind} bottom`).toBeCloseTo(revealFloor, 6);
      expect(top, `${kind} top meets the head`).toBeCloseTo(headBottom, 6);
      // And it is still one solid bar, not two pieces.
      expect(jamb.size?.[1], `${kind} height`).toBeGreaterThan(0);
    }
  });

  it('rule 2: a three-sided trim ring, no sill, the same section as the other openings', () => {
    const ring = parts.filter((part) => part.kind.startsWith('trim-'));
    expect(ring.map((part) => part.kind).sort()).toEqual(['trim-head', 'trim-left', 'trim-right']);
    for (const part of ring) {
      expect(part.color, `${part.kind} colour`).toBe(colors.barge);
      expect(part.finish, `${part.kind} finish`).toBe('trim');
      expect(part.size?.[2], `${part.kind} depth`).toBe(OPENING_TRIM_DEPTH);
      expect(part.position[2] - (part.size?.[2] ?? 0) / 2, `${part.kind} front face`).toBeCloseTo(0, 6);
    }
    // The head and both jambs are one face wide, exactly like the window's and the PA door's ring.
    expect(at('trim-head')?.size?.[1]).toBe(OPENING_TRIM_FACE);
    expect(at('trim-left')?.size?.[0]).toBe(OPENING_TRIM_FACE);
    expect(at('trim-right')?.size?.[0]).toBe(OPENING_TRIM_FACE);
    // A car drives over the threshold, so there is no sill bar.
    expect(at('trim-sill')).toBeUndefined();
  });

  it('rule 2: the ring is the same section as the PA door’s, bar the sill', () => {
    const pa = openingParts(opening({ type: 'pa_door', width: 3600, height: 3600 }), 1000, colors);
    for (const kind of ['trim-head', 'trim-left', 'trim-right']) {
      const mine = at(kind)!;
      const theirs = pa.find((part) => part.kind === kind)!;
      /*
       * **Section**, not length: face width along the wall and depth through it, at the same `z`, in the
       * same colour and finish. The jambs' vertical extent legitimately differs — a roller door's jambs
       * run to the floor because it has no sill (round 3b), a PA door's butt against one. The head has no
       * such difference, so it is compared whole.
       */
      expect(mine.size?.[0], `${kind} face width`).toBe(theirs.size?.[0]);
      expect(mine.size?.[2], `${kind} depth`).toBe(theirs.size?.[2]);
      expect(mine.position[2], `${kind} z`).toBe(theirs.position[2]);
      expect(mine.color, `${kind} colour`).toBe(theirs.color);
      expect(mine.finish, `${kind} finish`).toBe(theirs.finish);
      if (kind === 'trim-head') expect(mine.size, 'trim-head size').toEqual(theirs.size);
    }
  });

  it('rule 6: there is no separate head box — the ring head is the head', () => {
    expect(at('head')).toBeUndefined();
  });

  it('rule 3: the curtain hangs inside, from the front of the drum', () => {
    const drum = at('drum')!;
    const drumFrontTangent = drum.position[2] - (drum.radius ?? 0);
    const [curtainFront] = faces('curtain');
    expect(curtainFront, 'curtain front face is inside the shed').toBeGreaterThan(WALL_DEPTH);
    expect(Math.abs(curtainFront - drumFrontTangent), 'curtain vs drum tangent').toBeLessThanOrEqual(15);
  });

  it('rule 4: the ribs and the bottom bar sit against the curtain, inside', () => {
    const [curtainFront] = faces('curtain');
    const ribs = parts.filter((part) => part.kind.startsWith('slat-'));
    expect(ribs.length).toBeGreaterThan(8);
    expect(at('bottom-bar')).toBeDefined();
    for (const part of [...ribs, at('bottom-bar')!]) {
      const [front, back] = faces(part.kind);
      // Wholly inside the shed, never coplanar with the inner face.
      expect(front, `${part.kind} front`).toBeGreaterThan(WALL_DEPTH);
      // Against the curtain's front face, but not on it: a shared plane would flicker.
      expect(back, `${part.kind} back vs curtain`).toBeLessThan(curtainFront);
      expect(curtainFront - back, `${part.kind} gap to the curtain`).toBeLessThanOrEqual(3);
    }
  });

  it('rule 5: the guides are inside, sunk 10 mm into the wall, clear of the ring', () => {
    const ringBack = Math.max(...parts.filter((p) => p.kind.startsWith('trim-')).map((p) => faces(p.kind)[1]));
    for (const kind of ['guide-left', 'guide-right']) {
      const [front, back] = faces(kind);
      /*
       * "Sunk 10 mm into the cladding" is what keeps any face off `z = WALL_DEPTH`: the rail's plate
       * sits 10 mm inside the inner skin (`front = 40`), so the bulk of the rail is in the shed and
       * the 10 mm that is buried is hidden by the wall. Same treatment as the drum's brackets.
       */
      expect(front, `${kind} plate is sunk into the cladding`).toBeCloseTo(WALL_DEPTH - ROLLER_GUIDE_SINK, 6);
      expect(back, `${kind} reaches into the shed`).toBeGreaterThan(WALL_DEPTH + 50);
      expect(front, `${kind} plate is not on the inner face`).not.toBeCloseTo(WALL_DEPTH, 6);
      expect(back, `${kind} back is not on the inner face`).not.toBeCloseTo(WALL_DEPTH, 6);
      expect(front, `${kind} clears the ring`).toBeGreaterThan(ringBack);
    }
  });

  it('rule 5: the guides hug the curtain’s edges', () => {
    const curtain = at('curtain')!;
    const [cw] = curtain.size ?? [0, 0, 0];
    const left = at('guide-left')!;
    const right = at('guide-right')!;
    expect(left.position[0] + (left.size?.[0] ?? 0) / 2).toBeCloseTo(curtain.position[0] - cw / 2, 6);
    expect(right.position[0] - (right.size?.[0] ?? 0) / 2).toBeCloseTo(curtain.position[0] + cw / 2, 6);
  });

  it('rule 7: no roller part has a face on the inner plane, and only the ring is on z = 0', () => {
    /*
     * Rule 7 asks that nothing sits exactly on `z = 0` or `z = WALL_DEPTH`, because a coplanar pair
     * flickers. The ring's **front** face at `z = 0` is the one deliberate exception in the whole
     * opening system: rule 2 (and rounds 1–2) put every trim ring flush with the sheeting, and the ring
     * lies inside the hole where there is no sheeting to fight with. Everything else must stay off both
     * planes.
     */
    for (const part of parts) {
      const [sx = 0, sy = 0, sz = 0] = part.size ?? [0, 0, 0];
      const t = part.rotation?.[1] ?? 0;
      const half = (sz / 2) * Math.abs(Math.cos(t)) + (sx / 2) * Math.abs(Math.sin(t));
      const front = part.position[2] - half;
      const back = part.position[2] + half;
      const isRingFront = part.kind.startsWith('trim-') && Math.abs(front) < 1e-6;
      for (const [label, plane] of [
        ['front', front],
        ['back', back],
      ] as const) {
        if (isRingFront && label === 'front') continue;
        expect(Math.abs(plane), `${part.kind} ${label} on z = 0`).toBeGreaterThan(1e-6);
        expect(Math.abs(plane - WALL_DEPTH), `${part.kind} ${label} on the inner face`).toBeGreaterThan(1e-6);
      }
      void sy;
    }
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

  it('has a guide each side, a curtain, a trim head and a drum', () => {
    const kinds = parts.map((part) => part.kind);
    expect(kinds).toContain('guide-left');
    expect(kinds).toContain('guide-right');
    expect(kinds).toContain('curtain');
    // Round 3: the head of the opening is the trim ring's own head, not a separate 130 mm box.
    expect(kinds).toContain('trim-head');
    expect(kinds).not.toContain('head');
    expect(kinds).toContain('drum');
  });

  it('puts the drum and the springs above the head of the opening', () => {
    const drum = parts.find((part) => part.kind === 'drum');
    const head = parts.find((part) => part.kind === 'trim-head');
    const headTop = (head?.position[1] ?? 0) + (head?.size?.[1] ?? 0) / 2;
    expect(drum?.position[1] ?? 0).toBeGreaterThan(headTop);
    expect(drum?.position[1] ?? 0).toBeGreaterThan(door.height);
  });

  it('hangs everything of the door inside the shed, the drum wholly behind the inner face', () => {
    /*
     * Was "…inside the shed, everything else outside" — the outside half of that sentence is what round
     * 3 removed. Now: the curtain, ribs, guides and their trim live in the shed; the drum, its brackets
     * and the springs live *behind* the inner face, so nothing of them shows from outside either.
     */
    const hardware = (kind: string) => kind === 'drum' || kind.startsWith('bracket-') || kind.startsWith('spring-');
    for (const part of parts) {
      const [sx = 0, , sz = 0] = part.size ?? [0, 0, 0];
      const t = part.rotation?.[1] ?? 0;
      const half = (sz / 2) * Math.abs(Math.cos(t)) + (sx / 2) * Math.abs(Math.sin(t));
      const front = part.position[2] - half;
      if (hardware(part.kind)) {
        /*
         * The brackets' plate is sunk 10 mm into the wall — their unchanged anti-coplanarity treatment,
         * measured before round 3. The drum is wholly behind the inner face.
         */
        if (part.kind === 'drum') {
          expect(front, `${part.kind} clears the inner face`).toBeGreaterThanOrEqual(WALL_DEPTH);
        } else {
          expect(front, `${part.kind} plate reach`).toBeGreaterThanOrEqual(WALL_DEPTH - 10);
        }
      } else {
        expect(front, `${part.kind} is not in the cladding`).toBeGreaterThanOrEqual(0);
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

describe('sliding door hangs outside the wall — by design', () => {
  /*
   * An Australian shed's sliding door is **top-hung on a track outside the sheeting** and slides
   * across the face of the wall, so standing proud of `z = 0` is the design, not a defect. This is an
   * inventory to keep the numbers visible, and it is deliberately **not** the roller door's rule: a
   * roller door is fixed to the inside face and must not appear here.
   *
   * Measured on the current geometry (mm in front of `z = 0`):
   *
   *   sliding track-top −125 (double −245), track-bottom −72, leaves −110 (double −230)
   */
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

describe('round 3 left every other opening alone', () => {
  /*
   * Round 3 changed `trimRing` (the sill became optional) and `rollerDoorParts`. A window and a PA door
   * must come out of it **identical to the millimetre**, so their whole part lists are snapshotted as
   * numbers captured **before** the edit. If these fail, the new parameter leaked into a ring that was
   * not meant to change.
   */
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const compact = (o: Opening) =>
    openingParts(o, 500, colors).map((part) => [
      part.kind,
      part.position.map(r3),
      part.size ?? null,
      part.rotation ? part.rotation.map(r3) : null,
      part.color,
      part.finish,
    ]);

  const WINDOW_BEFORE = JSON.parse(
    '[["glass",[1400,2250,75],[1524,624,10],null,"#9fc3d0","glass"],["frame-left",[593,2250,57],[90,804,60],null,"#323232","trim"],["frame-right",[2207,2250,57],[90,804,60],null,"#323232","trim"],["frame-head",[1400,2607,57],[1704,90,60],null,"#323232","trim"],["frame-sill",[1400,1893,57],[1704,90,60],null,"#323232","trim"],["mullion",[1400,2250,57],[46,624,60],null,"#323232","trim"],["trim-head",[1400,2676,12.5],[1797,45,25],null,"#e4e2d5","trim"],["trim-sill",[1400,1824,12.5],[1797,45,25],null,"#e4e2d5","trim"],["trim-left",[524,2250,12.5],[45,807,25],null,"#e4e2d5","trim"],["trim-right",[2276,2250,12.5],[45,807,25],null,"#e4e2d5","trim"]]',
  );
  const PA_BEFORE = JSON.parse(
    '[["trim-head",[910,2016,12.5],[817,45,25],null,"#e4e2d5","trim"],["trim-sill",[910,24,12.5],[817,45,25],null,"#e4e2d5","trim"],["trim-left",[524,1020,12.5],[45,1947,25],null,"#e4e2d5","trim"],["trim-right",[1296,1020,12.5],[45,1947,25],null,"#e4e2d5","trim"],["leaf",[883.531,1020,-113.669],[727,1947,45],[0,0.384,0],"#323232","door"],["leaf-handle",[1139.675,981.06,-253.658],[150,28,28],[0,0.384,0],"#e4e2d5","metal"],["hinge-0.18",[556.5,396.96,22],[36,90,40],null,"#e4e2d5","metal"],["hinge-0.5",[556.5,1020,22],[36,90,40],null,"#e4e2d5","metal"],["hinge-0.82",[556.5,1643.04,22],[36,90,40],null,"#e4e2d5","metal"]]',
  );

  it('a window is unchanged', () => {
    expect(compact(opening({ type: 'window', width: 1800, height: 900, sill: 1800 }))).toEqual(WINDOW_BEFORE);
  });

  it('a PA door is unchanged', () => {
    expect(compact(opening({ type: 'pa_door', width: 820, height: 2040 }))).toEqual(PA_BEFORE);
  });
});

describe('o2: rule 8 — the drum, brackets and springs are untouched', () => {
  /*
   * A roller door's drum and its brackets were already inside the shed and correct; round 3 moved the
   * curtain and the guides, not the hardware. These are the exact values measured before the edit.
   */
  it('keeps the drum, brackets and springs exactly where they were', () => {
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const parts = openingParts(opening({ type: 'roller_door', width: 3600, height: 3600 }), 1000, colors)
      .filter((part) => ['drum', 'bracket-left', 'bracket-right'].includes(part.kind) || part.kind.startsWith('spring-'))
      .map((part) => [
        part.kind,
        part.position.map(r3),
        part.size ?? null,
        part.radius ?? null,
        part.height ?? null,
        part.tube ?? null,
        part.rotation ? part.rotation.map(r3) : null,
        part.color,
      ]);
    expect(parts).toEqual(
      JSON.parse(
        '[["drum",[2800,3850,230],null,150,3740,null,[0,0,1.571],"#323232"],["bracket-left",[1035,3770,165],[70,220,250],null,null,null,null,"#e4e2d5"],["bracket-right",[4565,3770,165],[70,220,250],null,null,null,null,"#e4e2d5"],["spring-0",[2080,3850,230],null,78,null,11,[0,1.571,0],"#e4e2d5"],["spring-1",[3520,3850,230],null,78,null,11,[0,1.571,0],"#e4e2d5"]]',
      ),
    );
  });
});
