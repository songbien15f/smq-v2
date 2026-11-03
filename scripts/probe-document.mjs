/**
 * Manual probe: price a shed, save it, then fetch its document and a share link.
 *
 * Not a test — the tests live in `src/__tests__`. This exists so a person can see the whole chain
 * against a running server, which is what "can a customer be sent this" means.
 *
 *   node scripts/probe-document.mjs
 */

const BASE = process.env.PROBE_BASE ?? 'http://localhost:3060/api/v1';
const EMAIL = process.env.PROBE_EMAIL ?? 'owner@demo-sheds.local';
const PASSWORD = process.env.PROBE_PASSWORD ?? 'a-long-enough-password';

const { DEFAULT_SHED, normaliseShedConfig } = await import('../packages/core/dist/domain/index.js');

/**
 * Money, formatted **exactly as the renderer formats it**.
 *
 * `toFixed(2)` gives `20441.66`; the document prints `20,441.66`. Comparing those two strings is how
 * this probe reported "contract price MISSING" on a page that plainly showed it — the assertion was
 * wrong, not the document.
 */
const money = (cents) =>
  `$${(cents / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

async function signIn() {
  const response = await fetch(`${BASE}/auth/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`sign-in failed: ${response.status}`);
  const cookie = (response.headers.getSetCookie?.() ?? []).map((raw) => raw.split(';')[0]).join('; ');
  if (cookie === '') throw new Error('no session cookie');
  return cookie;
}

const config = normaliseShedConfig({
  ...DEFAULT_SHED,
  structureType: 'gable',
  span: 9000,
  length: 18000,
  height: 3000,
  bays: 3,
  windRegion: 'A',
  terrainCategory: 2.5,
  stateCode: 'QLD',
  openings: [
    { id: 'o1', type: 'roller_door', wall: 'front', u: 4500, width: 3000, height: 2400 },
    { id: 'o2', type: 'window', wall: 'left', u: 3000, width: 1200, height: 900 },
  ],
});

const pricing = {
  quoteRatePct: 0,
  depositPct: 10,
  progressPct: 70,
  deliveryCents: 0,
  engineeringCents: 0,
  extraCents: 0,
  additionsCents: 0,
  contractOverrideCents: null,
  depositOverrideCents: null,
  progressOverrideCents: null,
};

const cookie = await signIn();

const evaluated = await fetch(`${BASE}/evaluate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ config, pricing }),
});
const evaluation = await evaluated.json();
if (!evaluation.ok) {
  console.log('evaluate failed:', evaluation);
  process.exit(1);
}
console.log(`evaluate           ${evaluated.status}  contract ${money(evaluation.data.price.contractCents)}`);

const saved = await fetch(`${BASE}/quotes`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({
    evaluationId: evaluation.data.evaluationId,
    idempotencyKey: `probe-doc-${Date.now()}`,
    expectedRev: 0,
    customer: {
      firstName: 'Jane',
      lastName: 'Citizen',
      email: `doc-${Date.now()}@example.com`,
      address: '12 Test Road',
      suburb: 'Brisbane',
      state: 'QLD',
      postcode: '4000',
    },
    site: { address: '12 Test Road, Brisbane QLD 4000', deliveryAcknowledged: true },
    config,
    pricing,
  }),
});
const savedBody = await saved.json();
if (!savedBody.ok) {
  console.log('save failed:', savedBody);
  process.exit(1);
}
const { quoteId, quoteNumber, revision, revisionId } = savedBody.data;
console.log(`save               ${saved.status}  ${quoteNumber} revision ${revision}`);

// ---------------------------------------------------------------- the document
const html = await fetch(`${BASE}/quotes/${quoteId}/revisions/${revision}/html`, { headers: { cookie } });
const htmlText = await html.text();

/**
 * The assertions run against the **visible text**, not the raw HTML.
 *
 * The first version scanned the whole document and reported two false alarms: `\bmargin\b` matched
 * inside the word "Guttering" in a scope note, and the contract price was "missing" because the
 * probe looked for an unformatted number. A leak check that cries wolf is worse than none — it
 * teaches the reader to ignore it.
 */
const visible = htmlText
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

console.log(`\nGET html           ${html.status}  ${htmlText.length} bytes`);

const leaks = [
  ['material cost', /\bmaterial cost\b/i],
  ['margin', /\bmargin\b/i],
  ['kit price', /\bkit price\b/i],
  ['BOM', /\bBOM\b/],
  ['internal code', /UNIT_ASSUMED|FRAME_SECTION_ASSUMED|GIRT_PRICE_FROM_PURLIN|MOCKED_LINES/],
  ['price book', /\bprice book\b/i],
  ['demo advertising', /Demo quotation|WhatsApp|NOT FOR CONSTRUCTION/],
];
for (const [label, pattern] of leaks) {
  console.log(`  ${label.padEnd(18)} ${pattern.test(visible) ? 'LEAKED' : 'absent'}`);
}
console.log(
  `  contract price     ${visible.includes(money(evaluation.data.price.contractCents)) ? 'present' : 'MISSING'}`,
);
console.log(`  wind region        ${/Wind region/.test(visible) ? 'present' : 'MISSING'}`);

// The three stages must sum to the contract on the printed page, not only in the data.
const printed = (visible.match(/\$[\d,]+\.\d\d/g) ?? []).map((text) => Number(text.replace(/[$,]/g, '')));
const stages = printed.slice(-3);
if (stages.length === 3) {
  const sum = stages.reduce((total, value) => total + value, 0);
  const contract = evaluation.data.price.contractCents / 100;
  console.log(`  stages on the page ${sum.toFixed(2)} vs contract ${contract.toFixed(2)} — ${Math.abs(sum - contract) < 0.01 ? 'EXACT' : 'WRONG'}`);
}

const pdf = await fetch(`${BASE}/quotes/${quoteId}/revisions/${revision}/pdf`, { headers: { cookie } });
const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
console.log(`\nGET pdf            ${pdf.status}  ${pdfBytes.length} bytes  magic=${String.fromCharCode(...pdfBytes.slice(0, 5))}`);

// ---------------------------------------------------------------- the share link
const share = await fetch(`${BASE}/quotes/${quoteId}/shares`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ revisionId, expiresInDays: 30 }),
});
const shareBody = await share.json();
if (!shareBody.ok) {
  console.log('share failed:', shareBody);
  process.exit(1);
}
console.log(`\nmint share         ${share.status}  ${shareBody.data.url.slice(0, 40)}…`);

const token = shareBody.data.url.split('#')[1];

// Redeem with no cookie: the token is the credential.
const redeemed = await fetch(`${BASE}/share/redeem`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token }),
});
const shareCookie = (redeemed.headers.getSetCookie?.() ?? []).map((raw) => raw.split(';')[0]).join('; ');
console.log(`redeem             ${redeemed.status}  cookie=${shareCookie.startsWith('sq_share=') ? 'set' : 'MISSING'}`);

const shared = await fetch(`${BASE}/share/document`, { headers: { cookie: shareCookie } });
const sharedText = await shared.text();
console.log(`GET share/document ${shared.status}  ${sharedText.length} bytes  same as the operator's copy: ${sharedText === htmlText}`);

const forged = await fetch(`${BASE}/share/document`, { headers: { cookie: 'sq_share=not-a-real-share' } });
console.log(`forged cookie      ${forged.status} (must be 404)`);

const badToken = await fetch(`${BASE}/share/redeem`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token: 'x'.repeat(43) }),
});
console.log(`unknown token      ${badToken.status} (must be 404)`);
