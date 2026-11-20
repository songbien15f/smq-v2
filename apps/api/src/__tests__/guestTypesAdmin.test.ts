import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { GUEST_DEFAULT_TYPES } from '@sq/core/domain';
import type { GuestBuildingTypeAdminDetail, GuestBuildingTypesAdminResponse } from '@sq/contracts';
import { makeTestApp, seedPlatformAdmin, signInPlatform, testConfig, type TestApp } from './helpers.js';

/**
 * The admin screen that defines the Guest page's building types.
 *
 * Four properties are worth a test each, and they are the four that would cost a customer something
 * if they broke:
 *
 * 1. **The first save copies the six defaults in** (Q4). Without it, editing one type makes the other
 *    five vanish from the Guest page — `loadBuildingTypes` answers the code defaults only while the
 *    table is empty.
 * 2. **Only the catalogue capability may write** (Q1). `platform_support` holds companies, enquiries
 *    and audit; it must not be able to change what every visitor sees.
 * 3. **A stale save is refused** (Q7), rather than silently overwriting somebody else's work.
 * 4. **A type that cannot be drawn is refused** — the start design goes through the same
 *    `validateGuestDesign` the page uses.
 *
 * `tests=on` for this file only; the rest of the plan is checked by hand.
 */

let ctx: TestApp;
let app: FastifyInstance;
let admin: string;
let support: string;

const PASSWORD = 'platform-password-long-enough';

async function listTypes(): Promise<GuestBuildingTypesAdminResponse> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/guest-types',
    headers: { cookie: admin },
  });
  expect(response.statusCode).toBe(200);
  return (JSON.parse(response.body) as { data: GuestBuildingTypesAdminResponse }).data;
}

