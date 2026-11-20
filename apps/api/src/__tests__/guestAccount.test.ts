import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { guestDesignFromType, type GuestBuildingTypeSpec } from '@sq/core/domain';
import { makeTestApp, seedCompany, signIn, type TestApp } from './helpers';

/**
 * Optional Guest accounts (docs/specs/guest-accounts.md): the account is a second kind of session
 * beside the company one, so the tests are about the edges between them — a guest cookie opens no
 * company route, a company cookie opens no guest route, one guest never reaches another's rows, and
 * a request sent while signed in lands on the account and removes the draft it came from.
 *
 * Each test gets a fresh database: sign-up is limited per address (5 an hour), and every inject
 * comes from 127.0.0.1.
 */

let ctx: TestApp;

beforeEach(async () => {
  ctx = await makeTestApp(); // mail = null: nothing here can send a message.
});

afterEach(async () => {
  await ctx.close();
});

const SITE = { suburb: 'Tamworth', state: 'NSW' as const, postcode: '2340' };

function contact(email: string) {
  return { firstName: 'Jo', lastName: 'Citizen', email, mobile: '0412 345 678' };
}

/** Sign up and answer the `sq_guest` cookie as a request header. */
async function signUp(email: string, password = 'password123'): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/public/guest/account/sign-up',
    payload: { ...contact(email), password },
  });
  expect(response.statusCode).toBe(201);
  const cookie = response.cookies.find((c) => c.name === 'sq_guest');
  expect(cookie).toBeDefined();
  return `sq_guest=${cookie!.value}`;
}

async function firstType(): Promise<GuestBuildingTypeSpec> {
  const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/public/guest/building-types' });
  expect(response.statusCode).toBe(200);
  const types = (JSON.parse(response.body) as { data: { types: GuestBuildingTypeSpec[] } }).data.types;
  expect(types.length).toBeGreaterThan(0);
  return types[0]!;
}

async function putDraft(cookie: string, id: string, type: GuestBuildingTypeSpec) {
  return ctx.app.inject({
    method: 'PUT',
    url: `/api/v1/public/guest/account/drafts/${id}`,
    headers: { cookie },
    payload: { design: guestDesignFromType(type, SITE), step: 'design' },
  });
}

describe('the two kinds of session stay apart', () => {
  it('a guest cookie opens no company route', async () => {
    const guest = await signUp('jo@guest.test');
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/quotes', headers: { cookie: guest } });
    expect(response.statusCode).toBe(401);
  });

  it('a company session opens no guest account route', async () => {
    await seedCompany(ctx.db, { name: 'Sheds', slug: 'sheds', email: 'staff@sheds.test', password: 'staff-password-1' });
    const staff = await signIn(ctx.app, 'staff@sheds.test', 'staff-password-1');
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/public/guest/account',
      headers: { cookie: staff },
    });
    expect(response.statusCode).toBe(401);
  });

  it('signing out ends the guest session', async () => {
    const guest = await signUp('jo@guest.test');
    const out = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/public/guest/account/sign-out',
      headers: { cookie: guest },
    });
    expect(out.statusCode).toBe(200);
    const after = await ctx.app.inject({ method: 'GET', url: '/api/v1/public/guest/account', headers: { cookie: guest } });
    expect(after.statusCode).toBe(401);
  });
});

