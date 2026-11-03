import { describe, it, expect } from 'vitest';
import {
  OPENING_TYPE_OPTIONS,
  OPTION_KIND_OPTIONS,
  OPTION_GROUP_LABELS,
  describeSelection,
  popoverPosition,
  selectionAnchor,
  affordancePositions,
} from '../selection';
import { defaultOptionsFor } from '../options';
import { buildPlanGeometry } from '../plan';
import { DEFAULT_SHED } from '../defaults';

const shed = {
  ...DEFAULT_SHED,
  span: 12000, length: 24000, height: 4200, roofPitchDeg: 10, bays: 4,
  openings: [
    { id: 'r1', type: 'roller_door' as const, width: 4200, height: 3600, sill: 0,
      wall: 'front' as const, align: 'center' as const, offset: null, swing: null, track: null },
    { id: 'p1', type: 'pa_door' as const, width: 900, height: 2100, sill: 0,
      wall: 'left' as const, align: 'custom' as const, offset: 500, swing: 'outward' as const, track: null },
  ],
};

describe('OPENING_TYPE_OPTIONS', () => {
  // The context menu's Add-door submenu is derived from this same list, so the
  // four labels here are the ones both the menu and the popover's Type field
  // offer. Pinning them stops a rename from drifting the two apart.
  it('lists the five opening types with their labels, in form order', () => {
    expect(OPENING_TYPE_OPTIONS).toEqual([
      { value: 'roller_door', label: 'Roller door' },
      { value: 'pa_door', label: 'PA door' },
      { value: 'sliding_door', label: 'Sliding door' },
      { value: 'window', label: 'Window' },
      { value: 'opening', label: 'Opening' },
    ]);
  });

  it('is the option list the popover Type field renders', () => {
    const d = describeSelection(shed, { kind: 'opening', id: 'r1' });
    const type = d.fields.find((f) => f.key === 'type')!;
    expect(type.options).toBe(OPENING_TYPE_OPTIONS);
  });
});

describe('OPTION_KIND_OPTIONS', () => {
  // The place-option buttons and the options list are both derived from this
  // list, so a kind missing here is a kind nobody can place. Pinning the whole
  // set means adding a twelfth `OptionKind` without adding it here fails loudly
  // rather than shipping an option only the BOM knows about.
  it('lists all eleven option kinds with their labels', () => {
    expect(OPTION_KIND_OPTIONS.map((o) => ({ value: o.value, label: o.label }))).toEqual([
      { value: 'skylight', label: 'Skylight' },
      { value: 'overhang', label: 'Overhang' },
      { value: 'cantilever', label: 'Cantilever' },
      { value: 'awning', label: 'Awning' },
      { value: 'outrigger', label: 'Outrigger' },
      { value: 'horizontal_cladding', label: 'Cladding' },
      { value: 'gable_infill', label: 'Gable infill' },
      { value: 'stable', label: 'Stable' },
      { value: 'mezzanine', label: 'Mezzanine' },
      { value: 'dividing_wall', label: 'Dividing wall' },
      { value: 'carry_beam', label: 'Carry beam' },
    ]);
  });

  it('covers every kind with a distinct value and non-empty label', () => {
    const values = OPTION_KIND_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    for (const label of OPTION_KIND_OPTIONS.map((o) => o.label)) {
      expect(label.trim()).not.toBe('');
    }
  });

  it('names every kind under a known group', () => {
    const groups = new Set(OPTION_GROUP_LABELS.map((g) => g.value));
    for (const option of OPTION_KIND_OPTIONS) {
      expect(groups.has(option.group)).toBe(true);
    }
    // Every group is used, so a place-button section is never empty.
    for (const group of groups) {
      expect(OPTION_KIND_OPTIONS.some((o) => o.group === group)).toBe(true);
    }
  });

  it('is the label describeSelection gives a placed option', () => {
    // Every kind is placed through `defaultOptionsFor`, then its title must read
    // exactly as the catalogue spells it — the list and the popover cannot drift.
    const kinds = OPTION_KIND_OPTIONS.map((o) => o.value);
    const populated = {
      ...shed,
      options: kinds.flatMap((kind) => defaultOptionsFor(kind, shed)),
    };
    const labelByKind = new Map(OPTION_KIND_OPTIONS.map((o) => [o.value, o.label]));

    for (const option of populated.options) {
      const d = describeSelection(populated, { kind: 'option', id: option.id });
      expect(d.title).toBe(labelByKind.get(option.kind));
    }
  });
});

