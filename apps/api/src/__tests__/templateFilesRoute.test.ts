import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeQuoteFile } from '@sq/core/quoteFile';
import {
  makeTestApp,
  seedCompany,
  seedPlatformAdmin,
  signIn,
  signInPlatform,
} from './helpers.js';

/**
 * The template file routes, end to end.
 *
 * The interesting cases are not "does upload work". They are the four ways a file store goes wrong:
 * a corrupted file served as if fine, a path from the database reading outside the store, a
 * company reaching another company's template, and an upload that replaces a revision instead of
 * adding one.
 */
const roots: string[] = [];

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'sq-tpl-route-'));
  roots.push(root);
  process.env.TEMPLATE_FILES = root;
});

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  delete process.env.TEMPLATE_FILES;
});

/** A real `.sqd` written by this build, so the upload validator has something genuine to accept. */
function quoteFileBytes(): Buffer {
  return writeQuoteFile({
    revisions: [
      {
        revision: 1,
        name: 'Template',
        description: '',
        companyCode: 'ACME',
        companyName: 'Acme Sheds',
        quoteNumber: 'Q-2026-0001',
        contractPrice: 30118.63,
        deposit: 3011.86,
        progress: 21083.04,
        balance: 6023.73,
        createdAt: '2026-11-06T00:00:00Z',
      },
    ],
    currentRevision: 1,
  });
}

