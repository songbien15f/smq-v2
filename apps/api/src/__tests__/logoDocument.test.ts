import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { newId, now } from '@sq/db';
import type { Db } from '@sq/db';
import { DEFAULT_SHED, normaliseShedConfig } from '@sq/core/domain';
import { makeTestApp, seedCompany, signIn, testConfig, type TestApp } from './helpers';

/**
 * The platform logo through the API, without the licensed price book.
 *
 * The rest of the document tests run against the real book and are skipped where it is absent —
 * that dump is the customer's commercial asset and is not in the repository. These tests must not
 * inherit that skip: whether a logo renders has nothing to do with pricing, and a test that only
 * runs on one machine is a test that stops running the day that machine is rebuilt.
 *
 * So the revision is written **by hand** here. That is enough to pin the render decision — which
 * logo a revision uses — while the *saving* of the hash is pinned separately in
 * `documents.test.ts`, where a real save happens.
 */

const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082',
  'hex',
);

/** A second 1x1 PNG, so its sha256 differs from PNG_1PX's. */
const PNG_OTHER = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002e000015f4d6e2b0000000049454e44ae426082',
  'hex',
);

const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

let dir: string;
let ctx: TestApp;

/** A company, whose frozen `company_json` names a logo by hash. */
async function seedQuoteWithLogo(db: Db, tenantId: string, logoHash: string | null): Promise<string> {
  const quoteId = newId();
  const at = now();
  const config = normaliseShedConfig(DEFAULT_SHED);

  await db.run(
    `INSERT INTO quotes (id, tenant_id, number, status, current_revision, contract_cents, incomplete, site_json, created_at, updated_at)
     VALUES (?, ?, 'Q-LOGO-1', 'issued', 1, 100000, 0, '{}', ?, ?)`,
    [quoteId, tenantId, at, at],
  );

  await db.run(
    `INSERT INTO quote_revisions
       (id, quote_id, tenant_id, revision, name, description, config_json, bom_json, price_json, issues_json,
        customer_json, company_json, provenance_json, config_hash, result_hash, bom_hash, price_book_hash,
        override_version, settings_version, engine_version, contract_cents, total_cost_cents, total_mass_kg,
        mocked_lines, idempotency_key, created_by_email, created_at)
     VALUES (?, ?, ?, 1, 'Initial', '', ?, '[]', ?, '[]', ?, ?, '{}', 'c', 'r', 'b', 'p',
             0, 1, 1, 100000, 0, 0, 0, ?, 'owner@logo.test', ?)`,
    [
      newId(),
      quoteId,
      tenantId,
      JSON.stringify(config),
      JSON.stringify({ contractCents: 100000 }),
      JSON.stringify({ firstName: 'Jane', lastName: 'Citizen' }),
      JSON.stringify({
        version: 1,
        name: 'Logo Sheds Pty Ltd',
        abn: null,
        address: null,
        phone: null,
        email: null,
        logoText: 'LOGO SHEDS',
        logoHash,
        terms: [],
        assumptions: null,
        depositPct: 10,
        progressPct: 70,
      }),
      newId(),
      at,
    ],
  );

  return quoteId;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sq-logo-api-'));
  ctx = await makeTestApp(testConfig());
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.LOGO_FILE;
});

describe('the logo on a served document', () => {
  it('embeds the platform logo when the revision recorded it', async () => {
    const file = join(dir, 'logo.png');
    writeFileSync(file, PNG_1PX);
    process.env.LOGO_FILE = file;

    const company = await seedCompany(ctx.db, {
      name: 'Logo Sheds Pty Ltd', slug: 'logo-sheds', code: 'LOGOS', username: 'owner',
      email: 'owner@logo.test', password: 'a-long-enough-password',
    });
    const quoteId = await seedQuoteWithLogo(ctx.db, company.tenantId, sha(PNG_1PX));
    const cookie = await signIn(ctx.app, 'LOGOS', 'owner', 'a-long-enough-password');

    const html = await ctx.app.inject({
      method: 'GET', url: `/api/v1/quotes/${quoteId}/revisions/1/html`, headers: { cookie },
    });

    expect(html.statusCode).toBe(200);
    expect(html.body).toContain('data:image/png;base64,');
  });

  it('prints the text logo when the platform has no logo file', async () => {
    process.env.LOGO_FILE = join(dir, 'absent.png');

    const company = await seedCompany(ctx.db, {
      name: 'No Logo Sheds Pty Ltd', slug: 'no-logo-sheds', code: 'NOLOGOS', username: 'owner',
      email: 'owner@nologo.test', password: 'a-long-enough-password',
    });
    const quoteId = await seedQuoteWithLogo(ctx.db, company.tenantId, sha(PNG_1PX));
    const cookie = await signIn(ctx.app, 'NOLOGOS', 'owner', 'a-long-enough-password');

    const html = await ctx.app.inject({
      method: 'GET', url: `/api/v1/quotes/${quoteId}/revisions/1/html`, headers: { cookie },
    });

    expect(html.statusCode).toBe(200);
    expect(html.body).not.toContain('data:image/png;base64,');
    expect(html.body).toContain('LOGO SHEDS');
  });

  it('never shows a newer logo on an older revision', async () => {
    const company = await seedCompany(ctx.db, {
      name: 'Frozen Sheds Pty Ltd', slug: 'frozen-sheds', code: 'FROZEN', username: 'owner',
      email: 'owner@frozen.test', password: 'a-long-enough-password',
    });

    // The revision was saved while the platform showed PNG_1PX.
    process.env.LOGO_FILE = join(dir, 'first.png');
    writeFileSync(join(dir, 'first.png'), PNG_1PX);
    const quoteId = await seedQuoteWithLogo(ctx.db, company.tenantId, sha(PNG_1PX));
    const cookie = await signIn(ctx.app, 'FROZEN', 'owner', 'a-long-enough-password');

    const before = await ctx.app.inject({
      method: 'GET', url: `/api/v1/quotes/${quoteId}/revisions/1/html`, headers: { cookie },
    });
    expect(before.body).toContain('data:image/png;base64,');

    // The platform rebrands. The revision's recorded hash no longer matches any supplied image.
    writeFileSync(join(dir, 'second.png'), PNG_OTHER);
    process.env.LOGO_FILE = join(dir, 'second.png');

    const after = await ctx.app.inject({
      method: 'GET', url: `/api/v1/quotes/${quoteId}/revisions/1/html`, headers: { cookie },
    });
    expect(after.statusCode).toBe(200);
    expect(after.body).not.toContain('data:image/png;base64,');
    expect(after.body).toContain('LOGO SHEDS');
  });
});