describe('describeSelection', () => {
  it('describes the building with its five editable fields', () => {
    const d = describeSelection(shed, { kind: 'building' });
    expect(d.kind).toBe('building');
    expect(d.fields.map((f) => f.key)).toEqual(['span', 'length', 'height', 'roofPitchDeg', 'bays']);
    expect(d.fields.find((f) => f.key === 'span')!.value).toBe(12000);
  });

  it('describes a roller door and omits swing', () => {
    const d = describeSelection(shed, { kind: 'opening', id: 'r1' });
    expect(d.kind).toBe('opening');
    expect(d.id).toBe('r1');
    expect(d.fields.map((f) => f.key)).not.toContain('swing');
    expect(d.fields.map((f) => f.key)).toContain('sill');
    expect(d.title.toLowerCase()).toContain('roller');
  });

  it('includes swing for a PA door', () => {
    const d = describeSelection(shed, { kind: 'opening', id: 'p1' });
    expect(d.fields.map((f) => f.key)).toContain('swing');
  });

  it('offers the four walls and four aligns as select options', () => {
    const d = describeSelection(shed, { kind: 'opening', id: 'r1' });
    const wall = d.fields.find((f) => f.key === 'wall')!;
    expect(wall.type).toBe('select');
    expect(wall.options!.map((o) => o.value)).toEqual(['front', 'back', 'left', 'right']);
    const align = d.fields.find((f) => f.key === 'align')!;
    expect(align.options!.map((o) => o.value)).toEqual(['center', 'left', 'right', 'custom']);
  });

  it('resolves an unknown opening id to none rather than throwing', () => {
    const d = describeSelection(shed, { kind: 'opening', id: 'gone' });
    expect(d.kind).toBe('none');
    expect(d.fields).toEqual([]);
  });

  it('resolves kind none to an empty description', () => {
    expect(describeSelection(shed, { kind: 'none' }).fields).toEqual([]);
  });

  it('disables offset unless the opening is custom-aligned (spec §5.2)', () => {
    // r1 is `align: 'center'`, p1 is `align: 'custom'`.
    const centered = describeSelection(shed, { kind: 'opening', id: 'r1' });
    expect(centered.fields.find((f) => f.key === 'offset')!.disabled).toBe(true);
    const custom = describeSelection(shed, { kind: 'opening', id: 'p1' });
    expect(custom.fields.find((f) => f.key === 'offset')!.disabled).toBe(false);
  });
});

describe('selectionAnchor', () => {
  const geometry = buildPlanGeometry(shed);

  it('returns null when nothing is selected', () => {
    expect(selectionAnchor(geometry, { kind: 'none' })).toBeNull();
  });

  it('returns null for a dangling opening id', () => {
    expect(selectionAnchor(geometry, { kind: 'opening', id: 'gone' })).toBeNull();
  });

  it('anchors the building at the outline top-left corner', () => {
    expect(selectionAnchor(geometry, { kind: 'building' })).toEqual({ x: 0, y: 0 });
  });

  it('anchors a front door at its midpoint, offset outward (negative y)', () => {
    // r1: roller_door, width 4200, centred on the front wall (span 12000) →
    // u = 3900, rect x 3900..8100 at y 0; midpoint (6000, 0).
    const a = selectionAnchor(geometry, { kind: 'opening', id: 'r1' });
    expect(a).not.toBeNull();
    expect(a!.x).toBe(6000);
    expect(a!.y).toBeLessThan(0);
  });

  it('anchors a left-wall door at its midpoint, offset outward (negative x)', () => {
    // p1: left wall, custom offset 500, width 900 → rect y 22600..23500 at x 0;
    // midpoint (0, 23050).
    const a = selectionAnchor(geometry, { kind: 'opening', id: 'p1' });
    expect(a).not.toBeNull();
    expect(a!.x).toBeLessThan(0);
    expect(a!.y).toBe(23050);
  });

  it('is derived from the door, so two doors anchor at different points', () => {
    const front = selectionAnchor(geometry, { kind: 'opening', id: 'r1' })!;
    const left = selectionAnchor(geometry, { kind: 'opening', id: 'p1' })!;
    expect(front).not.toEqual(left);
  });
});

