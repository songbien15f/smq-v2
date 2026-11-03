/**
 * Verify the slice through the API: BOM download, settings versioning, team, and a send.
 *
 * The browser check covers layout and the dialogs; this covers the bytes — an .xlsx that opens, a
 * settings version that increments, a status that moves. Both are needed, and neither substitutes
 * for the other.
 *
 *   node scripts/probe-slice-a.mjs
 */

const BASE = process.env.PROBE_BASE ?? 'http://localhost:3060/api/v1';

const signIn = await fetch(`${BASE}/auth/sign-in`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: process.env.PROBE_EMAIL ?? 'owner@demo-sheds.local',
    password: process.env.PROBE_PASSWORD ?? 'a-long-enough-password',
  }),
});
if (!signIn.ok) throw new Error(`sign-in failed: ${signIn.status} — release seats first`);
const cookie = (signIn.headers.getSetCookie?.() ?? []).map((raw) => raw.split(';')[0]).join('; ');
const auth = { cookie };

const quotes = await (await fetch(`${BASE}/quotes`, { headers: auth })).json();
const quote = quotes.data.items[0];
if (quote === undefined) throw new Error('no quote — run probe-document.mjs first');
console.log(`quote            ${quote.number}  status ${quote.status}`);

/* ------------------------------------------------------------------ BOM */
const bom = await fetch(`${BASE}/quotes/${quote.id}/revisions/1/bom`, { headers: auth });
const bomBytes = new Uint8Array(await bom.arrayBuffer());
// An .xlsx is a zip: the first two bytes are 'PK'.
const magic = String.fromCharCode(bomBytes[0], bomBytes[1]);
console.log(`\nGET bom          ${bom.status}  ${bomBytes.length} bytes  magic ${magic}`);
console.log(`  content-type   ${bom.headers.get('content-type')}`);
console.log(`  filename       ${(bom.headers.get('content-disposition') ?? '').split('filename=')[1] ?? '(none)'}`);

/* -------------------------------------------------------------- settings */
const before = await (await fetch(`${BASE}/settings`, { headers: auth })).json();
console.log(`\nGET settings     version ${before.data.version}  name "${before.data.name}"  terms ${before.data.terms.length}`);
console.log(`  address        ${before.data.address ?? '(not set)'}`);
console.log(`  reply-to       ${before.data.email ?? '(not set)'}`);

const patched = await fetch(`${BASE}/settings`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({
    abn: '12 345 678 901',
    address: '1 Company Street, Brisbane QLD 4000',
    phone: '(07) 3000 0000',
    email: 'quotes@demo-sheds.test',
    logoText: 'DEMO SHEDS',
    terms: [
      'A deposit is required on signing.',
      'Delivery is to the nearest accessible point.',
    ],
    assumptions: [
      { title: 'Frame', body: 'Priced from the supplier current book for this span.' },
      { title: 'Fixings', body: 'Bolts, brackets and screws are allowed for the whole building.' },
    ],
  }),
});
const after = await patched.json();
console.log(`\nPATCH settings   ${patched.status}  version ${after.ok ? after.data.version : '(failed)'}  terms ${after.ok ? after.data.terms.length : 0}`);
if (!after.ok) console.log(`  message        ${after.message}`);

/* ----------------------------------------------------------------- team */
const team = await (await fetch(`${BASE}/team`, { headers: auth })).json();
console.log(`\nGET team         ${team.ok ? team.data.items.length : '(failed)'} member(s)`);
for (const member of team.ok ? team.data.items : []) {
  console.log(`  ${member.email.padEnd(32)} ${member.role.padEnd(16)} ${member.active ? 'holding a seat' : 'signed out'}`);
}

/* -------------------------------------------------------- status moves */
// A move out of `issued` that a person may make.
const current = quote.status;
if (current === 'issued' || current === 'draft') {
  const move = await fetch(`${BASE}/quotes/${quote.id}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ to: 'accepted', note: 'confirmed by phone' }),
  });
  const body = await move.json();
  console.log(`\nPATCH status     ${move.status}  ${current} → accepted: ${body.ok ? 'accepted' : body.message}`);

  // And a move that must be refused: a terminal state is not re-opened.
  const illegal = await fetch(`${BASE}/quotes/${quote.id}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ to: 'issued' }),
  });
  const illegalBody = await illegal.json();
  console.log(`  re-open        ${illegal.status} — ${illegalBody.ok ? 'ALLOWED (wrong)' : illegalBody.message}`);
}

/* ------------------------------------------------- the revision is frozen */
const revisions = await (await fetch(`${BASE}/quotes/${quote.id}/revisions`, { headers: auth })).json();
console.log(`\nrevisions        ${revisions.data.items.length}`);
console.log('  the frozen company block carries what the document prints:');
const frozen = revisions.data.items[0];
console.log(`    engine ${frozen.engine_version}  book ${String(frozen.price_book_hash).slice(0, 12)}  contract ${frozen.contract_cents}`);
