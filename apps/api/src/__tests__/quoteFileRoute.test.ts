import { describe, expect, it, beforeEach } from 'vitest';
import { makeTestApp, seedCompany, signIn, type TestApp } from './helpers.js';

/**
 * Reading a legacy `.sqd` over HTTP.
 *
 * The conversion itself is unit-tested in `@sq/core` (`legacyPlan.test.ts`); what this file pins is
 * the contract a screen depends on: a readable file produces a building **and** its report, an
 * unreadable format is refused with an explanation rather than a 500, and nothing is written.
 */

/** A `.sqd` as the desktop writes a readable one: plaintext JSON with one revision. */
function readableFile(plan: Record<string, unknown> | null): Buffer {
  const revision: Record<string, unknown> = {
    RevisionId: 1,
    RevisionName: 'Original',
    QuoteNumber: 'VGS-00001',
    CompanyName: 'Vegun Sheds',
    ContractPrice: 30118.63,
    QuoteDeposite: 3011.86,
    CustomerData: { FirstName: 'TBA', Email: 'tba@example.com' },
  };
  if (plan !== null) revision.HousePlan = { Width: 6000, Height: 3000, BuildingPlan: plan };
  return Buffer.from(JSON.stringify({ SmartQuoteVersions: [revision] }), 'utf8');
}

/** A plan with two 4 000 mm bays and nothing else on it. */
function plan(): Record<string, unknown> {
  return {
    StructureType: 'GB_TH64',
    WindRegion: 'A',
    TerrainCategory: 2.5,
    ImportanceLevel: 2,
    StateCode: 'QLD',
    RoofPitch: 10,
    Width: 6000,
    Height: 3000,
    NormalBaySize: 4000,
    Bays: [
      { Index: 0, Length: 4000, Position: 0 },
      { Index: 1, Length: 4000, Position: 4000 },
      { Index: 1, Length: 0, Position: 8000 },
    ],
    EndWalls: [],
    FrontWall: { Direction: 0, SubWalls: [] },
    RearWall: { Direction: 1, SubWalls: [] },
  };
}

let ctx: TestApp;
let cookie: string;

beforeEach(async () => {
  ctx = await makeTestApp();
  const company = await seedCompany(ctx.db, {
    name: 'Acme Sheds',
    slug: 'acme-sheds',
    email: 'owner@acme.example',
    password: 'correct-horse-battery',
  });
  cookie = await signIn(ctx.app, company.code, company.username, 'correct-horse-battery');
});

/** POST a base64 payload, as the browser does. */
async function upload(bytes: Buffer) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/v1/quotes/import/sqd',
    headers: { cookie },
    payload: { data: `data:application/octet-stream;base64,${bytes.toString('base64')}` },
  });
}

describe('POST /quotes/import/sqd', () => {
  it('answers the file’s own claims and the converted building', async () => {
    const response = await upload(readableFile(plan()));
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      ok: boolean;
      data: {
        format: string;
        revisions: { contractPrice: number }[];
        building: { config: { span: number; bays: number }; carried: string[]; claimed: { contractDollars: number } } | null;
      };
    };

    expect(body.ok).toBe(true);
    expect(body.data.format).toBe('json');
    expect(body.data.revisions[0]?.contractPrice).toBe(30118.63);
    expect(body.data.building?.config.span).toBe(6000);
    expect(body.data.building?.config.bays).toBe(2);
    // The report travels with it, so a screen can show what did not carry over.
    expect(body.data.building?.carried.length).toBeGreaterThan(0);
    // And the file's price is named as the file's, never used as the building's.
    expect(body.data.building?.claimed.contractDollars).toBe(30118.63);
  });

  it('answers a null building for a file with no house plan', async () => {
    const response = await upload(readableFile(null));
    expect(response.statusCode).toBe(200);
    expect((response.json() as { data: { building: unknown } }).data.building).toBeNull();
  });

  it('refuses a .NET binary quote with an explanation, not a 500', async () => {
    const header = Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0x01, 0x00, 0x00, 0x00]);
    const response = await upload(Buffer.concat([header, Buffer.alloc(20, 0x41)]));
    // `validation_failed` answers 422 in this API, not 400 — the body is well-formed and the file in
    // it is not something this build can read.
    expect(response.statusCode).toBe(422);
    const body = response.json() as { ok: boolean; code: string; message: string };
    expect(body.code).toBe('validation_failed');
    expect(body.message).toContain('BinaryFormatter');
  });

  it('creates nothing', async () => {
    await upload(readableFile(plan()));
    const quotes = await ctx.db.all<{ count: number }>('SELECT COUNT(*) AS count FROM quotes');
    expect(Number(quotes[0]?.count)).toBe(0);
  });
});