describe('affordancePositions (buttons must not cover the door)', () => {
  // A wide door on the front wall: 200px wide, 6px tall, centred at (400, 200).
  const wideFront = { x: 300, y: 197, width: 200, height: 6 };

  it('places the wrench fully outside the door, on the outward side', () => {
    const { wrench } = affordancePositions(wideFront, 'front');
    // Front wall's outward normal is −y, so both buttons sit above the door.
    expect(wrench.y + 44).toBeLessThanOrEqual(wideFront.y);
  });

  it('does not overlap the door horizontally for a wide door', () => {
    const { wrench, dots } = affordancePositions(wideFront, 'front');
    // The whole point: a centre-anchored button would sit over the door.
    const overlaps = (b: { x: number; y: number }) =>
      b.x < wideFront.x + wideFront.width && b.x + 44 > wideFront.x &&
      b.y < wideFront.y + wideFront.height && b.y + 44 > wideFront.y;
    expect(overlaps(wrench)).toBe(false);
    expect(overlaps(dots)).toBe(false);
  });

  it('stacks the two buttons without overlapping each other', () => {
    const { wrench, dots } = affordancePositions(wideFront, 'front');
    const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      a.x < b.x + 44 && a.x + 44 > b.x && a.y < b.y + 44 && a.y + 44 > b.y;
    expect(overlaps(wrench, dots)).toBe(false);
  });

  it('pushes outward in the correct direction for each wall', () => {
    const door = { x: 100, y: 100, width: 40, height: 40 };
    expect(affordancePositions(door, 'front').wrench.y).toBeLessThan(door.y);       // −y
    expect(affordancePositions(door, 'back').wrench.y).toBeGreaterThan(door.y + 40); // +y
    expect(affordancePositions(door, 'left').wrench.x).toBeLessThan(door.x);         // −x
    expect(affordancePositions(door, 'right').wrench.x).toBeGreaterThan(door.x + 40);// +x
  });

  it('keeps the clearance constant regardless of door size', () => {
    const small = { x: 0, y: 0, width: 10, height: 4 };
    const big = { x: 0, y: 0, width: 400, height: 4 };
    // Distance from the door's edge to the button is the same for both.
    const gapFor = (d: { x: number; y: number; width: number; height: number }) =>
      d.y - (affordancePositions(d, 'front').wrench.y + 44);
    expect(gapFor(small)).toBe(gapFor(big));
  });
});

describe('popoverPosition', () => {
  const popover = { width: 256, height: 320 };
  const viewport = { width: 390, height: 844 };

  it('places the popover just right of the anchor when it fits', () => {
    const p = popoverPosition({ x: 40, y: 100 }, popover, viewport);
    expect(p.x).toBeGreaterThanOrEqual(40);
    expect(p.y).toBeGreaterThanOrEqual(0);
  });

  it('flips to the left of the anchor when it would overflow the right edge', () => {
    const p = popoverPosition({ x: 380, y: 100 }, popover, viewport);
    expect(p.x + popover.width).toBeLessThanOrEqual(viewport.width);
  });

  it('keeps the popover inside the viewport vertically', () => {
    const p = popoverPosition({ x: 40, y: 830 }, popover, viewport);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y + popover.height).toBeLessThanOrEqual(viewport.height);
  });

  it('never returns a negative position for an anchor at the origin', () => {
    const p = popoverPosition({ x: 0, y: 0 }, popover, viewport);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
  });
});

describe('option selections', () => {
  const withSkylight = {
    ...DEFAULT_SHED,
    options: [
      { id: 'sk-1', kind: 'skylight' as const, bay: 1, alongBay: 0.5, width: 900, height: 900 },
    ],
  };

  it('describes a skylight selection with its own fields', () => {
    const description = describeSelection(withSkylight, { kind: 'option', id: 'sk-1' });
    expect(description.kind).toBe('option');
    expect(description.title).toBe('Skylight');
    expect(description.fields.map((field) => field.key)).toEqual(['bay', 'alongBay', 'width', 'height']);
  });

  it('describes a gable infill as a choice of end', () => {
    const config = {
      ...DEFAULT_SHED,
      options: [{ id: 'gi-1', kind: 'gable_infill' as const, end: 'front' as const }],
    };
    const description = describeSelection(config, { kind: 'option', id: 'gi-1' });
    expect(description.title).toBe('Gable infill');
    expect(description.fields).toEqual([
      {
        key: 'end',
        label: 'End',
        type: 'select',
        value: 'front',
        options: [
          { value: 'front', label: 'Front' },
          { value: 'back', label: 'Back' },
        ],
      },
    ]);
  });

  it('collapses a dangling option selection to none', () => {
    expect(describeSelection(DEFAULT_SHED, { kind: 'option', id: 'sk-9' }).kind).toBe('none');
  });
});

