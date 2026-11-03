/**
 * Send a real quote email through the configured relay.
 *
 * Not a test — the tests inject a fake transport so they need no mail server. This exists because
 * "can a customer actually receive this" is not a question a fake transport can answer.
 *
 *   node scripts/probe-send.mjs                       # sends to ENQUIRY_TO
 *   PROBE_TO=someone@example.com node scripts/probe-send.mjs
 *
 * It sends to the operator's own inbox by default, on purpose: a probe that mails a stranger is a
 * probe nobody should run twice.
 */

const BASE = process.env.PROBE_BASE ?? 'http://localhost:3060/api/v1';
const TO = process.env.PROBE_TO ?? 'hello@martechsky.com';

const signIn = await fetch(`${BASE}/auth/sign-in`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: process.env.PROBE_EMAIL ?? 'owner@demo-sheds.local',
    password: process.env.PROBE_PASSWORD ?? 'a-long-enough-password',
  }),
});
if (!signIn.ok) throw new Error(`sign-in failed: ${signIn.status}`);
const cookie = (signIn.headers.getSetCookie?.() ?? []).map((raw) => raw.split(';')[0]).join('; ');

const quotes = await (await fetch(`${BASE}/quotes`, { headers: { cookie } })).json();
const quote = quotes.data.items[0];
if (quote === undefined) throw new Error('no quote to send — run probe-document.mjs first');

console.log(`quote              ${quote.number}  status ${quote.status}`);

const revisions = await (
  await fetch(`${BASE}/quotes/${quote.id}/revisions`, { headers: { cookie } })
).json();
const revisionId = revisions.data.items[0].id;

// What the send would attach, before it is sent: the operator should be able to see that the PDF
// exists, because a relay failure and a render failure look the same from the outside.
const pdf = await fetch(`${BASE}/quotes/${quote.id}/revisions/1/pdf`, { headers: { cookie } });
const bytes = new Uint8Array(await pdf.arrayBuffer());
console.log(`attachment         ${pdf.status}  ${bytes.length} bytes  ${String.fromCharCode(...bytes.slice(0, 5))}`);

const sent = await fetch(`${BASE}/quotes/${quote.id}/send`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({
    revisionId,
    to: TO,
    subject: `Your quotation ${quote.number}`,
    body: [
      'Hello,',
      '',
      'Please find your quotation attached.',
      '',
      'The price and the payment stages are also on the document.',
      '',
      'Kind regards,',
      'Demo Sheds Pty Ltd',
    ].join('\n'),
    acknowledgeIndicative: true,
    idempotencyKey: `probe-send-${Date.now()}`,
  }),
});

const result = await sent.json();
console.log(`\nPOST /send         ${sent.status}`);
console.log(`  state            ${result.ok ? result.data.state : '(refused)'}`);
if (result.ok) {
  console.log(`  messageId        ${result.data.messageId ?? '(none)'}`);
  if (result.data.error !== undefined) console.log(`  error            ${result.data.error}`);
} else {
  console.log(`  code             ${result.code}`);
  console.log(`  message          ${result.message}`);
}

// The status must have moved, and the queue must carry the attempt.
const after = await (await fetch(`${BASE}/quotes/${quote.id}`, { headers: { cookie } })).json();
console.log(`\nquote status now   ${after.data.status}  (a send moves draft → issued)`);

const sends = await (await fetch(`${BASE}/quotes/${quote.id}/sends`, { headers: { cookie } })).json();
for (const job of sends.data.items.slice(0, 3)) {
  console.log(`  job              ${job.state}  attempts ${job.attempts}  to ${job.to}${job.lastError === null ? '' : `  error: ${job.lastError}`}`);
}

// The same key twice must be one email.
const again = await fetch(`${BASE}/quotes/${quote.id}/send`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({
    revisionId,
    to: TO,
    subject: `Your quotation ${quote.number}`,
    body: 'repeat',
    acknowledgeIndicative: true,
    idempotencyKey: `probe-send-${Date.now()}`,
  }),
});
console.log(`\nre-send new key    ${again.status} (a new intent is a new send)`);
