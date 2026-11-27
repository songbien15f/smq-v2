/**
 * The vilao gateway adapter — the OpenAI-compatible provider, kept exactly as it was.
 *
 * ## Server only, key never leaves
 *
 * The key is read from the environment (by `index.ts`, into an `AiConfig`) and used in an
 * `Authorization` header on a request this process makes. It is never put in a response, never logged,
 * and never reaches a browser: the Guest page calls our own route, which calls this.
 *
 * ## Why `fetch` and not the OpenAI SDK
 *
 * The gateway is OpenAI-compatible and this file needs exactly two endpoints. A `fetch` call cannot
 * accidentally get the key into a client bundle the way an SDK import can, and it adds no dependency
 * to a workspace that is already large. The trade is that the request and response shapes are written
 * out here instead of typed by the SDK — which is why the JSON schema is explicit.
 *
 * ## Nothing here throws on a model failure
 *
 * A refusal, a timeout or an unparseable answer comes back as `{ ok: false, reason }`. A turn that
 * cannot be answered must not take the designer down with it: the page shows "the assistant is
 * unavailable" and the rest of the page works (plan G-g).
 *
 * ## This file is the fallback, and the regression baseline
 *
 * Gemini is the primary provider. This adapter stays because it is the automatic fallback, and because
 * every behaviour here — `temperature`, the strict `response_format`, the STT `promptRejected` retry —
 * was measured against the live gateway and must not drift.
 */

import {
  REPLY_JSON_SCHEMA,
  REPAIR_JSON_SCHEMA,
  REPAIR_MAX_CHARS,
  type CompletionResult,
  type ModelReply,
  type TranscriptRepair,
} from './schemas.js';
import type { AiProvider, CallOptions, ChatMessage, SttOptions, SttOutcome, VilaoSettings } from './types.js';

/** Timeout for one completion. Twenty seconds, the same budget RFQ_PWA_SQ uses. */
const TIMEOUT_MS = 20_000;

/**
 * The repair pass waits on a visitor who has just pressed Done, so it gets a shorter budget than a
 * turn. On a timeout the route falls back to the raw transcript; nothing is lost but the polish.
 */
const REPAIR_TIMEOUT_MS = 8_000;

/** A `Uint8Array<ArrayBufferLike>` may be shared-backed; `Blob` wants an ArrayBuffer-backed view. */
function toBlob(audio: Uint8Array, mimeType: string): Blob {
  const bytes = new Uint8Array(audio.byteLength);
  bytes.set(audio);
  return new Blob([bytes], { type: mimeType });
}

/**
 * One chat completion, parsed into a `ModelReply`.
 *
 * The answer is checked structurally here rather than trusted: `response_format` is a request, not a
 * guarantee, and a gateway that answers with prose would otherwise reach the change-set parser as a
 * confusing shape error.
 */
async function completeReply(
  settings: VilaoSettings,
  messages: ChatMessage[],
  call: CallOptions,
): Promise<CompletionResult> {
  const fetchImpl = call.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature: 0.2,
        response_format: { type: 'json_schema', json_schema: REPLY_JSON_SCHEMA },
      }),
      signal: AbortSignal.timeout(call.deadlineMs ?? TIMEOUT_MS),
    });
  } catch (error) {
    const aborted = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    return {
      ok: false,
      kind: aborted ? 'timeout' : 'network',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (!response.ok) {
    // The body may name the project's billing state, so it goes to the caller's log, not to a
    // stranger's browser.
    let detail = '';
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      detail = body.error?.message?.trim() ?? '';
    } catch {
      /* Not the documented shape; the status still says something. */
    }
    return {
      ok: false,
      kind: 'http',
      status: response.status,
      reason: detail === '' ? `the model refused with ${response.status}` : `the model refused with ${response.status} — ${detail}`,
    };
  }

  let payload: { choices?: { message?: { content?: unknown } }[] };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    return { ok: false, kind: 'invalid', reason: 'the model answered with something that is not JSON' };
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    return { ok: false, kind: 'invalid', reason: 'the model answered with no content' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, kind: 'invalid', reason: 'the model answered with text that is not the reply shape' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, kind: 'invalid', reason: 'the model answered with a non-object' };
  }
  const shape = parsed as { message?: unknown; ops?: unknown; needsConfirm?: unknown };
  if (typeof shape.message !== 'string' || !Array.isArray(shape.ops) || typeof shape.needsConfirm !== 'boolean') {
    return { ok: false, kind: 'invalid', reason: 'the model answer is missing message, ops or needsConfirm' };
  }
  const reply: ModelReply = { message: shape.message, ops: shape.ops, needsConfirm: shape.needsConfirm };
  return { ok: true, reply };
}

/**
 * Steer a speech-to-text transcript into the shed domain with the language model.
 *
 * ## Why a model, not a correction table
 *
 * Mishearings are open-ended — accents, slurred words, half a sentence — and a hand-written list of
 * "role a door → roller door" rules is never long enough. The model is told the vocabulary and the
 * building in front of the visitor and asked to read the sentence the way a shed salesperson would.
 *
 * ## It suggests, it does not decide
 *
 * The answer only fills the visitor's input (and offers alternatives); the visitor still reads it and
 * presses Send, and the turn's own scope guard still runs then. So a wrong repair costs a retype, not
 * a design change. Returns `null` on any failure — the caller keeps the raw transcript.
 *
 * `system` is built by the caller (`lib/guestVoice.ts` `shedRepairPrompt`), because the vocabulary and
 * the type's limits belong with the rest of the voice wording, not with the HTTP plumbing.
 */
