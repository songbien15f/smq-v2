import { describe, it, expect } from 'vitest';
import { buildPlanGeometry } from '../plan';
import { DEFAULT_SHED } from '../defaults';

const shed = {
  ...DEFAULT_SHED,
  openings: [
    { id: 'd1', type: 'roller_door' as const, width: 4200, height: 3600, sill: 0,
      wall: 'front' as const, align: 'center' as const, offset: null, swing: null, track: null },
    { id: 'd2', type: 'pa_door' as const, width: 900, height: 2100, sill: 0,
      wall: 'left' as const, align: 'custom' as const, offset: 500, swing: 'outward' as const, track: null },
  ],
};

describe('buildPlanGeometry', () => {
  it('outlines the shed in plan coordinates', () => {
    expect(buildPlanGeometry(shed).outline).toEqual({ x: 0, y: 0, width: 12000, height: 24000 });
  });
  it('draws interior bay lines only, parallel to the span', () => {
    const g = buildPlanGeometry(shed);
    expect(g.bayLines).toHaveLength(3);              // 4 bays → 3 interior lines
    expect(g.bayLines[0]).toEqual({ x1: 0, y1: 6000, x2: 12000, y2: 6000 });
  });
  it('produces span, length, and per-bay dimensions with rounded labels', () => {
    const g = buildPlanGeometry(shed);
    const labels = g.dims.map((d) => d.label);
    expect(labels).toContain('12000');
    expect(labels).toContain('24000');
    expect(labels.filter((l) => l === '6000')).toHaveLength(4);
  });
  it('points the roof arrow across the span for a gable', () => {
    const g = buildPlanGeometry(shed);
    expect(g.roofArrow.x1).toBe(0);
    expect(g.roofArrow.x2).toBe(12000);
    expect(g.roofArrow.y1).toBe(g.roofArrow.y2);
  });
  it('carries both openings through with their resolved positions', () => {
    const g = buildPlanGeometry(shed);
    expect(g.openings).toHaveLength(2);
    const roller = g.openings.find((o) => o.id === 'd1')!;
    expect(roller.wall).toBe('front');
    expect(roller.rect.x).toBe(3900);
    expect(g.openings.find((o) => o.id === 'd2')!.swing).toBe('outward');
  });
  it('collects warnings for openings that do not fit', () => {
    const bad = { ...DEFAULT_SHED, openings: [{ ...shed.openings[0], width: 13000 }] };
    expect(buildPlanGeometry(bad).warnings).toHaveLength(1);
  });
  it('rounds dimension labels up to 50 mm without rounding the underlying values', () => {
    const odd = { ...DEFAULT_SHED, span: 12001 };
    const g = buildPlanGeometry(odd);
    const spanDim = g.dims.find((d) => d.value === 12001);
    expect(spanDim).toBeDefined();
    expect(spanDim!.label).toBe('12050');
    expect(g.outline.width).toBe(12001);
  });
});

describe('dimension witness lines are orthogonal (refactor §3.1)', () => {
  const shed = { ...DEFAULT_SHED, span: 12000, length: 24000, bays: 4 };

  it('never draws a sloped witness line or dimension line', () => {
    for (const d of buildPlanGeometry(shed).dims) {
      const dx = d.dimEnd.x - d.dimStart.x;
      const dy = d.dimEnd.y - d.dimStart.y;
      expect(Math.abs(dx) < 1e-9 || Math.abs(dy) < 1e-9).toBe(true);

      for (const [p, q] of [d.witnessStart, d.witnessEnd]) {
        const wx = q.x - p.x;
        const wy = q.y - p.y;
        expect(Math.abs(wx) < 1e-9 || Math.abs(wy) < 1e-9).toBe(true);
      }
    }
  });

  it('offsets the length dimension further out than the bay dimensions', () => {
    const g = buildPlanGeometry(shed);
    const lengthDim = g.dims.find((d) => d.value === 24000)!;
    const bayDim = g.dims.find((d) => d.value === 6000)!;
    // Both sit to the left of the building (smaller x); the overall length is outer.
    expect(lengthDim.dimStart.x).toBeLessThan(bayDim.dimStart.x);
  });

  it('centres each label on its dimension line', () => {
    for (const d of buildPlanGeometry(shed).dims) {
      expect(d.textAt.x).toBeCloseTo((d.dimStart.x + d.dimEnd.x) / 2);
      expect(d.textAt.y).toBeCloseTo((d.dimStart.y + d.dimEnd.y) / 2);
    }
  });

  it('measures the bay dimensions along y and the span along x', () => {
    const g = buildPlanGeometry(shed);
    expect(g.dims.find((d) => d.value === 12000)!.axis).toBe('x');
    expect(g.dims.find((d) => d.value === 24000)!.axis).toBe('y');
    for (const d of g.dims.filter((x) => x.value === 6000)) expect(d.axis).toBe('y');
  });
});

