import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  makeTestApp,
  seedCompany,
  seedPlatformAdmin,
  signIn,
  signInPlatform,
  testConfig,
  type TestApp,
} from './helpers';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await makeTestApp();
});

afterAll(async () => {
  await ctx.close();
});

describe('health', () => {
  it('answers live without touching the database', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, data: { live: true } });
  });

  it('answers ready with the driver name', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(response.statusCode).toBe(200);
    // The driver is reported, not pinned. This suite runs on whichever database the run was
    // pointed at, and hardcoding `sqlite` would make the Postgres run fail on a correct answer.
    expect(response.json().data).toEqual({ ready: true, database: ctx.db.driver });
  });

  it('answers a 404 in the same envelope, so a client parses one shape', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().ok).toBe(false);
    expect(response.json().code).toBe('not_found');
  });
});

describe('sign-in', () => {
  it('refuses an unknown account and a wrong password with the same answer', async () => {
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      payload: { companyCode: 'NOPE', username: 'nobody', password: 'whatever-it-is' },
    });
    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      payload: { companyCode: 'NOPE', username: 'owner', password: 'not-the-password' },
    });

    // The same status and the same message. Anything else is an account oracle — and with a
    // company code in the request, it would also tell a caller which codes are real.
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json().message).toBe(wrong.json().message);
  });

  it('rejects a malformed body with field details a form can render', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      payload: { companyCode: 'ACME', username: '', password: '' },
    });
    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.code).toBe('validation_failed');
    expect(body.details.map((detail: { path: string }) => detail.path)).toContain('username');
  });

  it('refuses a company user who typed no company code', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      payload: { username: 'owner', password: 'correct horse battery staple' },
    });
    // The same 422 shape as any other field problem, so the form renders the message under the
    // company-code input rather than on a separate error path.
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('validation_failed');
    expect(response.json().details.map((detail: { path: string }) => detail.path)).toContain('companyCode');
  });

  it('signs in and returns the role capabilities', async () => {
    await seedCompany(ctx.db, {
      name: 'Acme Sheds',
      slug: 'acme',
      email: 'owner@acme.test',
      password: 'correct horse battery staple',
      role: 'company_admin',
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      // Lower-case on purpose: a person types their code the way they say it, and the
      // comparison is case-insensitive. `signInRequest` does not upper-case for us.
      payload: { companyCode: 'acme', username: 'owner', password: 'correct horse battery staple' },
    });

    expect(response.statusCode).toBe(200);
    const session = response.json().data;
    expect(session.email).toBe('owner@acme.test');
    expect(session.memberships).toHaveLength(1);
    expect(session.memberships[0].username).toBe('owner');
    expect(session.currentTenantCode).toBe('ACME');
    expect(session.currentTenantName).toBe('Acme Sheds');
    expect(session.capabilities).toContain('quote:write');
    expect(session.mustChangePassword).toBe(false);
    expect(response.headers['set-cookie']).toBeDefined();
  });

  it('returns the session on a subsequent request and nothing without a cookie', async () => {
    const cookie = await signIn(ctx.app, 'owner@acme.test', 'correct horse battery staple');

    const withCookie = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie },
    });
    expect(withCookie.statusCode).toBe(200);
    expect(withCookie.json().data.email).toBe('owner@acme.test');

    const without = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session' });
    expect(without.statusCode).toBe(401);
  });

  it('signs out and the old cookie no longer resolves', async () => {
    const cookie = await signIn(ctx.app, 'owner@acme.test', 'correct horse battery staple');

    await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/sign-out', headers: { cookie } });

    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie },
    });
    expect(after.statusCode).toBe(401);
  });
});

describe('seats', () => {
  it('refuses a session beyond the seat count, and frees the seat on sign-out', async () => {
    await seedCompany(ctx.db, {
      name: 'Two Seats Pty',
      slug: 'two-seats',
      seats: 2,
      email: 'boss@two.test',
      password: 'a-long-enough-password',
    });
    await seedCompany(ctx.db, {
      name: 'Two Seats Pty',
      slug: 'two-seats-2',
      seats: 2,
      email: 'other@two.test',
      password: 'a-long-enough-password',
    });

    const first = await signIn(ctx.app, 'boss@two.test', 'a-long-enough-password');
    expect(first).toContain('sq_session=');

    // A second session for the same person is a second seat: the seat belongs to a
    // session, not to a user, or one person signing in on two devices would cost
    // nothing.
    const second = await signIn(ctx.app, 'boss@two.test', 'a-long-enough-password');
    expect(second).toContain('sq_session=');

    const refused = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      payload: { companyCode: 'TWOSEATS', username: 'boss', password: 'a-long-enough-password' },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().message).toMatch(/seat/i);

    // Signing out must release the seat, or a company would leak capacity all day.
    await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/sign-out', headers: { cookie: first } });

    const afterRelease = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      payload: { companyCode: 'TWOSEATS', username: 'boss', password: 'a-long-enough-password' },
    });
    expect(afterRelease.statusCode).toBe(200);
  });
});

