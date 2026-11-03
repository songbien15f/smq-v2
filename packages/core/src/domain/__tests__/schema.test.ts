import { describe, it, expect } from 'vitest';
import { normaliseShedConfig, coerceToMillimetres, extractionSchema, clampNotices, parseExtraction, parseModelJson, parseOptionEntry, shedConfigSchema } from '../schema';
import { DEFAULT_OPENING_SIZE, DEFAULT_SHED } from '../defaults';

describe('extractionSchema', () => {
  it('excludes the UI-only fields the model must not invent', () => {
    const keys = Object.keys(extractionSchema.shape);
    expect(keys).not.toContain('colors');
    expect(keys).not.toContain('displayUnit');
  });
  it('includes every field the model does extract', () => {
    const keys = Object.keys(extractionSchema.shape);
    for (const k of ['structureType', 'span', 'length', 'height', 'roofPitchDeg', 'bays', 'openings']) {
      expect(keys).toContain(k);
    }
  });
});

describe('parseModelJson (lenient JSON extraction)', () => {
  it('parses a bare JSON object', () => {
    expect(parseModelJson('{"span":8000}')).toEqual({ span: 8000 });
  });
  it('parses JSON wrapped in a ```json fence', () => {
    expect(parseModelJson('```json\n{"span":8000}\n```')).toEqual({ span: 8000 });
  });
  it('parses JSON wrapped in a bare ``` fence', () => {
    expect(parseModelJson('```\n{"span":8000}\n```')).toEqual({ span: 8000 });
  });
  it('parses JSON embedded in prose', () => {
    expect(parseModelJson('Sure! Here is your shed: {"span":8000,"bays":3} — hope that helps.'))
      .toEqual({ span: 8000, bays: 3 });
  });
  it('returns null when there is no JSON at all', () => {
    expect(parseModelJson('I could not understand that request.')).toBeNull();
  });
  it('returns null for malformed JSON', () => {
    expect(parseModelJson('{"span": 8000,}')).toBeNull();
  });
  it('ignores braces inside a fence line that is not the object', () => {
    expect(parseModelJson('Here: {"a": 1} and also {"b": 2}')).toEqual({ a: 1 });
  });
});

describe('parseExtraction (partial answers are fine)', () => {
  it('keeps only the fields the model actually stated', () => {
    // The user asked for 3 things; the other 4 are simply absent, not errors.
    const out = parseExtraction({ span: 8000, length: 15000, bays: 3 });
    expect(out).toEqual({ span: 8000, length: 15000, bays: 3 });
    expect(out).not.toHaveProperty('height');
    expect(out).not.toHaveProperty('roofPitchDeg');
  });
  it('is not an error when nothing recognisable is present', () => {
    expect(parseExtraction({ width_m: 8, length_m: 15 })).toEqual({});
  });
  it('drops a single invalid field but keeps the valid ones', () => {
    // `structureType: "shed"` is not one of our enums; the rest must survive.
    expect(parseExtraction({ structureType: 'shed', span: 8000, bays: 3 }))
      .toEqual({ span: 8000, bays: 3 });
  });
  it('drops a wrong-typed field but keeps the valid ones', () => {
    expect(parseExtraction({ span: 'abc', bays: 3 })).toEqual({ bays: 3 });
  });
  it('coerces numeric strings, which some models emit', () => {
    expect(parseExtraction({ span: '8000', bays: '3' })).toEqual({ span: 8000, bays: 3 });
  });
  it('keeps a valid opening array', () => {
    const out = parseExtraction({
      span: 8000,
      openings: [{ type: 'pa_door', width: 900, height: 2100, sill: 0, wall: 'front', align: 'center', offset: null, swing: null, track: null }],
    });
    expect(out.openings).toHaveLength(1);
    expect(out.openings![0].type).toBe('pa_door');
  });
  it('drops openings that are not usable without failing the whole answer', () => {
    const out = parseExtraction({ span: 8000, openings: [{ type: 'nonsense' }, null, 'x'] });
    // The span survives; the door list is omitted entirely (not set to []), so a
    // merge over the current config cannot silently delete the user's doors.
    expect(out.span).toBe(8000);
    expect(out).not.toHaveProperty('openings');
  });
});

