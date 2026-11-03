import { describe, it, expect } from 'vitest';
import { toGatewaySchema, convertNullableUnions } from '../jsonSchema';

describe('convertNullableUnions', () => {
  it('rewrites type:[X,"null"] into anyOf with a null branch', () => {
    expect(convertNullableUnions({ type: ['string', 'null'] }))
      .toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
  });
  it('recurses into nested objects and arrays', () => {
    const out: any = convertNullableUnions({
      type: 'object',
      properties: { a: { type: 'array', items: { type: ['number', 'null'] } } },
    });
    expect(out.properties.a.items).toEqual({ anyOf: [{ type: 'number' }, { type: 'null' }] });
  });
  it('leaves a plain union of two real types alone', () => {
    expect(convertNullableUnions({ type: ['string', 'number'] }))
      .toEqual({ type: ['string', 'number'] });
  });
  it('leaves ordinary schemas untouched', () => {
    const s = { type: 'object', properties: { a: { type: 'number' } } };
    expect(convertNullableUnions(s)).toEqual(s);
  });
});

describe('toGatewaySchema', () => {
  it('contains no type array that includes null anywhere', () => {
    const json = JSON.stringify(toGatewaySchema());
    expect(json).not.toMatch(/"type"\s*:\s*\[[^\]]*"null"/);
  });
  it('requires no field, so a partial answer is a valid answer', () => {
    // `strict: true` turns `required` into a hard constraint. Requiring all seven
    // fields would reject the model's honest partial answer ("3 stated, 4
    // omitted") and silently fall back to the local parser.
    const s = toGatewaySchema() as { required?: string[] };
    expect(s.required).toBeUndefined();
  });
  it('still lists every extractable field as a property', () => {
    const s = toGatewaySchema() as { properties: Record<string, unknown> };
    for (const key of ['structureType', 'span', 'length', 'height', 'roofPitchDeg', 'bays', 'openings']) {
      expect(s.properties).toHaveProperty(key);
    }
  });
  it('omits the $schema key the gateway does not need', () => {
    expect((toGatewaySchema() as any).$schema).toBeUndefined();
  });
  it('does not ask the model for an opening id, which strict mode would enforce', () => {
    // Ids are minted locally; the enforced schema must not mention `id`.
    const json = JSON.stringify(toGatewaySchema());
    expect(json).not.toContain('"id"');
  });
});

describe('gateway schema covers the new vocabulary (review I9)', () => {
  it('lets the model return a track on an opening', () => {
    const schema = toGatewaySchema() as {
      properties: { openings: { items: { properties: Record<string, unknown> } } };
    };
    expect(Object.keys(schema.properties.openings.items.properties)).toContain('track');
  });

  it('lets the model return charges and an internal pressure', () => {
    const schema = toGatewaySchema() as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toContain('charges');
    expect(Object.keys(schema.properties)).toContain('internalPressure');
  });
});

describe('the model gets a shape for options and charges (deferred minor)', () => {
  it('gives the model a shape for an option, not an empty item schema', () => {
    const schema = toGatewaySchema() as {
      properties: { options: { items: Record<string, unknown> } };
    };
    const items = schema.properties.options.items as { properties?: Record<string, unknown> };
    expect(items.properties).toBeDefined();
    expect(Object.keys(items.properties ?? {})).toContain('kind');
  });

  it('gives the model a shape for a charge', () => {
    const schema = toGatewaySchema() as {
      properties: { charges: { items: { properties?: Record<string, unknown> } } };
    };
    expect(Object.keys(schema.properties.charges.items.properties ?? {}))
      .toEqual(expect.arrayContaining(['label', 'quantity', 'unit', 'unitPrice']));
  });
});

describe('typed option schema includes current fields', () => {
  it('declares stable panels and carry-beam openingId', () => {
    const schema = toGatewaySchema() as any;
    const props = schema.properties.options.items.properties;
    expect(props.panels).toBeDefined();
    expect(props.openingId).toBeDefined();
  });
});
