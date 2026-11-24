/**
 * One real transcription through the gateway, with and without the shed `prompt`.
 *
 * Not a test — the tests use a fake fetch. This answers the question the plan leaves open: **does the
 * gateway honour `prompt` and `language`?** OpenAI's `/audio/transcriptions` does; a compatible gateway
 * may ignore them, and "ignored" and "unsupported" look the same from here unless the two transcripts
 * are compared on the same clip.
 *
 *   node scripts/probe-stt.mjs path/to/clip.webm
 *
 * It reads `VILAO_*` from the environment **inside the API process's own settings shape** and prints
 * only the transcripts and the response status. It never prints the key. Run it by hand, once.
 */

const BASE = (process.env.VILAO_BASE_URL ?? 'https://api.vilao.ai/v1').trim().replace(/\/$/, '');
const KEY = (process.env.VILAO_API_KEY ?? '').trim();
const MODEL = (process.env.VILAO_STT_MODEL ?? 'mgr/grok-stt').trim();

const file = process.argv[2];
if (file === undefined) {
  console.error('usage: node scripts/probe-stt.mjs <clip.webm|clip.ogg|clip.mp4>');
  process.exit(2);
}
if (KEY === '') {
  // Not an error the script can fix, and not evidence about the gateway either.
  console.log('VILAO_API_KEY is not set in this shell — nothing to probe. (Recorded as "not checked".)');
  process.exit(0);
}

const { readFile } = await import('node:fs/promises');
const { extname, basename } = await import('node:path');

const MIME = {
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.mp4': 'audio/mp4',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

const ext = extname(file).toLowerCase();
const mimeType = MIME[ext];
if (mimeType === undefined) {
  console.error(`unknown extension "${ext}" — use one of ${Object.keys(MIME).join(', ')}`);
  process.exit(2);
}

const bytes = await readFile(file);
if (bytes.byteLength > 1024 * 1024) {
  console.error(`clip is ${bytes.byteLength} bytes; the API cap is 1048576`);
  process.exit(2);
}

const PROMPT =
  'Shed design request: make it 9 metres wide, add a 3 metre roller door on the front wall, Colorbond Monument roof. ' +
  'Words used: shed, garage, carport, span, width, length, height, bays, metres, roof, gable, skillion, ' +
  'pitch, slab, footing, knee brace, cladding, wall, front, back, left, right, roller door, PA door, ' +
  'sliding door, window, colour, Colorbond.';

async function once(label, withOpts) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeType }), basename(file));
  form.append('model', MODEL);
  if (withOpts) {
    form.append('prompt', PROMPT.slice(0, 900));
    form.append('language', 'en');
  }

  const started = Date.now();
  let response;
  try {
    response = await fetch(`${BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    console.log(`${label.padEnd(12)} request failed: ${error?.name ?? 'Error'}`);
    return null;
  }
  const ms = Date.now() - started;
  const text = await response.text();
  let transcript = '';
  try {
    const body = JSON.parse(text);
    transcript = typeof body?.text === 'string' ? body.text : '';
  } catch {
    /* not JSON: printed below as a shape note, never the body itself (it can echo the prompt) */
  }
  console.log(
    `${label.padEnd(12)} ${response.status} ${String(ms).padStart(5)} ms  text=${JSON.stringify(transcript)}` +
      (response.ok ? '' : `  (${text.length} bytes of non-transcript body, not printed)`),
  );
  return response.ok ? transcript : null;
}

console.log(`model ${MODEL} · file ${basename(file)} · ${bytes.byteLength} bytes · ${mimeType}`);
const plain = await once('no prompt', false);
const hinted = await once('with prompt', true);

if (plain !== null && hinted !== null) {
  const verdict = plain === hinted ? 'identical (prompt may be ignored)' : 'differs (prompt reached the model)';
  console.log(`\nresult: ${verdict}`);
}