describe('normaliseShedConfig', () => {
  it('accepts a complete valid config unchanged', () => {
    expect(normaliseShedConfig(DEFAULT_SHED)).toEqual(DEFAULT_SHED);
  });
  it('clamps an out-of-range bay count', () => {
    expect(normaliseShedConfig({ ...DEFAULT_SHED, bays: 500 }).bays).toBe(30);
    expect(normaliseShedConfig({ ...DEFAULT_SHED, bays: 1 }).bays).toBe(2);
  });
  it('fills missing optional fields from the default', () => {
    const out = normaliseShedConfig({ span: 12000, length: 24000, height: 4200, bays: 4 });
    expect(out.structureType).toBe(DEFAULT_SHED.structureType);
    expect(out.displayUnit).toBe('m');
    expect(out.openings).toEqual([]);
  });
  it('rejects an unknown structure type by falling back to gable', () => {
    expect(normaliseShedConfig({ ...DEFAULT_SHED, structureType: 'nonsense' }).structureType).toBe('gable');
  });
  it('drops openings that are not objects rather than throwing', () => {
    const out = normaliseShedConfig({ ...DEFAULT_SHED, openings: [null, 'x', { id: 'ok', type: 'pa_door', width: 900, height: 2100, sill: 0, wall: 'front', align: 'center', offset: null, swing: null, track: null }] });
    expect(out.openings).toHaveLength(1);
  });
  it('falls back to opening-plausible dimensions, not whole-shed ones', () => {
    // A malformed opening that survives the type check must not become a 12 m
    // door: its width/height fall back to a normal door size, not the shed's own
    // span/height. (Reachable through the untrusted `current` the route
    // normalises; the gated LLM path never emits these.)
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      openings: [{ type: 'pa_door', width: 'abc', height: null, sill: 0, wall: 'front', align: 'center', offset: null, swing: null, track: null }],
    });
    expect(out.openings).toHaveLength(1);
    expect(out.openings[0].width).toBe(DEFAULT_OPENING_SIZE.width);
    expect(out.openings[0].height).toBe(DEFAULT_OPENING_SIZE.height);
  });
});

describe('options at the config boundary', () => {
  it('keeps good options when one entry is malformed', () => {
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      options: [
        { id: 'sk-1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900 },
        { id: 'bad', kind: 'not_a_kind' },
        { id: 'aw-1', kind: 'awning', wall: 'front', align: 'center', offset: null, width: 3000, depth: 1000 },
      ],
    });
    expect(out.options.map((option) => option.kind)).toEqual(['skylight', 'awning']);
  });

  it('repairs a blank option id with a kind-specific prefix', () => {
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      options: [{ id: '', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900 }],
    });
    expect(out.options[0].id).toMatch(/^sk-/);
  });

  it('drops an option whose kind is unknown', () => {
    expect(parseOptionEntry({ id: 'x', kind: 'turret' }, DEFAULT_SHED)).toBeUndefined();
  });

  it('drops an option that is not an object', () => {
    expect(parseOptionEntry('skylight', DEFAULT_SHED)).toBeUndefined();
    expect(parseOptionEntry(null, DEFAULT_SHED)).toBeUndefined();
  });

  it('rounds option dimensions to integer millimetres', () => {
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      options: [{ id: 'sk-1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 899.6, height: 900.4 }],
    });
    expect(out.options[0]).toMatchObject({ width: 900, height: 900 });
  });

  it('clamps an option against the final bay count, not the raw one', () => {
    // `bays` is clamped to [2, 30] before options are parsed, so a skylight in
    // bay 9 of a 500-bay request lands in bay 29, not bay 9.
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      bays: 500,
      options: [{ id: 'sk-1', kind: 'skylight', bay: 40, alongBay: 0.5, width: 900, height: 900 }],
    });
    expect(out.options[0]).toMatchObject({ kind: 'skylight', bay: 29 });
  });

  it('defaults a missing options array to empty', () => {
    expect(normaliseShedConfig({ span: 12000 }).options).toEqual([]);
  });
});