describe('capability enforcement', () => {
  it('gives a viewer no cost data on a quote, and the admin version', async () => {
    const { tenantId } = await seedCompany(ctx.db, {
      name: 'Cost Test Ltd',
      slug: 'cost-test',
      email: 'admin@cost.test',
      password: 'a-long-enough-password',
      role: 'company_admin',
    });
    await ctx.db.run(
      `INSERT INTO users (id, email, display_name, password_hash, must_change_password, created_at, updated_at)
       VALUES ('viewer-1', 'viewer@cost.test', 'Viewer', NULL, 0, ?, ?)`,
      [new Date().toISOString(), new Date().toISOString()],
    );
    await ctx.db.run(
      `INSERT INTO memberships (tenant_id, user_id, role, status, created_at, updated_at, username)
       VALUES (?, 'viewer-1', 'viewer', 'active', ?, ?, 'viewer')`,
      [tenantId, new Date().toISOString(), new Date().toISOString()],
    );

    const at = new Date().toISOString();
    await ctx.db.run(
      `INSERT INTO quotes (id, tenant_id, number, status, current_revision, contract_cents, incomplete, site_json, created_at, updated_at)
       VALUES ('q-cost', ?, 'Q-2001', 'issued', 1, 1234500, 0, '{}', ?, ?)`,
      [tenantId, at, at],
    );

    const adminCookie = await signIn(ctx.app, 'admin@cost.test', 'a-long-enough-password');

    // Give the viewer a password by hand, then sign in as them.
    const { hashPassword } = await import('../lib/password');
    const hash = await hashPassword('a-long-enough-password');
    await ctx.db.run("UPDATE users SET password_hash = ?, password_set_at = ? WHERE id = 'viewer-1'", [
      hash,
      at,
    ]);
    const viewerCookie = await signIn(ctx.app, 'viewer@cost.test', 'a-long-enough-password');

    const asAdmin = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/quotes/q-cost',
      headers: { cookie: adminCookie },
    });
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.json().data.contractCents).toBe(1234500);

    const asViewer = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/quotes/q-cost',
      headers: { cookie: viewerCookie },
    });
    expect(asViewer.statusCode).toBe(200);
    // The field is absent, not null: a null price is indistinguishable from an
    // unpriced quote, and a viewer must not be able to tell the difference.
    expect(asViewer.json().data.contractCents).toBeUndefined();
    expect(asViewer.json().data.number).toBe('Q-2001');
  });

  it('refuses a company route to a platform administrator with no membership', async () => {
    await seedPlatformAdmin(ctx.db, {
      email: 'ops@vendor.test',
      password: 'a-long-enough-password',
    });
    // Licence-vendor staff belong to no company, so they arrive through their own door. The
    // company route below is the one that must refuse them: being licence-vendor staff says
    // nothing about which customer's quotes a person may read.
    const cookie = await signInPlatform(ctx.app, 'ops@vendor.test', 'a-long-enough-password');
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/quotes',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it('lets a platform administrator list companies but not a support user publish', async () => {
    await seedPlatformAdmin(ctx.db, {
      email: 'support@vendor.test',
      password: 'a-long-enough-password',
      role: 'platform_support',
    });
    const cookie = await signInPlatform(ctx.app, 'support@vendor.test', 'a-long-enough-password');

    const companies = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/companies',
      headers: { cookie },
    });
    expect(companies.statusCode).toBe(200);
    expect(Array.isArray(companies.json().data.items)).toBe(true);
  });
});

/**
 * Company creation.
 *
 * Creating a company is an ordinary operation now: the product is multi-company, so there is no
 * mode to switch on and no second-call refusal to pin. What still matters is that a created
 * company comes with an administrator who can sign in.
 */
