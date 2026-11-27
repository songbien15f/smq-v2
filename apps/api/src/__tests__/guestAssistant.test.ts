import { describe, expect, it } from 'vitest';
import { REPLY_JSON_SCHEMA } from '../lib/ai/schemas';
import { designContext, dropNulls, guardMessage, mentionsMoney, parseOps, redact } from '../lib/guestAssistant';
import { GUEST_DEFAULT_TYPES, guestDesignFromType, type GuestDesignInput } from '@sq/core/domain';

/** Every object node in a JSON schema, so the strict-mode rules can be checked everywhere at once. */
function objectNodes(node: unknown, path = '$'): { path: string; node: Record<string, unknown> }[] {
  if (node === null || typeof node !== 'object') return [];
  const self = node as Record<string, unknown>;
  const found: { path: string; node: Record<string, unknown> }[] = [];
  const isObject =
    self['type'] === 'object' ||
    (Array.isArray(self['type']) && (self['type'] as unknown[]).includes('object'));
  if (isObject) found.push({ path, node: self });
  for (const [key, value] of Object.entries(self)) {
    if (Array.isArray(value)) {
      value.forEach((item, i) => found.push(...objectNodes(item, `${path}.${key}[${i}]`)));
    } else {
      found.push(...objectNodes(value, `${path}.${key}`));
    }
  }
  return found;
}

describe('REPLY_JSON_SCHEMA (OpenAI Structured Outputs, strict)', () => {
  const objects = objectNodes(REPLY_JSON_SCHEMA.schema);

  it('finds the objects it is meant to check', () => {
    // The reply, the trim trio, the two `size` objects and one branch per operation.
    expect(objects.length).toBeGreaterThan(15);
  });

  it('sets additionalProperties: false on every object', () => {
    for (const { path, node } of objects) {
      expect(node['additionalProperties'], path).toBe(false);
    }
  });

  it('lists every property in required — strict mode has no optional fields', () => {
    for (const { path, node } of objects) {
      const properties = Object.keys((node['properties'] as Record<string, unknown>) ?? {});
      const required = [...((node['required'] as string[] | undefined) ?? [])].sort();
      expect(required, `${path} required must equal its property names`).toEqual([...properties].sort());
    }
  });

  it('expresses an optional value as a union with null, never by omitting the key', () => {
    const optional = objects.flatMap(({ node }) =>
      Object.entries((node['properties'] as Record<string, unknown>) ?? {}).filter(([, schema]) =>
        Array.isArray((schema as Record<string, unknown>)['type']),
      ),
    );
    expect(optional.length).toBeGreaterThan(0);
    for (const [, schema] of optional) {
      expect((schema as Record<string, unknown>)['type']).toContain('null');
    }
  });

  it('names the roof colour differently from the roof shape', () => {
    const branches = ((REPLY_JSON_SCHEMA.schema.properties.ops.items as unknown) as { anyOf: unknown[] })
      .anyOf as {
      properties: Record<string, unknown>;
    }[];
    const colour = branches.find((b) => (b.properties['op'] as { enum: string[] }).enum[0] === 'setColours');
    expect(colour).toBeDefined();
    expect(Object.keys(colour!.properties)).toContain('roofColour');
    expect(Object.keys(colour!.properties)).not.toContain('roof');
  });
});

describe('dropNulls', () => {
  it('removes null members so the strict zod schema can read the operation', () => {
    const op = { op: 'setColours', walls: null, roofColour: 'Monument', trim: { barge: null, gutter: 'Surfmist' } };
    expect(dropNulls(op)).toEqual({ op: 'setColours', roofColour: 'Monument', trim: { gutter: 'Surfmist' } });
  });

  it('keeps falsy values that are not null', () => {
    expect(dropNulls({ mm: 0, roof: 'gable', ok: false })).toEqual({ mm: 0, roof: 'gable', ok: false });
  });
});

describe('parseOps', () => {
  it('accepts a colour change the model wrote with nulls', () => {
    const { ops, dropped } = parseOps([
      { op: 'setColours', walls: null, roofColour: 'Monument', trim: null },
    ]);
    expect(dropped).toBe(0);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'setColours', roofColour: 'Monument' });
  });

  it('drops an operation with an unknown field or an out-of-range index', () => {
    expect(parseOps([{ op: 'setSpan', mm: 9000, surprise: 1 }]).dropped).toBe(1);
    expect(parseOps([{ op: 'removeBay', index: 99 }]).dropped).toBe(1);
  });

  it('caps the change set at ten operations, whoever answered', () => {
    /*
     * The schema says `maxItems: 10`. Gemini has to be able to receive that schema without `maxItems`
     * (a schema that large is refused), so the product's own limit is enforced here as well: ten ops
     * applied, nothing dropped, and the extra two are simply not there.
     */
    const twelve = Array.from({ length: 12 }, (_unused, i) => ({ op: 'setSpan', mm: 6000 + i * 100 }));
    const { ops, dropped } = parseOps(twelve);
    expect(ops).toHaveLength(10);
    expect(dropped).toBe(0);
  });
});