describe('clampNotices', () => {
  it('notes an out-of-range bay count, naming both values', () => {
    expect(clampNotices({ ...DEFAULT_SHED, bays: 500 }).join(' ')).toMatch(/bays clamped to 30/i);
    expect(clampNotices({ ...DEFAULT_SHED, bays: 500 }).join(' ')).toMatch(/500/);
    expect(clampNotices({ ...DEFAULT_SHED, bays: 1 }).join(' ')).toMatch(/bays clamped to 2/i);
  });
  it('notes nothing for an in-range bay count', () => {
    expect(clampNotices({ ...DEFAULT_SHED, bays: 4 })).toEqual([]);
  });
  it('does not treat an in-range rounding as a clamp', () => {
    expect(clampNotices({ ...DEFAULT_SHED, bays: 3.7 })).toEqual([]);
    expect(clampNotices({ ...DEFAULT_SHED, bays: 2.4 })).toEqual([]);
  });
  it('notes nothing when bays is absent or unreadable', () => {
    expect(clampNotices({ span: 12000 })).toEqual([]);
    expect(clampNotices({ bays: 'many' })).toEqual([]);
    expect(clampNotices(null)).toEqual([]);
    expect(clampNotices('not an object')).toEqual([]);
  });
  it('reads a numeric string, as an HTML input would send', () => {
    expect(clampNotices({ bays: '500' }).join(' ')).toMatch(/bays clamped to 30/i);
    expect(clampNotices({ bays: '4' })).toEqual([]);
  });
});

describe('coerceToMillimetres', () => {
  it('converts a whole config that the model returned in metres', () => {
    const inMetres = { ...DEFAULT_SHED, span: 12, length: 24, height: 4.2, openings: [
      { id: 'd1', type: 'pa_door' as const, width: 0.9, height: 2.1, sill: 0, wall: 'front' as const, align: 'custom' as const, offset: 0.5, swing: null, track: null },
    ]};
    const out = coerceToMillimetres(inMetres);
    expect(out.span).toBe(12000);
    expect(out.length).toBe(24000);
    expect(out.height).toBe(4200);
    expect(out.openings[0].width).toBe(900);
    expect(out.openings[0].offset).toBe(500);
  });
  it('leaves a genuine millimetre config untouched', () => {
    expect(coerceToMillimetres(DEFAULT_SHED)).toEqual(DEFAULT_SHED);
  });
  it('does not rescale a small but plausible shed', () => {
    const small = { ...DEFAULT_SHED, span: 3000, length: 4000, height: 2400 };
    expect(coerceToMillimetres(small).span).toBe(3000);
  });
  it('decides the unit per field, so a mixed-unit response cannot corrupt the others', () => {
    const mixed = coerceToMillimetres({ ...DEFAULT_SHED, span: 12, length: 24000 });
    expect(mixed.span).toBe(12000);
    expect(mixed.length).toBe(24000);   // NOT 24,000,000
    expect(mixed.height).toBe(4200);    // NOT 4,200,000
  });
  it('does not rescale a small value the user typed — normalisation is not a unit converter', () => {
    // The form enters metres and `parseDimension` already converted to mm, so a
    // stored 12 means 12 mm, not 12 m. Normalisation must not multiply it by
    // 1000: doing so is what turned a typed "1" into 1000 and made "12000" come
    // out as "10002" as the field resynced mid-keystroke. Unit rescue lives in
    // `coerceToMillimetres`, which only the LLM path calls (extract.ts).
    const out = normaliseShedConfig({ span: 12 });
    expect(out.span).toBe(12);
    expect(out.length).toBe(24000);
    expect(out.height).toBe(4200);
  });
  it('leaves a small offset and opening dimension as typed', () => {
    const out = normaliseShedConfig({ ...DEFAULT_SHED, openings: [
      { id: 'd1', type: 'pa_door' as const, width: 900, height: 2100, sill: 0, wall: 'front' as const, align: 'custom' as const, offset: 5, swing: null, track: null },
    ]});
    expect(out.openings[0].offset).toBe(5);
  });
  it('never scales a zero dimension', () => {
    const zeroSill = coerceToMillimetres({ ...DEFAULT_SHED, span: 12, openings: [
      { id: 'd1', type: 'pa_door' as const, width: 0.9, height: 2.1, sill: 0, wall: 'front' as const, align: 'center' as const, offset: null, swing: null, track: null },
    ]});
    expect(zeroSill.openings[0].sill).toBe(0);
  });
  it('mints ids that never collide with an id already kept', () => {
    const out = normaliseShedConfig({ ...DEFAULT_SHED, openings: [
      { id: 'op-2', type: 'pa_door', width: 900, height: 2100, sill: 0, wall: 'front', align: 'center', offset: null, swing: null, track: null },
      { type: 'window', width: 900, height: 600, sill: 1200, wall: 'left', align: 'center', offset: null, swing: null, track: null },
    ]});
    const ids = out.openings.map((o) => o.id);
    expect(ids[0]).toBe('op-2');
    expect(new Set(ids).size).toBe(2);
    expect(ids[1]).not.toBe('op-2');
  });
});