describe('creating a company', () => {
  let provisioning: TestApp;

  beforeAll(async () => {
    provisioning = await makeTestApp(testConfig());
    await seedPlatformAdmin(provisioning.db, {
      email: 'owner@vendor.test',
      password: 'a-long-enough-password',
    });
  });

  afterAll(async () => {
    await provisioning.close();
  });

  it('creates a company with an administrator and returns a one-time password', async () => {
    const cookie = await signInPlatform(provisioning.app, 'owner@vendor.test', 'a-long-enough-password');

    const created = await provisioning.app.inject({
      method: 'POST',
      url: '/api/v1/admin/companies',
      headers: { cookie },
      payload: {
        name: 'New Customer Sheds',
        code: 'newcust',
        slug: 'new-customer',
        seats: 4,
        subscriptionEndsAt: null,
        adminEmail: 'boss@newcustomer.test',
        adminDisplayName: 'New Boss',
      },
    });

    expect(created.statusCode).toBe(201);
    const body = created.json().data;
    expect(body.tenantId).toBeTruthy();
    expect(body.temporaryPassword.length).toBeGreaterThan(20);

    // The new administrator can sign in with the temporary password, and is told to
    // change it. The username defaults to the local part of their email — the same rule the
    // 009 migration applies — and the code is stored upper-cased.
    const signInAsNew = await provisioning.app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      payload: { companyCode: 'NEWCUST', username: 'boss', password: body.temporaryPassword },
    });
    expect(signInAsNew.statusCode).toBe(200);
    expect(signInAsNew.json().data.mustChangePassword).toBe(true);
    expect(signInAsNew.json().data.currentTenantCode).toBe('NEWCUST');

    // ...and the forced change actually blocks the company routes.
    const raw = signInAsNew.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : [raw ?? ''];
    const cookieHeader = (cookies.find((v) => v.startsWith('sq_session=')) ?? '').split(';')[0];

    const blocked = await provisioning.app.inject({
      method: 'GET',
      url: '/api/v1/quotes',
      headers: { cookie: cookieHeader as string },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().message).toMatch(/password/i);
  });

  it('refuses a duplicate slug with a conflict, not a 500', async () => {
    const cookie = await signInPlatform(provisioning.app, 'owner@vendor.test', 'a-long-enough-password');
    const duplicate = await provisioning.app.inject({
      method: 'POST',
      url: '/api/v1/admin/companies',
      headers: { cookie },
      payload: {
        name: 'Another Name',
        code: 'ANOTHER',
        slug: 'new-customer',
        seats: 1,
        subscriptionEndsAt: null,
        adminEmail: 'different@newcustomer.test',
        adminDisplayName: 'Someone Else',
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('conflict');
  });

  it('refuses a duplicate company code with a conflict, not a 500', async () => {
    const cookie = await signInPlatform(provisioning.app, 'owner@vendor.test', 'a-long-enough-password');
    const duplicate = await provisioning.app.inject({
      method: 'POST',
      url: '/api/v1/admin/companies',
      headers: { cookie },
      payload: {
        name: 'A Code Clone',
        code: 'newcust', // same as the first company, different slug
        slug: 'code-clone',
        seats: 1,
        subscriptionEndsAt: null,
        adminEmail: 'clone@newcustomer.test',
        adminDisplayName: 'Clone Boss',
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('conflict');
  });

  it('records the creation in the audit log', async () => {
    const cookie = await signInPlatform(provisioning.app, 'owner@vendor.test', 'a-long-enough-password');
    const audit = await provisioning.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit',
      headers: { cookie },
    });
    expect(audit.statusCode).toBe(200);
    const actions = audit.json().data.items.map((item: { action: string }) => item.action);
    expect(actions).toContain('company.install');
  });
});

/**
 * More than one company.
 *
 * The single-company invariant is gone: a quoting product that installs once per customer has
 * one company, but the licence-vendor control plane — this admin side — must hold many, so the
 * only honest model is multi-company everywhere. The list below confirms two companies coexist
 * and that neither is hidden.
 */
describe('more than one company', () => {
  let multi: TestApp;

  beforeAll(async () => {
    multi = await makeTestApp();
    await seedCompany(multi.db, {
      name: 'Alpha Sheds',
      slug: 'alpha',
      code: 'AAA',
      email: 'boss@alpha.test',
      password: 'a-long-enough-password',
    });
    await seedCompany(multi.db, {
      name: 'Beta Sheds',
      slug: 'beta',
      code: 'BBB',
      email: 'boss@beta.test',
      password: 'a-long-enough-password',
    });
    await seedPlatformAdmin(multi.db, { email: 'ops@vendor.test', password: 'a-long-enough-password' });
  });

  afterAll(async () => {
    await multi.close();
  });

  it('lists every company, not just the first', async () => {
    const cookie = await signInPlatform(multi.app, 'ops@vendor.test', 'a-long-enough-password');
    const list = await multi.app.inject({
      method: 'GET',
      url: '/api/v1/admin/companies',
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    const names = list.json().data.items.map((row: { name: string }) => row.name).sort();
    expect(names).toEqual(['Alpha Sheds', 'Beta Sheds']);
  });

  it('gives each set of staff their own sign-in, keyed on the code', async () => {
    const alpha = await signIn(multi.app, 'AAA', 'boss', 'a-long-enough-password');
    const beta = await signIn(multi.app, 'bbb', 'boss', 'a-long-enough-password');

    const a = await multi.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: alpha } });
    const b = await multi.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: beta } });

    expect(a.json().data.currentTenantName).toBe('Alpha Sheds');
    expect(b.json().data.currentTenantName).toBe('Beta Sheds');
    expect(a.json().data.currentTenantId).not.toBe(b.json().data.currentTenantId);
  });
});