describe('redact', () => {
  it('masks an address Google answered in capitals', () => {
    expect(redact('2 GEORGE ST, BRISBANE CITY QLD 4000')).not.toMatch(/GEORGE/i);
  });

  it('masks street types the first version missed', () => {
    for (const address of ['15 Smith Lane', '7 Ocean View Rd', '3/12 Macquarie Street', '9 Kurrajong Crescent', '4 Wattle Grove']) {
      expect(redact(address), address).toContain('[address]');
    }
  });

  it('masks the suburb–state–postcode tail', () => {
    expect(redact('1 Sturt Street Ballarat Central VIC 3350')).not.toMatch(/VIC\s*3350/i);
  });

  it('masks an email and an Australian mobile', () => {
    expect(redact('mail bob@example.com')).toContain('[email]');
    expect(redact('call 0412 345 678')).toContain('[mobile]');
    expect(redact('call +61 412 345 678')).toContain('[mobile]');
  });

  it('leaves an ordinary instruction alone', () => {
    for (const sentence of [
      'make it 9 metres wide',
      '3 bays of 3 m',
      'steeper roof, 25 degrees',
      'add a window on the left wall',
      'drop the second window',
      'it is going in Ballarat',
    ]) {
      expect(redact(sentence), sentence).toBe(sentence);
    }
  });
});

describe('money guard', () => {
  it('catches the forms a model actually writes', () => {
    for (const text of ['about $12,000', 'costs 12000 AUD', 'roughly 9k dollars', 'the price is on the quote']) {
      expect(mentionsMoney(text), text).toBe(true);
    }
  });

  it('leaves a design sentence alone', () => {
    for (const text of ['Made it 9 metres wide.', 'Added a roller door on the front wall.', 'The roof is now 15°.']) {
      expect(mentionsMoney(text), text).toBe(false);
    }
  });

  it('replaces a reply that mentions money, and keeps a clean one', () => {
    const dirty = guardMessage('A dark roof adds about $12,000.');
    expect(dirty.replaced).toBe(true);
    expect(dirty.message).not.toMatch(/\$|12,000/);
    expect(dirty.message).toMatch(/formal quote by email/i);

    const clean = guardMessage('Made it 9 metres wide.');
    expect(clean.replaced).toBe(false);
    expect(clean.message).toBe('Made it 9 metres wide.');
  });
});

/**
 * What the model is told about opening positions (plan `guest-opening-placement` Task 4, follow-ups
 * Task A).
 *
 * Without this the assistant could not answer "move the left door towards the back": it knew a door
 * existed on a wall but not where it was. The fixture is the Riding Arena the guest tests use — a
 * 30 m long wall, side doors centred at 13500.
 */
describe('designContext — where each opening is', () => {
  const arena = (() => {
    const found = GUEST_DEFAULT_TYPES.find((t) => t.id === 'riding_arena');
    if (found === undefined) throw new Error('no riding_arena type');
    return found;
  })();

  const withSideDoors = (): GuestDesignInput => {
    const base = guestDesignFromType(arena);
    return {
      ...base,
      openings: [
        ...base.openings,
        { type: 'roller_door', wall: 'left', offset: 13500, size: { width: 3000, height: 2100 }, motorised: false },
        { type: 'roller_door', wall: 'right', offset: 13500, size: { width: 3000, height: 2100 }, motorised: false },
      ],
    };
  };

  it('reports a centred side door as its left edge along the wall', () => {
    const context = designContext(withSideDoors(), arena, []);
    expect(context).toContain('1: roller_door on left wall, 3000×2100 mm, left edge 13500 mm along a 30000 mm wall, centred');
  });

  it('names an opening parked by an end, at the margin, as being at that end', () => {
    const base = withSideDoors();
    const atStart: GuestDesignInput = {
      ...base,
      openings: base.openings.map((o, i) => (i === 1 ? { ...o, offset: 100 } : o)),
    };
    expect(designContext(atStart, arena, [])).toContain('left edge 100 mm along a 30000 mm wall, at the start end');
  });

  it('names the far end, and says nothing extra for an opening in between', () => {
    const base = withSideDoors();
    const far: GuestDesignInput = {
      ...base,
      openings: base.openings.map((o, i) => (i === 1 ? { ...o, offset: 26900 } : o)),
    };
    expect(designContext(far, arena, [])).toContain('left edge 26900 mm along a 30000 mm wall, at the far end');

    const between: GuestDesignInput = {
      ...base,
      openings: base.openings.map((o, i) => (i === 1 ? { ...o, offset: 6000 } : o)),
    };
    expect(designContext(between, arena, [])).toContain('left edge 6000 mm along a 30000 mm wall;');
  });
});