describe('fields for the remaining kinds', () => {
  it('describes a stable with its panel toggles', () => {
    const config = {
      ...DEFAULT_SHED,
      options: [{ id: 'st-1', kind: 'stable' as const, wall: 'left' as const, align: 'center' as const,
        offset: null, width: 3000, depth: 2400, height: 2400,
        panels: { left: true, right: true, front: true, back: true } }],
    };
    const description = describeSelection(config, { kind: 'option', id: 'st-1' });
    expect(description.title).toBe('Stable');
    const keys = description.fields.map((field) => field.key);
    expect(keys).toContain('width');
    expect(keys).toContain('panels.left');
    expect(keys).toContain('panels.back');
  });

  it('describes a carry beam with its bay', () => {
    const config = {
      ...DEFAULT_SHED,
      options: [{ id: 'cb-1', kind: 'carry_beam' as const, wall: 'front' as const, beginBay: 1, openingId: null }],
    };
    const description = describeSelection(config, { kind: 'option', id: 'cb-1' });
    expect(description.title).toBe('Carry beam');
    expect(description.fields.map((field) => field.key)).toEqual(['wall', 'beginBay', 'openingId']);
  });

  it('describes cladding with its height band', () => {
    const config = {
      ...DEFAULT_SHED,
      options: [{ id: 'hc-1', kind: 'horizontal_cladding' as const, wall: 'front' as const, from: 0, to: 4200 }],
    };
    const description = describeSelection(config, { kind: 'option', id: 'hc-1' });
    expect(description.title).toBe('Cladding');
    expect(description.fields.map((field) => field.key)).toEqual(['wall', 'from', 'to']);
  });

  it('describes an overhang and a cantilever', () => {
    const config = {
      ...DEFAULT_SHED,
      options: [
        { id: 'oh-1', kind: 'overhang' as const, wall: 'front' as const, depth: 600 },
        { id: 'cl-1', kind: 'cantilever' as const, wall: 'left' as const, bay: 0, length: 1200 },
      ],
    };
    expect(describeSelection(config, { kind: 'option', id: 'oh-1' }).title).toBe('Overhang');
    expect(describeSelection(config, { kind: 'option', id: 'cl-1' }).title).toBe('Cantilever');
  });
});

describe('track field on a sliding door', () => {
  it('offers a track field only on a sliding door', () => {
    const withSliding = {
      ...DEFAULT_SHED,
      openings: [{ id: 'd1', type: 'sliding_door' as const, width: 3000, height: 2100, sill: 0,
        wall: 'front' as const, align: 'center' as const, offset: null, swing: 'outward' as const,
        track: 'none' as const }],
    };
    expect(describeSelection(withSliding, { kind: 'opening', id: 'd1' }).fields
      .map((field) => field.key)).toContain('track');

    const withPa = {
      ...DEFAULT_SHED,
      openings: [{ id: 'd2', type: 'pa_door' as const, width: 900, height: 2100, sill: 0,
        wall: 'front' as const, align: 'center' as const, offset: null, swing: null, track: null }],
    };
    expect(describeSelection(withPa, { kind: 'opening', id: 'd2' }).fields
      .map((field) => field.key)).not.toContain('track');
  });
});

describe('track field order (deferred minor)', () => {
  it('places the track field after swing', () => {
    const config = {
      ...DEFAULT_SHED,
      openings: [{ id: 'd1', type: 'sliding_door' as const, width: 3000, height: 2100, sill: 0,
        wall: 'front' as const, align: 'center' as const, offset: null, swing: 'outward' as const,
        track: 'none' as const }],
    };
    const keys = describeSelection(config, { kind: 'opening', id: 'd1' })
      .fields.map((field) => field.key);
    expect(keys.indexOf('swing')).toBeLessThan(keys.indexOf('track'));
  });
});