async function detail(id: string): Promise<GuestBuildingTypeAdminDetail> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/guest-types/${id}`,
    headers: { cookie: admin },
  });
  expect(response.statusCode).toBe(200);
  return (JSON.parse(response.body) as { data: GuestBuildingTypeAdminDetail }).data;
}

beforeEach(async () => {
  ctx = await makeTestApp(testConfig());
  app = ctx.app;
  await seedPlatformAdmin(ctx.db, { email: 'admin@platform.test', password: PASSWORD });
  await seedPlatformAdmin(ctx.db, { email: 'support@platform.test', password: PASSWORD, role: 'platform_support' });
  admin = await signInPlatform(app, 'admin@platform.test', PASSWORD);
  support = await signInPlatform(app, 'support@platform.test', PASSWORD);
});

afterEach(async () => {
  await ctx.close();
});

describe('GET /admin/guest-types', () => {
  it('answers the six code defaults while the table is empty, marked as such', async () => {
    const data = await listTypes();
    expect(data.items).toHaveLength(GUEST_DEFAULT_TYPES.length);
    expect(data.items.map((t) => t.id).sort()).toEqual(GUEST_DEFAULT_TYPES.map((t) => t.id).sort());
    expect(data.items.every((t) => t.source === 'default' && t.enabled)).toBe(true);
    // Q8: the Guest page's origin comes from the API, so the admin needs no hard-coded port.
    expect(data.siteOrigin).toMatch(/^http:\/\/localhost:\d+$/);
  });

  it('refuses platform_support (Q1: the catalogue capability)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/guest-types',
      headers: { cookie: support },
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses an anonymous caller', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/guest-types' });
    expect(response.statusCode).toBe(401);
  });
});

describe('PUT /admin/guest-types/:id', () => {
  it('seeds all six on the first save, then changes only the one asked for', async () => {
    const before = await detail('garage');
    expect(before.item.source).toBe('default');
    expect(before.issues).toEqual([]);
    // A default has never been saved: version 0. The editor sends back exactly what it opened, so
    // this test must too — hard-coding 1 here once hid a 422 on every first save.
    expect(before.item.version).toBe(0);

    const write = {
      name: 'Garage',
      description: 'A gable-roof garage for one or two cars.',
      sortOrder: before.item.sortOrder,
      enabled: true,
      config: before.item.config,
      expectedVersion: before.item.version,
    };
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/guest-types/garage',
      headers: { cookie: admin },
      payload: { ...write, name: 'Garage (edited)' },
    });
    expect(saved.statusCode).toBe(200);
    expect(JSON.parse(saved.body).data.version).toBe(2);

    const after = await listTypes();
    // The whole point of Q4: six rows, not one.
    expect(after.items).toHaveLength(GUEST_DEFAULT_TYPES.length);
    expect(after.items.every((t) => t.source === 'database')).toBe(true);
    expect(after.items.find((t) => t.id === 'garage')?.name).toBe('Garage (edited)');
    expect(after.items.find((t) => t.id === 'carport')?.name).toBe('Carport');

    // And the seed is in the audit log, once.
    const audits = await ctx.db.all<{ action: string }>(
      `SELECT action FROM audit_events WHERE action = 'guest_type.seed_defaults'`,
    );
    expect(audits).toHaveLength(1);
  });

  it('refuses a form opened on a default once somebody else has seeded the table', async () => {
    const opened = await detail('garage');
    expect(opened.item.version).toBe(0);

    // Another admin disables the carport: that seeds all six and moves on.
    const other = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/guest-types/carport',
      headers: { cookie: admin },
      payload: { enabled: false },
    });
    expect(other.statusCode).toBe(200);

    const stale = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/guest-types/garage',
      headers: { cookie: admin },
      payload: {
        name: 'Garage',
        description: opened.item.description,
        sortOrder: opened.item.sortOrder,
        enabled: true,
        config: opened.item.config,
        expectedVersion: opened.item.version,
      },
    });
    expect(stale.statusCode).toBe(409);
  });

  it('refuses a stale save instead of overwriting (Q7)', async () => {
    const before = await detail('garage');
    const payload = {
      name: 'Garage',
      description: before.item.description,
      sortOrder: before.item.sortOrder,
      enabled: true,
      config: before.item.config,
      expectedVersion: 1,
    };

    const first = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/guest-types/garage',
      headers: { cookie: admin },
      payload: { ...payload, name: 'First writer' },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/guest-types/garage',
      headers: { cookie: admin },
      payload: { ...payload, name: 'Second writer' },
    });
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).code).toBe('conflict');

    const stored = await detail('garage');
    expect(stored.item.name).toBe('First writer');
  });

  it('refuses a start design the Guest page could not draw', async () => {
    const before = await detail('garage');
    const broken = {
      ...before.item.config,
      start: { ...before.item.config.start, pitchDeg: 12.5 },
    };
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/guest-types/garage',
      headers: { cookie: admin },
      payload: {
        name: 'Garage',
        description: before.item.description,
        sortOrder: before.item.sortOrder,
        enabled: true,
        config: broken,
        expectedVersion: 1,
      },
    });
    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { code: string; details: { message: string }[] };
    expect(body.code).toBe('validation_failed');
    expect(body.details.some((d) => /pitch/i.test(d.message))).toBe(true);
  });

  it('allows limits beyond the price book, because that is a warning not an error (Q2)', async () => {
    const before = await detail('garage');
    const wide = {
      ...before.item.config,
      limits: { ...before.item.config.limits, span: { min: 1800, max: 18000 } },
    };
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/guest-types/garage',
      headers: { cookie: admin },
      payload: {
        name: 'Garage',
        description: before.item.description,
        sortOrder: before.item.sortOrder,
        enabled: true,
        config: wide,
        expectedVersion: 1,
      },
    });
    expect(response.statusCode).toBe(200);

    const stored = await detail('garage');
    expect(stored.item.config.limits.span.max).toBe(18000);
    expect(stored.warnings.some((w) => /beyond the price book/i.test(w))).toBe(true);
  });

  it('refuses changing the id (Q5)', async () => {
    const before = await detail('garage');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/guest-types/garage',
      headers: { cookie: admin },
      payload: {
        id: 'garage2',
        name: 'Garage',
        description: before.item.description,
        sortOrder: before.item.sortOrder,
        enabled: true,
        config: before.item.config,
        expectedVersion: 1,
      },
    });
    expect(response.statusCode).toBe(422);
  });
});

describe('POST /admin/guest-types', () => {
  it('creates a type, and the Guest route serves seven', async () => {
    const template = (await detail('garage')).item.config;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/guest-types',
      headers: { cookie: admin },
      payload: {
        id: 'test_shed',
        name: 'Test Shed',
        description: 'Only for a test.',
        sortOrder: 500,
        enabled: true,
        config: template,
      },
    });
    expect(created.statusCode).toBe(201);

    const publicList = await app.inject({ method: 'GET', url: '/api/v1/public/guest/building-types' });
    expect(publicList.statusCode).toBe(200);
    const types = (JSON.parse(publicList.body) as { data: { types: { id: string }[] } }).data.types;
    expect(types).toHaveLength(GUEST_DEFAULT_TYPES.length + 1);
    expect(types.map((t) => t.id)).toContain('test_shed');
  });

  it('refuses a duplicate id with 409', async () => {
    const config = (await detail('garage')).item.config;
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/guest-types',
      headers: { cookie: admin },
      payload: { id: 'test_shed', name: 'Test Shed', description: '', sortOrder: 500, enabled: true, config },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/guest-types',
      headers: { cookie: admin },
      payload: { id: 'test_shed', name: 'Again', description: '', sortOrder: 600, enabled: true, config },
    });
    expect(second.statusCode).toBe(409);
  });

  it('refuses an id that is not a slug (Q5)', async () => {
    const config = (await detail('garage')).item.config;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/guest-types',
      headers: { cookie: admin },
      payload: { id: 'Test Shed', name: 'Test', description: '', sortOrder: 1, enabled: true, config },
    });
    expect(response.statusCode).toBe(422);
  });
});

describe('PATCH /admin/guest-types/:id', () => {
  it('disables a type, and the Guest page stops offering it', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/guest-types/aircraft_hangar',
      headers: { cookie: admin },
      payload: { enabled: false, expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(200);

    const publicList = await app.inject({ method: 'GET', url: '/api/v1/public/guest/building-types' });
    const types = (JSON.parse(publicList.body) as { data: { types: { id: string }[] } }).data.types;
    expect(types).toHaveLength(GUEST_DEFAULT_TYPES.length - 1);
    expect(types.map((t) => t.id)).not.toContain('aircraft_hangar');

    // Enabled again, it comes back — a type is switched off, never deleted (Q3).
    // The version comes from the response, not from arithmetic on a default row (whose version is 0
    // until the seed gives it 1): guessing it is what a stale save looks like.
    const disabledVersion = Number(JSON.parse(response.body).data.version);
    const reenabled = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/guest-types/aircraft_hangar',
      headers: { cookie: admin },
      payload: { enabled: true, expectedVersion: disabledVersion },
    });
    expect(reenabled.statusCode).toBe(200);
    const again = await app.inject({ method: 'GET', url: '/api/v1/public/guest/building-types' });
    const back = (JSON.parse(again.body) as { data: { types: { id: string }[] } }).data.types;
    expect(back).toHaveLength(GUEST_DEFAULT_TYPES.length);
    expect(back.map((t) => t.id)).toContain('aircraft_hangar');
  });

  it('records enable and disable in the audit log', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/guest-types/carport',
      headers: { cookie: admin },
      payload: { enabled: false },
    });
    const actions = await ctx.db.all<{ action: string }>(
      `SELECT action FROM audit_events WHERE target_id = 'carport' ORDER BY at`,
    );
    expect(actions.map((a) => a.action)).toContain('guest_type.disable');
  });
});

describe('POST /admin/guest-types/reorder', () => {
  it('writes sort orders ten apart, in the order given', async () => {
    const ids = ['house', 'carport', 'garage'];
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/guest-types/reorder',
      headers: { cookie: admin },
      payload: { ids },
    });
    expect(response.statusCode).toBe(200);

    // Placeholders built from the list: the driver's `SqlValue` is a scalar, so an array parameter
    // is not something this codebase passes (and `= ANY(?)` would need a Postgres array type).
    const rows = await ctx.db.all<{ id: string; sort_order: number | string }>(
      `SELECT id, sort_order FROM guest_building_types WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ids,
    );
    const byId = new Map(rows.map((r) => [r.id, Number(r.sort_order)]));
    expect(byId.get('house')).toBe(10);
    expect(byId.get('carport')).toBe(20);
    expect(byId.get('garage')).toBe(30);
  });

  it('refuses an id that does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/guest-types/reorder',
      headers: { cookie: admin },
      payload: { ids: ['garage', 'nope'] },
    });
    expect(response.statusCode).toBe(422);
  });
});