describe('sign-in says nothing about which half was wrong', () => {
  it('answers a wrong password and an unknown email identically', async () => {
    await signUp('jo@guest.test');
    const attempt = (email: string) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/v1/public/guest/account/sign-in',
        payload: { email, password: 'not-the-password' },
      });
    const wrongPassword = await attempt('jo@guest.test');
    const unknownEmail = await attempt('nobody@guest.test');
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(wrongPassword.statusCode);
    expect(JSON.parse(unknownEmail.body)).toEqual(JSON.parse(wrongPassword.body));
    expect(wrongPassword.cookies.find((c) => c.name === 'sq_guest')).toBeUndefined();
  });

  it('signs in with the email in any case', async () => {
    await signUp('jo@guest.test');
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/public/guest/account/sign-in',
      payload: { email: '  JO@Guest.test ', password: 'password123' },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('one guest never reaches another guest\'s rows', () => {
  it('B cannot read, overwrite or delete A\'s draft', async () => {
    const type = await firstType();
    const a = await signUp('a@guest.test');
    const b = await signUp('b@guest.test');
    const id = randomUUID();

    expect((await putDraft(a, id, type)).statusCode).toBeLessThan(300);

    const listB = await ctx.app.inject({ method: 'GET', url: '/api/v1/public/guest/account/drafts', headers: { cookie: b } });
    expect(listB.statusCode).toBe(200);
    expect((JSON.parse(listB.body) as { data: { items: unknown[] } }).data.items).toHaveLength(0);

    // The same id under B: refused as not found, never "taken" (that would confirm it exists).
    expect((await putDraft(b, id, type)).statusCode).toBe(404);

    const deleteB = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/public/guest/account/drafts/${id}`,
      headers: { cookie: b },
    });
    expect(deleteB.statusCode).toBe(404);

    const listA = await ctx.app.inject({ method: 'GET', url: '/api/v1/public/guest/account/drafts', headers: { cookie: a } });
    const itemsA = (JSON.parse(listA.body) as { data: { items: { id: string }[] } }).data.items;
    expect(itemsA.map((d) => d.id)).toEqual([id]);
  });

  it('refuses a draft id that is not a uuid as not found', async () => {
    const type = await firstType();
    const a = await signUp('a@guest.test');
    expect((await putDraft(a, 'not-a-uuid', type)).statusCode).toBe(404);
  });
});

describe('sending while signed in', () => {
  it('records the request on the account and deletes the draft it came from', async () => {
    const type = await firstType();
    const a = await signUp('a@guest.test');
    const b = await signUp('b@guest.test');
    const draftId = randomUUID();
    expect((await putDraft(a, draftId, type)).statusCode).toBeLessThan(300);

    const sent = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/public/guest-requests',
      headers: { cookie: a },
      payload: {
        design: guestDesignFromType(type, SITE),
        contact: contact('a@guest.test'),
        consent: true,
        draftId,
      },
    });
    expect(sent.statusCode).toBe(202);
    const number = (JSON.parse(sent.body) as { data: { number: string } }).data.number;

    const row = await ctx.db.get<{ account_id: string | null }>(
      'SELECT account_id FROM guest_requests WHERE number = ?',
      [number],
    );
    expect(row?.account_id).not.toBeNull();

    const drafts = await ctx.app.inject({ method: 'GET', url: '/api/v1/public/guest/account/drafts', headers: { cookie: a } });
    expect((JSON.parse(drafts.body) as { data: { items: unknown[] } }).data.items).toHaveLength(0);

    const listA = await ctx.app.inject({ method: 'GET', url: '/api/v1/public/guest/account/requests', headers: { cookie: a } });
    const itemsA = (JSON.parse(listA.body) as { data: { items: { number: string }[] } }).data.items;
    expect(itemsA.map((r) => r.number)).toEqual([number]);

    const listB = await ctx.app.inject({ method: 'GET', url: '/api/v1/public/guest/account/requests', headers: { cookie: b } });
    expect((JSON.parse(listB.body) as { data: { items: unknown[] } }).data.items).toHaveLength(0);
  });

  it('a draft id belonging to someone else survives the other guest\'s send', async () => {
    const type = await firstType();
    const a = await signUp('a@guest.test');
    const b = await signUp('b@guest.test');
    const draftId = randomUUID();
    expect((await putDraft(a, draftId, type)).statusCode).toBeLessThan(300);

    const sent = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/public/guest-requests',
      headers: { cookie: b },
      payload: { design: guestDesignFromType(type, SITE), contact: contact('b@guest.test'), consent: true, draftId },
    });
    expect(sent.statusCode).toBe(202);

    const drafts = await ctx.app.inject({ method: 'GET', url: '/api/v1/public/guest/account/drafts', headers: { cookie: a } });
    expect((JSON.parse(drafts.body) as { data: { items: unknown[] } }).data.items).toHaveLength(1);
  });

  it('an anonymous send still works and belongs to no account', async () => {
    const type = await firstType();
    const sent = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/public/guest-requests',
      payload: { design: guestDesignFromType(type, SITE), contact: contact('anon@guest.test'), consent: true },
    });
    expect(sent.statusCode).toBe(202);
    const number = (JSON.parse(sent.body) as { data: { number: string } }).data.number;
    const row = await ctx.db.get<{ account_id: string | null }>(
      'SELECT account_id FROM guest_requests WHERE number = ?',
      [number],
    );
    expect(row?.account_id).toBeNull();
  });
});