describe('suspending a company', () => {
  it('revokes every session immediately, not at the next sign-in', async () => {
    const { tenantId } = await seedCompany(ctx.db, {
      name: 'Suspended Pty',
      slug: 'suspended',
      email: 'staff@suspended.test',
      password: 'a-long-enough-password',
    });

    const staffCookie = await signIn(ctx.app, 'staff@suspended.test', 'a-long-enough-password');
    const before = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: staffCookie },
    });
    expect(before.statusCode).toBe(200);

    await seedPlatformAdmin(ctx.db, {
      email: 'admin@suspender.test',
      password: 'a-long-enough-password',
    });
    const adminCookie = await signInPlatform(ctx.app, 'admin@suspender.test', 'a-long-enough-password');

    const suspended = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/companies/${tenantId}/status`,
      headers: { cookie: adminCookie },
      payload: { status: 'suspended', reason: 'unpaid invoice' },
    });
    expect(suspended.statusCode).toBe(200);

    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: staffCookie },
    });
    expect(after.statusCode).toBe(401);

    // And they cannot sign back in either. The refusal arrives after their password checks out,
    // so a suspended company's code is never confirmed to a caller who cannot prove they work
    // there.
    const refused = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      payload: { companyCode: 'SUSPENDED', username: 'staff', password: 'a-long-enough-password' },
    });
    expect(refused.statusCode).toBe(403);
  });
});

describe('the quote list', () => {
  /**
   * Self-contained on purpose.
   *
   * An earlier version signed in as a company created by a different `describe` block. That
   * passed on SQLite and failed on Postgres, because Vitest does not promise an order between
   * blocks and the two drivers happened to collect differently — the test was depending on a
   * side effect of its neighbours, which is a test that reports on the runner rather than the
   * code.
   */
  let list: TestApp;

  beforeAll(async () => {
    list = await makeTestApp();
    await seedCompany(list.db, {
      name: 'List Test Sheds',
      slug: 'list-test',
      email: 'owner@list.test',
      password: 'a-long-enough-password',
      role: 'company_admin',
    });
  });

  afterAll(async () => {
    await list.close();
  });

  it('returns only the session company quotes, and never another company id', async () => {
    const cookie = await signIn(list.app, 'owner@list.test', 'a-long-enough-password');

    const response = await list.app.inject({
      method: 'GET',
      url: '/api/v1/quotes?limit=10',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(Array.isArray(body.items)).toBe(true);
    // Nothing carries the tenancy column: the client cannot learn which company a row belongs
    // to, because it already knows — there is one.
    for (const item of body.items) {
      expect(item).not.toHaveProperty('tenantId');
    }
  });
});

describe('enquiries', () => {
  it('records an enquiry and answers with a fixed acknowledgement', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/enquiries',
      payload: {
        name: 'Dana',
        email: 'dana@example.com',
        message: 'A 9 m shed for a workshop, three doors.',
        source: 'contact',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toEqual({ received: true });

    // The whole point of the route: the row is written. Nothing else in the repository inserts
    // here, so the test is the only place the table's history starts.
    const row = await ctx.db.get<{ name: string; email: string; handled: number }>(
      "SELECT name, email, handled FROM enquiries WHERE email = 'dana@example.com'",
    );
    expect(row?.name).toBe('Dana');
    expect(row?.handled).toBe(0);
  });

  it('answers a filled honeypot exactly like a real enquiry', async () => {
    const bot = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/enquiries',
      payload: {
        name: 'Bot',
        email: 'bot@example.com',
        message: 'Buy cheap sheds now, visit our site.',
        company: 'Acme Ltd',
      },
    });
    const real = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/enquiries',
      payload: { name: 'Bot', email: 'bot@example.com', message: 'A 9 m shed.' },
    });

    // A distinct answer — an error, a different status — tells the script which field gave it
    // away. The two must be indistinguishable.
    expect(bot.statusCode).toBe(201);
    expect(bot.json().data).toEqual(real.json().data);

    // And the bot's row must not be stored, or the queue is polluted by design.
    const rows = await ctx.db.all<{ message: string }>(
      "SELECT message FROM enquiries WHERE email = 'bot@example.com'",
    );
    expect(rows.map((row) => row.message)).not.toContain('Buy cheap sheds now, visit our site.');
    expect(rows).toHaveLength(1);
  });

  it('refuses a flood from one address', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/enquiries',
        payload: { name: 'Flooder', email: 'flood@example.com', message: 'One of many.' },
      });
    }
    const refused = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/enquiries',
      payload: { name: 'Flooder', email: 'flood@example.com', message: 'One too many.' },
    });

    expect(refused.statusCode).toBe(429);
    expect(refused.json().code).toBe('rate_limited');
  });
});