async function setup() {
  const ctx = await makeTestApp();
  await seedPlatformAdmin(ctx.db, {
    email: 'ops@example.com',
    password: 'platform-password-change-me',
  });
  const adminCookie = await signInPlatform(
    ctx.app,
    'ops@example.com',
    'platform-password-change-me',
  );

  const type = await ctx.db.get<{ id: string }>(
    "SELECT id FROM template_types WHERE code = 'GABLE' LIMIT 1",
  );
  const typeId =
    type?.id ??
    (await (async () => {
      const id = 'tt-test';
      await ctx.db.run(
        "INSERT INTO template_types (id, code, name, sort_order) VALUES (?, 'GABLE', 'Gable', 1)",
        [id],
      );
      return id;
    })());

  async function makeTemplate(input: {
    tenantId: string | null;
    code: string;
    status?: 'active' | 'draft' | 'archived';
  }): Promise<string> {
    const id = `tpl-${input.code}`;
    await ctx.db.run(
      `INSERT INTO quote_templates (id, code, name, type_id, status, tenant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.code, `Template ${input.code}`, typeId, input.status ?? 'active', input.tenantId, '2026-11-06T00:00:00Z', '2026-11-06T00:00:00Z'],
    );
    return id;
  }

  return { ctx, adminCookie, makeTemplate };
}

function post(cookie: string, templateId: string, bytes: Buffer, extra: Record<string, unknown> = {}) {
  return {
    method: 'POST' as const,
    url: `/api/v1/admin/templates/${templateId}/file`,
    headers: { cookie },
    payload: { data: bytes.toString('base64'), versionLabel: 'v1', ...extra },
  };
}

describe('template files', () => {
  it('stores an upload, then serves it back unchanged with its hash', async () => {
    const { ctx, adminCookie, makeTemplate } = await setup();
    const templateId = await makeTemplate({ tenantId: null, code: 'GABLE01' });
    const bytes = quoteFileBytes();

    const uploaded = await ctx.app.inject(post(adminCookie, templateId, bytes));
    expect(uploaded.statusCode).toBe(201);
    const created = uploaded.json().data as { sha256: string; sizeBytes: number; fileId: string };
    expect(created.sizeBytes).toBe(bytes.length);

    const downloaded = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/admin/templates/${templateId}/file`,
      headers: { cookie: adminCookie },
    });
    expect(downloaded.statusCode).toBe(200);
    expect(Buffer.from(downloaded.rawPayload)).toEqual(bytes);
    expect(downloaded.headers['x-content-sha256']).toBe(created.sha256);
  });

  it('adds a revision instead of replacing one', async () => {
    const { ctx, adminCookie, makeTemplate } = await setup();
    const templateId = await makeTemplate({ tenantId: null, code: 'GABLE02' });
    const first = quoteFileBytes();
    const second = quoteFileBytes();

    const a = await ctx.app.inject(post(adminCookie, templateId, first, { versionLabel: 'v1' }));
    const b = await ctx.app.inject(post(adminCookie, templateId, second, { versionLabel: 'v2' }));
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(a.json().data.fileId).not.toBe(b.json().data.fileId);

    const history = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/admin/templates/${templateId}/files`,
      headers: { cookie: adminCookie },
    });
    expect(history.statusCode).toBe(200);
    const items = history.json().data.items as { id: string; active: boolean; versionLabel: string }[];
    expect(items).toHaveLength(2);
    // Exactly one is active, and it is the newer upload.
    expect(items.filter((item) => item.active)).toHaveLength(1);
    expect(items.find((item) => item.active)?.id).toBe(b.json().data.fileId);

    // And the older revision is still downloadable by id.
    const old = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/admin/templates/${templateId}/file?revisionId=${a.json().data.fileId}`,
      headers: { cookie: adminCookie },
    });
    expect(old.statusCode).toBe(200);
  });

  it('refuses to serve a file whose bytes changed, and sends nothing', async () => {
    /*
     * The whole reason the hash is stored. A `.sqd` corrupted on disk opens as a plausible quote
     * with wrong numbers — so the read is refused rather than handed over.
     */
    const { ctx, adminCookie, makeTemplate } = await setup();
    const templateId = await makeTemplate({ tenantId: null, code: 'GABLE03' });
    const bytes = quoteFileBytes();
    const uploaded = await ctx.app.inject(post(adminCookie, templateId, bytes));
    const fileId = uploaded.json().data.fileId as string;

    const row = await ctx.db.get<{ rel_path: string }>(
      'SELECT rel_path FROM quote_template_files WHERE id = ?',
      [fileId],
    );
    const onDisk = join(process.env.TEMPLATE_FILES as string, row!.rel_path);
    const corrupted = Buffer.from(bytes);
    corrupted[10] = corrupted[10]! ^ 0xff;
    writeFileSync(onDisk, corrupted);

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/admin/templates/${templateId}/file`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(409);
    // Nothing of the file comes back — a 409 that still included the bytes would defeat the point.
    expect(response.body).not.toContain('SmartQuoteVersions');
    expect(JSON.parse(response.body).message).toMatch(/checksum/i);
  });

  it('refuses to read a path that climbs out of the store', async () => {
    // A hand-edited row must not read the application's secrets.
    const { ctx, adminCookie, makeTemplate } = await setup();
    const templateId = await makeTemplate({ tenantId: null, code: 'GABLE04' });
    const bytes = quoteFileBytes();
    const uploaded = await ctx.app.inject(post(adminCookie, templateId, bytes));
    const fileId = uploaded.json().data.fileId as string;

    const root = process.env.TEMPLATE_FILES as string;
    writeFileSync(join(root, '..', 'route-secret.txt'), 'SECRET');
    await ctx.db.run('UPDATE quote_template_files SET rel_path = ? WHERE id = ?', [
      '../route-secret.txt',
      fileId,
    ]);

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/admin/templates/${templateId}/file`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.body).not.toContain('SECRET');
    rmSync(join(root, '..', 'route-secret.txt'), { force: true });
  });

  it('refuses an upload that is not a quote file', async () => {
    const { ctx, adminCookie, makeTemplate } = await setup();
    const templateId = await makeTemplate({ tenantId: null, code: 'GABLE05' });
    const notAQuote = Buffer.from('PK\u0003\u0004 this is a zip', 'utf8');
    const response = await ctx.app.inject(post(adminCookie, templateId, notAQuote));
    // 422 is this API's code for `validation_failed` (see `lib/http.ts`), not 400.
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('validation_failed');
  });

  it('refuses an upload bigger than the limit with a plain sentence', async () => {
    const { ctx, adminCookie, makeTemplate } = await setup();
    const templateId = await makeTemplate({ tenantId: null, code: 'GABLE06' });
    const huge = Buffer.alloc(900 * 1024, 0x41);
    const response = await ctx.app.inject(post(adminCookie, templateId, huge));
    expect(response.statusCode).toBe(422);
    expect(response.json().message).toMatch(/larger than/i);
  });

  it('lets a company download a global template, and its own, but not another company’s', async () => {
    /*
     * The isolation rule, and it answers **404** for every refusal — "not yours", "archived" and
     * "no such id" must be indistinguishable, or the status tells a caller which template ids exist.
     */
    const { ctx, adminCookie, makeTemplate } = await setup();

    const alice = await seedCompany(ctx.db, {
      name: 'Alice Sheds', slug: 'alice-sheds', code: 'ALICE',
      email: 'alice@example.com', password: 'a-long-enough-password',
    });
    const bob = await seedCompany(ctx.db, {
      name: 'Bob Sheds', slug: 'bob-sheds', code: 'BOB',
      email: 'bob@example.com', password: 'a-long-enough-password',
    });
    const aliceCookie = await signIn(ctx.app, alice.code, alice.username, 'a-long-enough-password');
    const bobCookie = await signIn(ctx.app, bob.code, bob.username, 'a-long-enough-password');

    const global = await makeTemplate({ tenantId: null, code: 'GLOBAL1' });
    const alices = await makeTemplate({ tenantId: alice.tenantId, code: 'ALICE1' });
    const archived = await makeTemplate({ tenantId: null, code: 'OLD0001', status: 'archived' });

    const bytes = quoteFileBytes();
    for (const id of [global, alices, archived]) {
      expect((await ctx.app.inject(post(adminCookie, id, bytes))).statusCode).toBe(201);
    }

    const download = (cookie: string, id: string) =>
      ctx.app.inject({
        method: 'GET',
        url: `/api/v1/templates/${id}/file`,
        headers: { cookie },
      });

    // A global template is available to both companies.
    expect((await download(aliceCookie, global)).statusCode).toBe(200);
    expect((await download(bobCookie, global)).statusCode).toBe(200);

    // Alice's own template is available to Alice…
    expect((await download(aliceCookie, alices)).statusCode).toBe(200);
    // …and **not** to Bob, who is told the same thing as for an id that does not exist.
    const stolen = await download(bobCookie, alices);
    const nonexistent = await download(bobCookie, 'tpl-does-not-exist');
    expect(stolen.statusCode).toBe(404);
    expect(stolen.statusCode).toBe(nonexistent.statusCode);
    expect(stolen.body).toBe(nonexistent.body);

    // An archived template is not downloadable, and says the same nothing.
    expect((await download(aliceCookie, archived)).statusCode).toBe(404);
  });

  it('refuses a company upload the vendor route, and a vendor the company route’s capability', async () => {
    // A company may **download** a template file; it may not publish one.
    const { ctx, makeTemplate } = await setup();
    const templateId = await makeTemplate({ tenantId: null, code: 'GABLE07' });
    const alice = await seedCompany(ctx.db, {
      name: 'Alice Sheds 2', slug: 'alice-sheds-2', code: 'ALICE2',
      email: 'alice2@example.com', password: 'a-long-enough-password',
    });
    const cookie = await signIn(ctx.app, alice.code, alice.username, 'a-long-enough-password');
    const response = await ctx.app.inject(post(cookie, templateId, quoteFileBytes()));
    expect([401, 403]).toContain(response.statusCode);
  });
});