describe('door symbols are technical-drawing symbols (user requirement)', () => {
  const shed = (type: 'pa_door' | 'roller_door' | 'window', swing: 'inward' | 'outward' | null = null) => ({
    ...DEFAULT_SHED,
    openings: [{ id: 'd1', type, width: 900, height: 2100, sill: 0,
      wall: 'front' as const, align: 'center' as const, offset: null, swing, track: null }],
  });

  it('gives a PA door jambs, a leaf line, and a quarter arc', () => {
    const o = buildPlanGeometry(shed('pa_door', 'outward')).openings[0];
    expect(o.symbol.rects.length).toBeGreaterThanOrEqual(2);   // the two jambs
    expect(o.symbol.lines.length).toBeGreaterThanOrEqual(1);   // the leaf / opening line
    expect(o.symbol.arc).toBeDefined();
    expect(o.symbol.arc!.radius).toBeCloseTo(900, 6);          // radius = opening width
  });

  it('draws a roller door as a curtain plus side tracks, with no arc', () => {
    const o = buildPlanGeometry(shed('roller_door')).openings[0];
    expect(o.symbol.arc).toBeUndefined();                      // a roller door has no swing
    expect(o.symbol.rects.length).toBeGreaterThanOrEqual(3);   // curtain + two tracks
  });

  it('draws a window with its multi-line symbol', () => {
    const o = buildPlanGeometry(shed('window')).openings[0];
    expect(o.symbol.lines.length).toBeGreaterThanOrEqual(3);   // the window's own lines
    expect(o.symbol.arc).toBeUndefined();
  });

  it('keeps every symbol primitive inside the opening footprint plus its jamb depth', () => {
    for (const type of ['pa_door', 'roller_door', 'window'] as const) {
      const o = buildPlanGeometry(shed(type, type === 'pa_door' ? 'outward' : null)).openings[0];
      const maxDepth = Math.max(900, o.symbol.arc?.radius ?? 0) + 400; // generous bound
      for (const r of o.symbol.rects) {
        expect(Math.abs(r.x - o.rect.x)).toBeLessThanOrEqual(maxDepth + o.rect.width);
        expect(Math.abs(r.y - o.rect.y)).toBeLessThanOrEqual(maxDepth);
      }
    }
  });

  it('still reports the opening for hit-testing', () => {
    expect(buildPlanGeometry(shed('roller_door')).openings).toHaveLength(1);
  });

  it('hinges the leaf and the arc on the same jamb, so the tip lands on the arc', () => {
    const o = buildPlanGeometry(shed('pa_door', 'outward')).openings[0];
    const arc = o.symbol.arc!;
    // The 45° leaf tip, in plan mm, relative to the arc centre.
    const tip = o.symbol.lines.at(-1)!;
    const dx = tip[2] - arc.x;
    const dy = tip[3] - arc.y;
    expect(Math.hypot(dx, dy)).toBeCloseTo(arc.radius, 0);   // tip is ON the circle
  });

  it('orients the symbol along the wall (not sideways) on a side wall', () => {
    const s = { ...DEFAULT_SHED, openings: [
      { id: 'l1', type: 'pa_door' as const, width: 900, height: 2100, sill: 0,
        wall: 'left' as const, align: 'custom' as const, offset: 500, swing: 'outward' as const, track: null },
    ]};
    const o = buildPlanGeometry(s).openings[0];
    // On a left wall the opening runs along y, so its jamb blocks are offset in x,
    // and the opening line is vertical.
    expect(o.rect.width).toBe(0);
    expect(o.symbol.lines[0][0]).toBeCloseTo(o.symbol.lines[0][2], 6);  // vertical line
    for (const r of o.symbol.rects) expect(r.width).toBeCloseTo(r.height, 6); // square jambs
  });

  it('orients the symbol along the wall (not sideways) on a right wall', () => {
    const s = { ...DEFAULT_SHED, openings: [
      { id: 'r1', type: 'pa_door' as const, width: 900, height: 2100, sill: 0,
        wall: 'right' as const, align: 'custom' as const, offset: 500, swing: 'inward' as const, track: null },
    ]};
    const o = buildPlanGeometry(s).openings[0];
    expect(o.rect.width).toBe(0);
    expect(o.symbol.lines[0][0]).toBeCloseTo(o.symbol.lines[0][2], 6);  // vertical line
    for (const r of o.symbol.rects) expect(r.width).toBeCloseTo(r.height, 6); // square jambs
  });

  it('orients the symbol along the wall (not sideways) on the back wall', () => {
    const s = { ...DEFAULT_SHED, openings: [
      { id: 'b1', type: 'pa_door' as const, width: 900, height: 2100, sill: 0,
        wall: 'back' as const, align: 'custom' as const, offset: 500, swing: 'outward' as const, track: null },
    ]};
    const o = buildPlanGeometry(s).openings[0];
    // On a back wall the opening runs along x, so its opening line is horizontal.
    expect(o.rect.height).toBe(0);
    expect(o.symbol.lines[0][1]).toBeCloseTo(o.symbol.lines[0][3], 6);  // horizontal line
    for (const r of o.symbol.rects) expect(r.width).toBeCloseTo(r.height, 6); // square jambs
  });
});