describe('coerceToMillimetres and options (I2)', () => {
  it('rescales option dimensions expressed in metres', () => {
    const out = coerceToMillimetres({
      ...DEFAULT_SHED,
      span: 20,
      length: 30,
      height: 4.2,
      options: [
        { id: 'mz-1', kind: 'mezzanine', corner: 'back_left', width: 15, depth: 12, level: 2.4 },
      ],
    });
    expect(out.span).toBe(20000);
    expect(out.options[0]).toMatchObject({ kind: 'mezzanine', width: 15000, depth: 12000, level: 2400 });
  });

  it('rescales skylight, awning, outrigger and dividing-wall dimensions', () => {
    const out = coerceToMillimetres({
      ...DEFAULT_SHED,
      span: 12,
      length: 24,
      options: [
        { id: 'sk-1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 0.9, height: 0.9 },
        { id: 'aw-1', kind: 'awning', wall: 'front', align: 'center', offset: null, width: 3, depth: 1 },
        { id: 'og-1', kind: 'outrigger', wall: 'front', bay: 0, length: 1.9 },
        { id: 'dw-1', kind: 'dividing_wall', axis: 'x', at: 12, height: 4.2 },
      ],
    });
    expect(out.options[0]).toMatchObject({ width: 900, height: 900 });
    expect(out.options[1]).toMatchObject({ width: 3000, depth: 1000 });
    expect(out.options[2]).toMatchObject({ length: 1900 });
    expect(out.options[3]).toMatchObject({ at: 12000, height: 4200 });
  });

  it('leaves an already-millimetre option untouched', () => {
    const out = coerceToMillimetres({
      ...DEFAULT_SHED,
      options: [
        { id: 'sk-1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900 },
      ],
    });
    expect(out.options[0]).toMatchObject({ width: 900, height: 900 });
  });

  it('never scales a bay index or a 0..1 fraction', () => {
    const out = coerceToMillimetres({
      ...DEFAULT_SHED,
      options: [
        { id: 'sk-1', kind: 'skylight', bay: 1, alongBay: 0.5, width: 900, height: 900 },
      ],
    });
    expect(out.options[0]).toMatchObject({ bay: 1, alongBay: 0.5 });
  });
});

describe('the five remaining kinds at the config boundary', () => {
  it('round-trips every new kind', () => {
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      options: [
        { id: 'st-1', kind: 'stable', wall: 'left', align: 'center', offset: null,
          width: 3000, depth: 2400, height: 2400,
          panels: { left: true, right: false, front: true, back: false } },
        { id: 'cb-1', kind: 'carry_beam', wall: 'front', beginBay: 1, openingId: null },
        { id: 'hc-1', kind: 'horizontal_cladding', wall: 'back', from: 500, to: 3000 },
        { id: 'oh-1', kind: 'overhang', wall: 'right', depth: 800 },
        { id: 'cl-1', kind: 'cantilever', wall: 'left', bay: 2, length: 1500 },
      ],
    });
    expect(out.options.map((option) => option.kind)).toEqual([
      'stable', 'carry_beam', 'horizontal_cladding', 'overhang', 'cantilever',
    ]);
  });

  it('clears a carry beam reference to an opening on another wall', () => {
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      openings: [{ id: 'd1', type: 'pa_door', width: 900, height: 2100, sill: 0,
        wall: 'back', align: 'center', offset: null, swing: null, track: null }],
      options: [{ id: 'cb-1', kind: 'carry_beam', wall: 'front', beginBay: 0, openingId: 'd1' }],
    });
    expect(out.options[0]).toMatchObject({ kind: 'carry_beam', openingId: null });
  });

  it('clears a carry beam reference to a missing opening', () => {
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      options: [{ id: 'cb-1', kind: 'carry_beam', wall: 'front', beginBay: 0, openingId: 'gone' }],
    });
    expect(out.options[0]).toMatchObject({ openingId: null });
  });

  it('keeps a carry beam reference to an opening on its own wall', () => {
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      openings: [{ id: 'd1', type: 'roller_door', width: 3000, height: 2400, sill: 0,
        wall: 'front', align: 'center', offset: null, swing: null, track: null }],
      options: [{ id: 'cb-1', kind: 'carry_beam', wall: 'front', beginBay: 0, openingId: 'd1' }],
    });
    expect(out.options[0]).toMatchObject({ openingId: 'd1' });
  });
});

