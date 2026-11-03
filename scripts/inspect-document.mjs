/**
 * Inspect one rendered document, to answer two questions a regex probe got wrong.
 *
 * The probe reported "margin LEAKED" and "contract price MISSING", and both were the probe's fault:
 * `\bmargin\b` matched the word inside a customer sentence, and the contract figure was formatted
 * with a comma the probe did not expect. This prints the evidence.
 *
 *   node scripts/inspect-document.mjs
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
const cookie = (signIn.headers.getSetCookie?.() ?? []).map((raw) => raw.split(';')[0]).join('; ');

const quotes = await (await fetch(`${BASE}/quotes`, { headers: { cookie } })).json();
const quote = quotes.data.items[0];
const html = await (
  await fetch(`${BASE}/quotes/${quote.id}/revisions/1/html`, { headers: { cookie } })
).text();

const plain = html
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Every context in which the word appears. */
const contexts = (word) => {
  const out = [];
  const lower = plain.toLowerCase();
  let index = lower.indexOf(word);
  while (index !== -1) {
    out.push(plain.slice(Math.max(0, index - 50), index + word.length + 50));
    index = lower.indexOf(word, index + 1);
  }
  return out;
};

console.log('=== "margin" on the page ===');
const margins = contexts('margin');
console.log(margins.length === 0 ? '  absent' : margins.map((c) => `  …${c}…`).join('\n'));

console.log('\n=== money on the page ===');
const money = [...new Set(plain.match(/\$[\d,]+\.\d\d/g) ?? [])];
console.log(' ', money.join('  '));

console.log('\n=== the price section ===');
const priceStart = plain.indexOf('Contract price');
console.log(' ', plain.slice(priceStart, priceStart + 120));

console.log('\n=== the payment section ===');
const payStart = plain.indexOf('Deposit on signing');
console.log(' ', plain.slice(payStart, payStart + 200));
