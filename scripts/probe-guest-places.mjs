/**
 * One real Guest address-search session against Google Places, through the API.
 *
 * Not a test — the tests use a fake transport. This answers "does the Guest page's address search
 * actually reach Google with this key", which a fake cannot.
 *
 *   node scripts/probe-guest-places.mjs                 # API on localhost:3060
 *   PROBE_BASE=http://localhost:3060/api/v1 PROBE_ADDRESS="12 Main Road Ballarat" node scripts/probe-guest-places.mjs
 *
 * It spends real Google calls, billed to the key in the API's environment: one session, three
 * autocomplete requests (growing prefixes, as a person typing would) and one details request. It
 * also counts against this machine's per-IP limits (docs/OPERATIONS.md). Run it once by hand —
 * never in a loop, a watcher or CI.
 *
 * It talks only to the API, so it never sees the key and never prints it.
 */

const BASE = process.env.PROBE_BASE ?? 'http://localhost:3060/api/v1';
const ADDRESS = process.env.PROBE_ADDRESS ?? '1 Sturt Street Ballarat';

let calls = 0;

async function call(method, path) {
  calls += 1;
  const response = await fetch(`${BASE}/public/guest/places/${path}`, { method });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) {
    const code = body?.error?.code ?? body?.code ?? 'no-body';
    console.log(`${method.padEnd(4)} ${path.split('?')[0].padEnd(13)} ${response.status}  ${code}`);
    console.log(`\ncalls to the API   ${calls}`);
    process.exit(1);
  }
  return body.data;
}

const session = await call('POST', 'session');
console.log(`session            expires ${session.expiresAt}`);

// Three prefixes of one address — the page waits for 3 characters and debounces, so a real person
// sends a handful of these per address, not one per keystroke.
const words = ADDRESS.split(' ');
const prefixes = [words.slice(0, 2).join(' '), words.slice(0, 3).join(' '), ADDRESS];
let suggestions = [];
for (const q of prefixes) {
  const data = await call('GET', `autocomplete?q=${encodeURIComponent(q)}&s=${encodeURIComponent(session.s)}`);
  suggestions = data.suggestions;
  console.log(`autocomplete       "${q}" → ${suggestions.length} suggestion(s)`);
}

const first = suggestions[0];
if (first === undefined) {
  console.log('\nno suggestion to pick — details not called');
} else {
  console.log(`picked             ${first.primary}, ${first.secondary}`);
  const data = await call('GET', `details?id=${encodeURIComponent(first.placeId)}&s=${encodeURIComponent(session.s)}`);
  const d = data.details;
  console.log(
    d === null
      ? 'details            null (not a usable Australian site)'
      : `details            ${d.street ?? '(no street)'} | ${d.suburb} ${d.state} ${d.postcode}`,
  );
}

console.log(`\ncalls to the API   ${calls}  (1 session + ${prefixes.length} autocomplete + ${first ? 1 : 0} details)`);