describe('track on openings', () => {
  it('keeps a track on a sliding door', () => {
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      openings: [{ id: 'd1', type: 'sliding_door', width: 3000, height: 2100, sill: 0,
        wall: 'front', align: 'center', offset: null, swing: 'outward', track: 'double' }],
    });
    expect(out.openings[0].track).toBe('double');
  });

  it('clears a track on a type that has no track', () => {
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      openings: [{ id: 'd1', type: 'pa_door', width: 900, height: 2100, sill: 0,
        wall: 'front', align: 'center', offset: null, swing: null, track: 'double' }],
    });
    expect(out.openings[0].track).toBeNull();
  });

  it('defaults a sliding door track to none', () => {
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      openings: [{ id: 'd1', type: 'sliding_door', width: 3000, height: 2100, sill: 0,
        wall: 'front', align: 'center', offset: null, swing: 'outward' }],
    });
    expect(out.openings[0].track).toBe('none');
  });
});

describe('internal pressure and charges', () => {
  it('falls back to closed for an unknown pressure', () => {
    expect(normaliseShedConfig({ ...DEFAULT_SHED, internalPressure: 'sideways' }).internalPressure)
      .toBe('closed');
  });

  it('keeps an open pressure', () => {
    expect(normaliseShedConfig({ ...DEFAULT_SHED, internalPressure: 'open' }).internalPressure)
      .toBe('open');
  });

  it('keeps good charges when one entry is malformed', () => {
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      charges: [
        { id: 'ch-1', label: 'Engineering', quantity: 1, unit: 'ea', unitPriceCents: 45000 },
        'nonsense',
        { id: 'ch-2', label: 'Delivery', quantity: 2, unit: 'ea', unitPriceCents: 14000 },
      ],
    });
    expect(out.charges.map((charge) => charge.label)).toEqual(['Engineering', 'Delivery']);
  });

  it('repairs a duplicate charge id', () => {
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      charges: [
        { id: 'ch-1', label: 'A', quantity: 1, unit: 'ea', unitPriceCents: 100 },
        { id: 'ch-1', label: 'B', quantity: 1, unit: 'ea', unitPriceCents: 200 },
      ],
    });
    expect(new Set(out.charges.map((charge) => charge.id)).size).toBe(2);
  });

  it('defaults a missing charges array to empty', () => {
    expect(normaliseShedConfig({ span: 12000 }).charges).toEqual([]);
  });
});

