/**
 * A manual probe for the evaluation path, run against a live stack.
 *
 * Not a test — the tests live in `src/__tests__`. This exists so a person can price a shed against
 * a running server and see the numbers, which is what "is it working" actually means for a quoting
 * product. Delete it and the product loses nothing but a convenience.
 *
 *   node scripts/probe-pricing.mjs
 */

const BASE = process.env.PROBE_BASE ?? 'http://localhost:3101';
const EMAIL = process.env.PROBE_EMAIL ?? 'owner@demo-sheds.local';
const PASSWORD = process.env.PROBE_PASSWORD ?? 'a-long-enough-password';

/** Sign in, keeping the cookie the bridge sets. */
async function signIn() {
  const response = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`sign-in failed: ${response.status}`);

  const cookie = (response.headers.getSetCookie?.() ?? [])
    .map((raw) => raw.split(';')[0])
    .join('; ');
  if (cookie === '') throw new Error('no session cookie was set');
  return cookie;
}

/** A shed, as the editor posts it: normalised by the domain before it is sent. */
async function aBuilding() {
  const { DEFAULT_SHED, normaliseShedConfig } = await import('../packages/core/dist/domain/index.js');
  return normaliseShedConfig({
    ...DEFAULT_SHED,
    structureType: 'gable',
    span: 9000,
    length: 18000,
    height: 3000,
    bays: 3,
    windRegion: 'A',
    terrainCategory: 2.5,
    stateCode: 'QLD',
    openings: [{ id: 'o1', type: 'roller_door', wall: 'front', u: 4500, width: 3000, height: 2400 }],
  });
}

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

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

const cookie = await signIn();
const config = await aBuilding();

const evaluated = await fetch(`${BASE}/api/sq/evaluate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ config, pricing }),
});

console.log(`evaluate  ${evaluated.status}`);
const body = await evaluated.json();
if (!body.ok) {
  console.log(JSON.stringify(body, null, 2));
  process.exit(1);
}

const { price, lines, issues, evaluationId, status } = body.data;
console.log(`  status            ${status}`);
console.log(`  building cost     ${money(price.buildingCostCents)}`);
console.log(`  total BOM cost    ${money(price.totalCostCents)}`);
console.log(`  kit               ${money(price.kitCents)}`);
console.log(`  contract (incl)   ${money(price.contractCents)}`);
console.log(`  deposit           ${money(price.depositCents)}`);
console.log(`  progress          ${money(price.progressCents)}`);
console.log(`  balance           ${money(price.balanceCents)}`);
console.log(`  stages sum        ${price.depositCents + price.progressCents + price.balanceCents === price.contractCents ? 'equal to the contract' : 'WRONG'}`);
console.log(`  lines             ${lines.length}, unpriced ${lines.filter((l) => l.mocked).length}`);
console.log(`  issues            ${issues.map((issue) => issue.code).join(', ') || 'none'}`);
console.log(`  evaluationId      ${evaluationId.slice(0, 8)}…`);

// A negotiated total, which is the whole point of the Cost step.
const negotiated = price.contractCents - 250_000;
const overridden = await fetch(`${BASE}/api/sq/evaluate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ config, pricing: { ...pricing, contractOverrideCents: negotiated } }),
});
const overriddenBody = await overridden.json();
const negotiatedPrice = overriddenBody.data.price;
console.log(`\nnegotiated to ${money(negotiated)}`);
console.log(`  contract          ${money(negotiatedPrice.contractCents)}`);
console.log(`  deposit           ${money(negotiatedPrice.depositCents)} (re-derived)`);
console.log(`  stages sum        ${negotiatedPrice.depositCents + negotiatedPrice.progressCents + negotiatedPrice.balanceCents === negotiated ? 'equal to the contract' : 'WRONG'}`);
console.log(`  building cost     ${money(negotiatedPrice.buildingCostCents)} (unchanged)`);
console.log(`  overridden        ${JSON.stringify(negotiatedPrice.overridden)}`);

const saved = await fetch(`${BASE}/api/sq/quotes`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({
    evaluationId: overriddenBody.data.evaluationId,
    idempotencyKey: `probe-${Date.now()}`,
    expectedRev: 0,
    customer: { firstName: 'Probe', lastName: 'Customer', email: `probe-${Date.now()}@example.com`, address: '1 Probe Street' },
    site: { address: '1 Probe Street', deliveryAcknowledged: true },
    config,
    pricing: { ...pricing, contractOverrideCents: negotiated },
  }),
});

console.log(`\nsave      ${saved.status}`);
const savedBody = await saved.json();
if (!savedBody.ok) {
  console.log(JSON.stringify(savedBody, null, 2));
  process.exit(1);
}
console.log(`  quote             ${savedBody.data.quoteNumber} revision ${savedBody.data.revision}`);
console.log(`  contract          ${money(savedBody.data.contractCents)} (the figure that was on screen)`);
console.log(`  replayed          ${savedBody.data.replayed}`);
