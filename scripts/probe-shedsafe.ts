/**
 * Probe: what does ShedSafe actually say?
 *
 * The route maps any `ShedSafeError` to `not_configured`, which reported a **400 from ShedSafe** as
 * "credentials missing" — the credentials were fine. This script talks to ShedSafe directly so the
 * real body is visible, then prints each call's status and payload.
 *
 * Throwaway diagnostic. Run with:
 *   node --env-file-if-exists=.env --import tsx scripts/probe-shedsafe.ts
 */

import { createShedSafeTransport, shedSafeConfigFromEnv } from '../apps/api/src/lib/shedsafe.js';

async function main(): Promise<void> {
  const config = shedSafeConfigFromEnv();
  if (config === null) {
    console.log('ShedSafe is not configured in .env');
    return;
  }

  console.log(`base ${config.baseUrl}`);
  console.log(`user ${config.username} (password ${config.password.length} chars)\n`);

  // 1. Authenticate, and show the raw answer.
  const auth = await fetch(`${config.baseUrl}/authenticate`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: config.username, password: config.password }).toString(),
  });
  const authText = await auth.text();
  console.log(`authenticate -> ${auth.status}`);
  console.log(`  body ${authText.slice(0, 300)}\n`);

  if (!auth.ok) return;

  const token = (JSON.parse(authText) as { access_token?: string }).access_token ?? '';

  // 2. Read an unknown building: proves the bearer is accepted without creating anything.
  const read = await fetch(`${config.baseUrl}/building/get/00000000-0000-0000-0000-000000000000`, {
    headers: { authorization: `Bearer ${token}` },
  });
  console.log(`building/get (unknown id) -> ${read.status}`);
  console.log(`  body ${(await read.text()).slice(0, 300)}\n`);

  // 3. Create, and capture the validation body the route hid.
  const create = await fetch(`${config.baseUrl}/building/create`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      Reference: `probe-${Date.now()}`,
      SiteAddress: {
        AddressLine1: '123 Main St',
        SuburbName: 'Brisbane',
        State: 'QLD',
        Country: 'AU',
        Postcode: '4000',
      },
      Client: { FirstName: 'Probe', LastName: 'Test', Email: 'test@example.com' },
      ImportanceLevel: 1,
      Height: 4.2,
      Span: 12,
      Length: 24,
    }),
  });
  console.log(`building/create -> ${create.status}`);
  console.log(`  body ${(await create.text()).slice(0, 800)}\n`);

  // 4. A transport round-trip, to confirm the wrapper behaves as the route sees it.
  const transport = createShedSafeTransport(config);
  try {
    const pinned = await transport.pin({
      reference: `probe-${Date.now()}`,
      siteAddress: { addressLine1: '123 Main St', suburb: 'Brisbane', state: 'QLD', postcode: '4000' },
      client: { firstName: 'Probe', lastName: 'Test', email: 'test@example.com' },
      height: 4.2,
      span: 12,
      length: 24,
      importanceLevel: 1,
    });
    console.log(`transport.pin -> ok, buildingId ${pinned.buildingId}`);
    console.log(`  siteLink ${pinned.siteLink.slice(0, 120)}`);
  } catch (error) {
    console.log(`transport.pin -> threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

main().catch((error: unknown) => {
  console.error('probe failed:', error);
  process.exitCode = 1;
});