describe('plan options', () => {
  it('emits one placed option per stored option, with a role', () => {
    const config = {
      ...DEFAULT_SHED,
      options: [
        { id: 'sk-1', kind: 'skylight' as const, bay: 0, alongBay: 0.5, width: 900, height: 900 },
        { id: 'dw-1', kind: 'dividing_wall' as const, axis: 'x' as const, at: 12000, height: 4200 },
        { id: 'aw-1', kind: 'awning' as const, wall: 'front' as const, align: 'center' as const,
          offset: null, width: 3000, depth: 1000 },
      ],
    };
    const geometry = buildPlanGeometry(config);
    expect(geometry.options.map((option) => option.role)).toEqual(['roof', 'structure', 'exterior']);
  });

  it('draws a gable infill as a triangle across the full span', () => {
    const config = {
      ...DEFAULT_SHED,
      options: [{ id: 'gi-1', kind: 'gable_infill' as const, end: 'front' as const }],
    };
    const placed = buildPlanGeometry(config).options[0];
    expect(placed.triangle?.points).toHaveLength(3);
    expect(placed.role).toBe('roof');
    expect(placed.triangle?.points[0]).toEqual({ x: 0, y: 0 });
  });

  it('marks structural options as dashed and roof options as not', () => {
    const config = {
      ...DEFAULT_SHED,
      options: [
        { id: 'sk-1', kind: 'skylight' as const, bay: 0, alongBay: 0.5, width: 900, height: 900 },
        { id: 'mz-1', kind: 'mezzanine' as const, corner: 'back_left' as const,
          width: 3000, depth: 3000, level: 2400 },
      ],
    };
    const [skylight, mezzanine] = buildPlanGeometry(config).options;
    expect(skylight.dashed).toBe(false);
    expect(mezzanine.dashed).toBe(true);
  });

  it('carries the option id and rect through unchanged', () => {
    const config = {
      ...DEFAULT_SHED,
      options: [{ id: 'sk-7', kind: 'skylight' as const, bay: 1, alongBay: 0.5, width: 900, height: 900 }],
    };
    const placed = buildPlanGeometry(config).options[0];
    expect(placed.id).toBe('sk-7');
    expect(placed.rect.width).toBe(900);
    expect(placed.rect.height).toBe(900);
  });

  it('emits no options for a shed with none', () => {
    expect(buildPlanGeometry(DEFAULT_SHED).options).toEqual([]);
  });
});

describe('plain-hole opening (review I3)', () => {
  it('draws a plain hole with no leaf, no arc and no track', () => {
    const config = {
      ...DEFAULT_SHED,
      openings: [{ id: 'o1', type: 'opening' as const, width: 900, height: 2100, sill: 0,
        wall: 'front' as const, align: 'center' as const, offset: null, swing: null, track: null }],
    };
    const symbol = buildPlanGeometry(config).openings[0].symbol;
    expect(symbol.arc).toBeUndefined();
    expect(symbol.rects).toHaveLength(1);
    expect(symbol.rects[0].role).toBeUndefined();
    expect(symbol.lines).toHaveLength(0);
  });

  it('ignores a stale swing on a plain hole', () => {
    const config = {
      ...DEFAULT_SHED,
      openings: [{ id: 'o1', type: 'opening' as const, width: 900, height: 2100, sill: 0,
        wall: 'front' as const, align: 'center' as const, offset: null, swing: 'outward' as const, track: null }],
    };
    const symbol = buildPlanGeometry(config).openings[0].symbol;
    expect(symbol.arc).toBeUndefined();
    expect(symbol.lines).toHaveLength(0);
  });
});