async function repairTranscript(
  settings: VilaoSettings,
  system: string,
  transcript: string,
  call: CallOptions,
): Promise<TranscriptRepair | null> {
  const fetchImpl = call.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'system', content: system },
          // The visitor's words are data: fenced, so a sentence that reads like an instruction stays one.
          { role: 'user', content: `Transcript:\n"""\n${transcript}\n"""` },
        ],
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: REPAIR_JSON_SCHEMA },
      }),
      signal: AbortSignal.timeout(call.deadlineMs ?? REPAIR_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') return null;

    const parsed = JSON.parse(content) as Partial<Record<keyof TranscriptRepair, unknown>>;
    if (typeof parsed.text !== 'string' || typeof parsed.onTopic !== 'boolean') return null;

    const text = parsed.text.replace(/\s+/g, ' ').trim().slice(0, REPAIR_MAX_CHARS);
    // A blank answer to a non-blank sentence is the model giving up, not a repair.
    if (text === '' && transcript.trim() !== '') return null;

    const seen = new Set([text.toLowerCase()]);
    const alternatives: string[] = [];
    for (const alt of Array.isArray(parsed.alternatives) ? parsed.alternatives : []) {
      if (typeof alt !== 'string') continue;
      const clean = alt.replace(/\s+/g, ' ').trim().slice(0, REPAIR_MAX_CHARS);
      if (clean === '' || seen.has(clean.toLowerCase())) continue;
      seen.add(clean.toLowerCase());
      alternatives.push(clean);
      if (alternatives.length === 2) break;
    }

    return {
      text,
      onTopic: parsed.onTopic,
      confidence: parsed.confidence === 'low' ? 'low' : 'high',
      alternatives,
    };
  } catch {
    return null;
  }
}

/**
 * Speech to text. Returns a value rather than throwing, because a transcript that cannot be produced
 * is "type it instead", not an error page.
 *
 * ## `opts.prompt` is the vocabulary lever — and this gateway refuses it
 *
 * `prompt` and `language` are the two fields OpenAI's `/audio/transcriptions` shares with Whisper, and
 * they are the only way a server-side call can bias a general recogniser towards shed words
 * (`lib/guestVoice.ts` builds the prompt).
 *
 * **Measured 2026-11-22: `mgr/grok-stt` answers `400 BAD_REQUEST` to `prompt` at any length** ("This
 * model rejected a generation parameter"), while `language` and `response_format` are accepted
 * (`scripts/probe-stt.mjs`, results in `docs/state/quote-tiers.md`). So a prompt is an *attempt*, not a
 * promise: on a 400 the call is retried **once** without it, and the model is remembered for the life
 * of the process so the next visit does not pay for the same refusal. The transcript, its normalisation
 * and the topic check never depended on the prompt, so the visitor still gets a usable sentence.
 *
 * (Gemini's adapter does accept the hint, which is one reason it is the primary.)
 */
const promptRejected = new Set<string>();

async function transcribe(
  settings: VilaoSettings,
  audio: Uint8Array,
  mimeType: string,
  opts: SttOptions,
  call: CallOptions,
): Promise<SttOutcome> {
  const fetchImpl = call.fetchImpl ?? fetch;
  const wantsPrompt = opts.prompt !== undefined && !promptRejected.has(settings.sttModel);

  /** One request; `withPrompt` decides whether the refused field is included. */
  const post = async (withPrompt: boolean): Promise<Response> =>
    fetchImpl(`${settings.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${settings.apiKey}` },
      body: (() => {
        const form = new FormData();
        form.append('file', toBlob(audio, mimeType), 'speech');
        form.append('model', settings.sttModel);
        if (withPrompt && opts.prompt !== undefined) form.append('prompt', opts.prompt);
        if (opts.language !== undefined) form.append('language', opts.language);
        return form;
      })(),
      signal: AbortSignal.timeout(call.deadlineMs ?? TIMEOUT_MS),
    });

  try {
    let response = await post(wantsPrompt);
    if (!response.ok && wantsPrompt && response.status === 400) {
      // A gateway that will not take `prompt` must not cost the visitor their sentence.
      promptRejected.add(settings.sttModel);
      response = await post(false);
    }
    if (!response.ok) return { ok: false, kind: 'http', status: response.status, reason: `stt refused with ${response.status}` };
    const body = (await response.json()) as { text?: unknown };
    return { ok: true, text: typeof body.text === 'string' ? body.text.trim() : '' };
  } catch (error) {
    const aborted = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    return {
      ok: false,
      kind: aborted ? 'timeout' : 'network',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The vilao adapter, as the router sees it. */
export function vilaoProvider(settings: VilaoSettings): AiProvider {
  return {
    id: 'vilao',
    configured: settings.apiKey !== '',
    completeReply: (messages, call) => completeReply(settings, messages, call),
    repairTranscript: (system, transcript, call) => repairTranscript(settings, system, transcript, call),
    transcribe: (audio, mimeType, opts, call) => transcribe(settings, audio, mimeType, opts, call),
  };
}

/** Exported for the adapter tests: the exact STT model the `promptRejected` set is keyed by. */
export const VILAO_PROMPT_REJECTED = promptRejected;