describe('stable panels from untrusted input (review minor)', () => {
  it('reads the string "false" as false, not true', () => {
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      options: [{ id: 'st-1', kind: 'stable', wall: 'front', width: 3000, depth: 2400, height: 2400,
        panels: { left: 'false', right: 'true', front: false, back: true } }],
    });
    expect(out.options[0]).toMatchObject({
      panels: { left: false, right: true, front: false, back: true },
    });
  });

  it('defaults a missing panel to on', () => {
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      options: [{ id: 'st-1', kind: 'stable', wall: 'front', width: 3000, depth: 2400, height: 2400,
        panels: { left: false } }],
    });
    expect(out.options[0]).toMatchObject({
      panels: { left: false, right: true, front: true, back: true },
    });
  });
});

describe('shedConfigSchema is the complete config (review minor)', () => {
  it('accepts a full config including options, charges, track, and pressure', () => {
    const result = shedConfigSchema.safeParse({
      ...DEFAULT_SHED,
      openings: [{ id: 'd1', type: 'sliding_door', width: 3000, height: 2100, sill: 0,
        wall: 'front', align: 'center', offset: null, swing: 'outward', track: 'double' }],
      options: [{ id: 'sk-1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900 }],
      charges: [{ id: 'ch-1', label: 'Delivery', quantity: 1, unit: 'ea', unitPriceCents: 28000 }],
      internalPressure: 'open',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config with no options array, so it cannot silently strip them', () => {
    const { options: _options, ...withoutOptions } = DEFAULT_SHED;
    expect(shedConfigSchema.safeParse(withoutOptions).success).toBe(false);
  });
});

describe('the complete extraction schema declares every extractable key (deferred minor)', () => {
  it('includes options, charges, and internal pressure', () => {
    expect(Object.keys(extractionSchema.shape)).toEqual(
      expect.arrayContaining(['options', 'charges', 'internalPressure']),
    );
  });
});

describe('partial opening extraction permits omitted track', () => {
  it('accepts a PA door with no track key', () => {
    const out = parseExtraction({ openings: [{ type: 'pa_door', width: 900, height: 2100,
      sill: 0, wall: 'front', align: 'center', offset: null, swing: null }] });
    expect(out.openings?.[0]).toBeDefined();
  });
});

describe('an AI answer can remove everything of a kind (explicit empty array)', () => {
  it('clears openings when the model returns an empty array', () => {
    const out = parseExtraction({ openings: [] });
    expect(out.openings).toEqual([]);
  });

  it('clears options when the model returns an empty array', () => {
    expect(parseExtraction({ options: [] }).options).toEqual([]);
  });

  it('clears charges when the model returns an empty array', () => {
    expect(parseExtraction({ charges: [] }).charges).toEqual([]);
  });

  it('still keeps the existing entries when every submitted entry is invalid', () => {
    // The guard that protects a malformed answer must survive the new rule: an
    // array of unusable entries is not the same as an empty array.
    const out = parseExtraction({ openings: [{ type: 'nonsense' }, null], options: [{ kind: 'turret' }] });
    expect(out.openings).toBeUndefined();
    expect(out.options).toBeUndefined();
  });
});

describe('site conditions survive a round trip', () => {
  it('keeps the site fields through normaliseShedConfig', () => {
    // These are on the config because the span table is indexed by them. A schema
    // that drops them re-prices the shed for a different site on the next edit.
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      windRegion: 'C',
      terrainCategory: 3,
      shieldingFactor: 0.8,
      importanceLevel: 2,
      topographyFactor: 1.1,
      stateCode: 'VIC',
    });
    expect(out.windRegion).toBe('C');
    expect(out.terrainCategory).toBe(3);
    expect(out.shieldingFactor).toBe(0.8);
    expect(out.importanceLevel).toBe(2);
    expect(out.topographyFactor).toBe(1.1);
    expect(out.stateCode).toBe('VIC');
  });

  it('falls back to the default for an unreadable site field', () => {
    const out = normaliseShedConfig({
      ...DEFAULT_SHED,
      windRegion: 'Z' as never,
      terrainCategory: 9 as never,
      stateCode: 'XX' as never,
    });
    expect(out.windRegion).toBe(DEFAULT_SHED.windRegion);
    expect(out.terrainCategory).toBe(DEFAULT_SHED.terrainCategory);
    expect(out.stateCode).toBe(DEFAULT_SHED.stateCode);
  });
});