describe('the five remaining kinds on the plan', () => {
  it('assigns a drawing role to each new kind', () => {
    const config = {
      ...DEFAULT_SHED,
      options: [
        { id: 'oh-1', kind: 'overhang' as const, wall: 'front' as const, depth: 600 },
        { id: 'cb-1', kind: 'carry_beam' as const, wall: 'front' as const, beginBay: 0, openingId: null },
        { id: 'st-1', kind: 'stable' as const, wall: 'left' as const, align: 'center' as const,
          offset: null, width: 3000, depth: 2400, height: 2400,
          panels: { left: true, right: true, front: true, back: true } },
      ],
    };
    expect(buildPlanGeometry(config).options.map((option) => option.role))
      .toEqual(['roof', 'structure', 'exterior']);
  });

  it('draws a carry beam solid and heavy, not dashed', () => {
    const config = {
      ...DEFAULT_SHED,
      options: [{ id: 'cb-1', kind: 'carry_beam' as const, wall: 'front' as const, beginBay: 0, openingId: null }],
    };
    expect(buildPlanGeometry(config).options[0].dashed).toBe(false);
  });

  it('draws every new kind with a non-zero footprint', () => {
    const config = {
      ...DEFAULT_SHED,
      options: [
        { id: 'st-1', kind: 'stable' as const, wall: 'left' as const, align: 'center' as const,
          offset: null, width: 3000, depth: 2400, height: 2400,
          panels: { left: true, right: true, front: true, back: true } },
        { id: 'hc-1', kind: 'horizontal_cladding' as const, wall: 'front' as const, from: 0, to: 4200 },
        { id: 'oh-1', kind: 'overhang' as const, wall: 'front' as const, depth: 600 },
        { id: 'cl-1', kind: 'cantilever' as const, wall: 'front' as const, bay: 0, length: 1200 },
      ],
    };
    for (const placed of buildPlanGeometry(config).options) {
      expect(placed.rect.width).toBeGreaterThan(0);
      expect(placed.rect.height).toBeGreaterThan(0);
    }
  });
});

describe('sliding door track in plan', () => {
  const sliding = (track: 'none' | 'single' | 'double') => ({
    ...DEFAULT_SHED,
    openings: [{ id: 'd1', type: 'sliding_door' as const, width: 3000, height: 2100, sill: 0,
      wall: 'front' as const, align: 'center' as const, offset: null, swing: 'outward' as const, track }],
  });

  it('adds no track line for track none', () => {
    const none = buildPlanGeometry(sliding('none')).openings[0].symbol;
    const single = buildPlanGeometry(sliding('single')).openings[0].symbol;
    expect(single.lines.length).toBe(none.lines.length + 1);
  });

  it('adds a second track line only for a double track', () => {
    const single = buildPlanGeometry(sliding('single')).openings[0].symbol;
    const double = buildPlanGeometry(sliding('double')).openings[0].symbol;
    expect(double.lines.length).toBe(single.lines.length + 1);
  });

  it('adds no track line to a PA door', () => {
    const config = {
      ...DEFAULT_SHED,
      openings: [{ id: 'd1', type: 'pa_door' as const, width: 900, height: 2100, sill: 0,
        wall: 'front' as const, align: 'center' as const, offset: null, swing: 'outward' as const,
        track: null }],
    };
    const pa = buildPlanGeometry(config).openings[0].symbol;
    expect(pa.lines.length).toBe(2); // the opening line and the leaf
  });
});

describe('stable and cladding symbols (review minor)', () => {
  it('gives a stable a corner-to-corner line so it is not just a rect', () => {
    const config = {
      ...DEFAULT_SHED,
      options: [{ id: 'st-1', kind: 'stable' as const, wall: 'left' as const, align: 'center' as const,
        offset: null, width: 3000, depth: 2400, height: 2400,
        panels: { left: true, right: true, front: true, back: true } }],
    };
    const placed = buildPlanGeometry(config).options[0];
    expect(placed.lines.length).toBeGreaterThan(0);
  });

  it('gives a cladding band batten lines across its run', () => {
    const config = {
      ...DEFAULT_SHED,
      options: [{ id: 'hc-1', kind: 'horizontal_cladding' as const, wall: 'front' as const, from: 0, to: 4200 }],
    };
    const placed = buildPlanGeometry(config).options[0];
    expect(placed.lines.length).toBeGreaterThanOrEqual(3);
  });
});
