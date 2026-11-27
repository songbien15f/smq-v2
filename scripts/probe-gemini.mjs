/**
 * One real pass through Gemini — turn, STT and (optionally) repair.
 *
 * Not a test: the tests inject a fake fetch. This answers the four open items in
 * `docs/research/2026-11-27-gemini-3.5-flash-lite.md`:
 *
 *   1. does the key work at all (authorization key / restricted standard key), and is billing on;
 *   2. does `OPS_SCHEMA` (`maxItems: 10` over 15 `anyOf` branches) compile, or is it a 400;
 *   3. is `audio/mp4` (Safari) accepted when sent as `audio/m4a`;
 *   4. does the model answer the reply and repair shapes.
 *
 *   node scripts/probe-gemini.mjs [--file clip.webm|clip.m4a] [--repair]
 *
 * **At most three calls**, and only the ones asked for. It costs a fraction of a cent per call.
 *
 * ## It reads `.env` and never prints it
 *
 * The key is read from the environment, or from `.env` when the shell has not exported it, and it is
 * used in exactly one place: the `x-goog-api-key` header. Nothing here prints, logs or stores it, and no
 * request puts it in the URL. Only statuses, `finishReason`, `usageMetadata` and the model's own text
 * are printed.
 *
 * ## It is not run in CI, and not on guest data
 *
 * The turn below is a fixed sentence about a demo shed; nothing from a real visitor is sent.
 */

import { readFile } from 'node:fs/promises';

/** Read `.env` into a map. Values are never printed; nothing is exported to `process.env`. */
async function readEnvFile(path = '.env') {
  const map = new Map();
  let text = '';
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return map;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at < 0) continue;
    const name = trimmed.slice(0, at).trim();
    const value = trimmed
      .slice(at + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (!map.has(name)) map.set(name, value);
  }
  return map;
}

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? '') : '';
}
const wantsRepair = process.argv.includes('--repair');
const file = arg('file');

const dotenv = await readEnvFile();
const from = (name, fallback = '') => (process.env[name] ?? dotenv.get(name) ?? fallback).trim();

const KEY = from('GEMINI_API_KEY');
const MODEL = from('GEMINI_MODEL', 'gemini-3.5-flash-lite');
const STT_MODEL = from('GEMINI_STT_MODEL', MODEL);
const BASE = from('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const THINKING = from('GEMINI_THINKING_LEVEL', 'minimal');

if (KEY === '') {
  // Not an error this script can fix, and not evidence about the provider either.
  console.log('GEMINI_API_KEY is not set in the shell or in .env — nothing to probe. (Recorded as "not checked".)');
  process.exit(0);
}

// The **real** schemas, so this probe answers the schema-size question rather than a smaller one.
const { REPLY_JSON_SCHEMA, REPAIR_JSON_SCHEMA, geminiSchema } = await import('../apps/api/src/lib/ai/schemas.ts');

let calls = 0;

/** POST one request; returns the parsed body and the HTTP status. */
async function post(model, payload) {
  calls += 1;
  const response = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify(payload),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = { unparseable: true };
  }
  return { status: response.status, body };
}

/** Join the text parts, skipping thought parts. */
function textOf(body) {
  const parts = body?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function report(label, result) {
  const candidate = result.body?.candidates?.[0];
  console.log(`\n=== ${label}`);
  console.log('status:', result.status);
  console.log('finishReason:', candidate?.finishReason ?? '(none)');
  console.log('blockReason:', result.body?.promptFeedback?.blockReason ?? '(none)');
  console.log('usageMetadata:', JSON.stringify(result.body?.usageMetadata ?? {}));
  if (result.status !== 200) {
    // Google's error body carries the diagnosis (and no secret): the status plus `error.status`.
    console.log('error:', JSON.stringify(result.body?.error ?? result.body).slice(0, 1200));
    return;
  }
  console.log('text:', JSON.stringify(textOf(result.body)).slice(0, 1200));
}

/* ---------------------------------------------------------------- 1. the assistant turn */

const turn = await post(MODEL, {
  systemInstruction: {
    parts: [
      { text: 'You are the shed quoting assistant. Answer in Australian English, at most two sentences.' },
      { text: 'Current design: gable garage, span 6000 mm, length 6000 mm, height 3000 mm, pitch 10 degrees, 2 bays.' },
    ],
  },
  contents: [{ role: 'user', parts: [{ text: 'make it nine metres wide' }] }],
  generationConfig: {
    responseMimeType: 'application/json',
    responseJsonSchema: geminiSchema(REPLY_JSON_SCHEMA),
    thinkingConfig: { thinkingLevel: THINKING },
    maxOutputTokens: 1024,
  },
});
report('turn (real REPLY_JSON_SCHEMA)', turn);

if (turn.status === 400) {
  console.log(
    '\nA 400 here is the open item in research §5: the schema may be too large to compile with\n' +
      '`maxItems: 10` over 15 anyOf branches. The mitigation is to send `OPS_SCHEMA` without `maxItems`\n' +
      'in `gemini.ts` only; `parseOps` already caps at ten.',
  );
}

/* ---------------------------------------------------------------- 2. speech to text */

if (file !== '') {
  const bytes = await readFile(file);
  const ext = file.toLowerCase().slice(file.lastIndexOf('.'));
  // `audio/mp4` is not on Gemini's list; the container is the same as `.m4a`.
  const mimeType = ext === '.mp4' || ext === '.m4a' ? 'audio/m4a' : ext === '.webm' ? 'audio/webm' : ext === '.ogg' ? 'audio/ogg' : ext === '.wav' ? 'audio/wav' : 'audio/mpeg';
  const stt = await post(STT_MODEL, {
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: bytes.toString('base64') } },
          {
            text:
              'Transcribe this English (Australian) audio verbatim. Output only the words spoken, no commentary. If there is no speech, output an empty string.',
          },
        ],
      },
    ],
    generationConfig: { thinkingConfig: { thinkingLevel: THINKING }, maxOutputTokens: 512 },
  });
  report(`stt (${file} as ${mimeType})`, stt);
}

/* ---------------------------------------------------------------- 3. the repair pass */

if (wantsRepair) {
  const repair = await post(MODEL, {
    systemInstruction: {
      parts: [
        {
          text:
            'You repair speech-to-text transcripts about designing a steel shed. Keep the meaning; fix shed vocabulary ' +
            '(roller door, PA door, span, bays, eave height). Answer only in the JSON shape asked for.',
        },
      ],
    },
    contents: [{ role: 'user', parts: [{ text: 'Transcript:\n"""\nnine by six shed three metre wall\n"""' }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: REPAIR_JSON_SCHEMA.schema,
      thinkingConfig: { thinkingLevel: THINKING },
      maxOutputTokens: 512,
    },
  });
  report('repair (real REPAIR_JSON_SCHEMA)', repair);
}

console.log(`\n${calls} call(s) made.`);
