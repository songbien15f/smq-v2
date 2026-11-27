/**
 * The Gemini adapter — `generateContent`, stateless, key in a header.
 *
 * ## Why `generateContent` and not the other two APIs
 *
 * The docs offer three ways in (research §4). `generateContent` is the one that **stores nothing** on
 * Google's side, which is the property this product needs: a guest's sentence about their shed is not
 * something to leave in a vendor's history. The `interactions` API stores by default, and the
 * OpenAI-compatible beta has no `/audio/transcriptions` at all.
 *
 * ## The differences from an OpenAI-shaped request, and why each one matters
 *
 * | OpenAI today | Gemini | Consequence of getting it wrong |
 * |---|---|---|
 * | two `system` messages | `systemInstruction.parts = [{text}, {text}]` | the design context would be sent as a user turn |
 * | `assistant` | `contents[].role = 'model'` | 400 on every turn after the first |
 * | `response_format.json_schema` | `responseMimeType` + `responseJsonSchema` | prose instead of JSON |
 * | `temperature` | **not sent at all** | deprecated; later models return 400 (research §6) |
 * | — | `thinkingConfig.thinkingLevel`, `maxOutputTokens` | unbounded thinking is billed as output |
 *
 * `topP`, `topK` and `candidateCount` are in the same deprecated family and are never sent either.
 *
 * ## A request may not end on a `model` turn
 *
 * Gemini refuses a non-empty `model` turn as the last element of `contents` (prefill is gone). The
 * assistant history is mapped to `model` turns, and the router's corrective retry appends an assistant
 * turn of its own **before** the user's correction — so the guard here drops a trailing `model` turn
 * rather than letting the request 400.
 *
 * ## Blocked is not broken
 *
 * `promptFeedback.blockReason`, or a `finishReason` of `SAFETY`, `RECITATION`, `BLOCKLIST`,
 * `PROHIBITED_CONTENT` or `SPII`, is reported as `kind: 'blocked'`. The router must **not** fall back on
 * it: the guest's sentence was the problem, and asking a second provider the same question would either
 * fail the same way or dodge a refusal the product asked for. `MAX_TOKENS` and unparseable JSON are
 * `invalid`, which *is* worth another provider.
 */

import { REPLY_JSON_SCHEMA, REPAIR_JSON_SCHEMA, REPAIR_MAX_CHARS, bareSchema, geminiSchema } from './schemas.js';
import type {
  AiProvider,
  CallOptions,
  ChatMessage,
  CompletionResult,
  GeminiSettings,
  SttOptions,
  SttOutcome,
  TranscriptRepair,
} from './types.js';

/** The turn gets room for a message plus a few operations; the repair only writes a sentence or two. */
const TURN_MAX_OUTPUT_TOKENS = 1_024;
const REPAIR_MAX_OUTPUT_TOKENS = 512;
/**
 * A one-minute utterance is roughly 150 words — about 250 tokens — so 512 leaves room without letting a
 * rambling model run on. Audio itself is input, not counted here.
 */
const STT_MAX_OUTPUT_TOKENS = 512;

/** The two finish reasons that mean "we stopped because the content, not the service". */
const BLOCKED_FINISH = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']);

/** Gemini's audio MIME list has `audio/m4a` but not `audio/mp4`, which Safari produces. */
export function geminiMimeType(mimeType: string): string {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return base === 'audio/mp4' ? 'audio/m4a' : base === '' ? 'audio/webm' : base;
}

/** The instruction that goes with an audio clip; the vocabulary hint is appended by the caller. */
export const STT_INSTRUCTION =
  'Transcribe this English (Australian) audio verbatim. Output only the words spoken, no commentary. If there is no speech, output an empty string.';

interface GeminiPart {
  text?: unknown;
  thought?: unknown;
  inlineData?: { mimeType?: unknown; data?: unknown };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: unknown }[];
  promptFeedback?: { blockReason?: unknown };
  usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; thoughtsTokenCount?: unknown };
}

/** The text of a candidate, skipping any `thought` parts and joining the rest. */
function candidateText(body: GeminiResponse): string {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
    .trim();
}

function usageOf(body: GeminiResponse): { inputTokens?: number; outputTokens?: number } {
  const meta = body.usageMetadata;
  const input = typeof meta?.promptTokenCount === 'number' ? meta.promptTokenCount : undefined;
  const out =
    typeof meta?.candidatesTokenCount === 'number'
      ? meta.candidatesTokenCount + (typeof meta.thoughtsTokenCount === 'number' ? meta.thoughtsTokenCount : 0)
      : undefined;
  return { inputTokens: input, outputTokens: out };
}

/** Google's error `status` string, e.g. `INVALID_ARGUMENT` — never the message body. */
async function errorStatus(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { status?: unknown } };
    const status = body.error?.status;
    return typeof status === 'string' ? status : '';
  } catch {
    return '';
  }
}

/**
 * One `generateContent` call.
 *
 * `contents` is built from the chat messages; a trailing `model` turn is dropped (see the file header).
 * A JSON job passes its schema; the plain-text job (STT) passes none.
 */
async function generateContent(
  settings: GeminiSettings,
  opts: {
    contents: { role: 'user' | 'model'; parts: Record<string, unknown>[] }[];
    system?: string[];
    json?: unknown;
    maxOutputTokens: number;
    deadlineMs?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<{ ok: true; body: GeminiResponse } | { ok: false; kind: 'blocked' | 'invalid' | 'http' | 'timeout' | 'network'; reason: string; status?: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const contents = [...opts.contents];
  // A request whose last turn is a non-empty `model` turn is a 400 (research §6).
  while (contents.length > 0 && contents[contents.length - 1]?.role === 'model') contents.pop();
  if (contents.length === 0) {
    return { ok: false, kind: 'invalid', reason: 'no user turn to send' };
  }

  const generationConfig: Record<string, unknown> = {
    thinkingConfig: { thinkingLevel: settings.thinking },
    maxOutputTokens: opts.maxOutputTokens,
  };
  if (opts.json !== undefined) {
    generationConfig['responseMimeType'] = 'application/json';
    generationConfig['responseJsonSchema'] = opts.json;
  }

  const request: Record<string, unknown> = { contents, generationConfig };
  if (opts.system !== undefined && opts.system.length > 0) {
    request['systemInstruction'] = { parts: opts.system.map((text) => ({ text })) };
  }

  let response: Response;
  try {
    response = await fetchImpl(`${settings.baseUrl}/models/${settings.model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': settings.apiKey },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(opts.deadlineMs ?? 14_000),
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
    const status = await errorStatus(response);
    return {
      ok: false,
      kind: 'http',
      status: response.status,
      reason: `gemini refused with ${response.status}${status === '' ? '' : ` ${status}`}`,
    };
  }

  let body: GeminiResponse;
  try {
    body = (await response.json()) as GeminiResponse;
  } catch {
    return { ok: false, kind: 'invalid', reason: 'gemini answered with something that is not JSON' };
  }

  const blockReason = body.promptFeedback?.blockReason;
  if (typeof blockReason === 'string' && blockReason !== '' && blockReason !== 'BLOCKED_REASON_UNSPECIFIED') {
    return { ok: false, kind: 'blocked', reason: 'blocked' };
  }
  const finish = body.candidates?.[0]?.finishReason;
  if (typeof finish === 'string' && BLOCKED_FINISH.has(finish)) {
    return { ok: false, kind: 'blocked', reason: 'blocked' };
  }
  if (finish === 'MAX_TOKENS') {
    return { ok: false, kind: 'invalid', reason: 'gemini ran out of output tokens' };
  }
  return { ok: true, body };
}

/** Chat roles on the wire: `assistant` is `model` here, and `system` is not a turn at all. */
function splitMessages(messages: ChatMessage[]): {
  system: string[];
  contents: { role: 'user' | 'model'; parts: Record<string, unknown>[] }[];
} {
  const system: string[] = [];
  const contents: { role: 'user' | 'model'; parts: Record<string, unknown>[] }[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      system.push(message.content);
      continue;
    }
    contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] });
  }
  return { system, contents };
}

async function completeReply(
  settings: GeminiSettings,
  messages: ChatMessage[],
  call: CallOptions,
): Promise<CompletionResult> {
  const { system, contents } = splitMessages(messages);
  const result = await generateContent(settings, {
    contents,
    system,
    json: geminiSchema(REPLY_JSON_SCHEMA),
    maxOutputTokens: TURN_MAX_OUTPUT_TOKENS,
    deadlineMs: call.deadlineMs,
    fetchImpl: call.fetchImpl,
  });
  if (!result.ok) return result;

  const usage = usageOf(result.body);
  const text = candidateText(result.body);
  if (text === '') return { ok: false, kind: 'invalid', reason: 'gemini answered with no content', usage };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, kind: 'invalid', reason: 'gemini answered with text that is not the reply shape', usage };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, kind: 'invalid', reason: 'gemini answered with a non-object', usage };
  }
  const shape = parsed as { message?: unknown; ops?: unknown; needsConfirm?: unknown };
  if (typeof shape.message !== 'string' || !Array.isArray(shape.ops) || typeof shape.needsConfirm !== 'boolean') {
    return { ok: false, kind: 'invalid', reason: 'gemini answer is missing message, ops or needsConfirm', usage };
  }
  return { ok: true, reply: { message: shape.message, ops: shape.ops, needsConfirm: shape.needsConfirm }, usage };
}

async function repairTranscript(
  settings: GeminiSettings,
  system: string,
  transcript: string,
  call: CallOptions,
): Promise<TranscriptRepair | null> {
  const result = await generateContent(settings, {
    contents: [{ role: 'user', parts: [{ text: `Transcript:\n"""\n${transcript}\n"""` }] }],
    system: [system],
    json: bareSchema(REPAIR_JSON_SCHEMA),
    maxOutputTokens: REPAIR_MAX_OUTPUT_TOKENS,
    deadlineMs: call.deadlineMs,
    fetchImpl: call.fetchImpl,
  });
  if (!result.ok) return null;

  const text = candidateText(result.body);
  if (text === '') return null;
  let parsed: Partial<Record<keyof TranscriptRepair, unknown>>;
  try {
    parsed = JSON.parse(text) as Partial<Record<keyof TranscriptRepair, unknown>>;
  } catch {
    return null;
  }
  if (typeof parsed.text !== 'string' || typeof parsed.onTopic !== 'boolean') return null;

  const clean = parsed.text.replace(/\s+/g, ' ').trim().slice(0, REPAIR_MAX_CHARS);
  // A blank answer to a non-blank sentence is the model giving up, not a repair.
  if (clean === '' && transcript.trim() !== '') return null;

  const seen = new Set([clean.toLowerCase()]);
  const alternatives: string[] = [];
  for (const alt of Array.isArray(parsed.alternatives) ? parsed.alternatives : []) {
    if (typeof alt !== 'string') continue;
    const candidate = alt.replace(/\s+/g, ' ').trim().slice(0, REPAIR_MAX_CHARS);
    if (candidate === '' || seen.has(candidate.toLowerCase())) continue;
    seen.add(candidate.toLowerCase());
    alternatives.push(candidate);
    if (alternatives.length === 2) break;
  }

  return {
    text: clean,
    onTopic: parsed.onTopic,
    confidence: parsed.confidence === 'low' ? 'low' : 'high',
    alternatives,
  };
}

/**
 * Plain text in, a transcript out.
 *
 * The vocabulary hint (`opts.prompt`, built by `lib/guestVoice.ts`) finally reaches the model — the
 * vilao STT model refused it, which is one reason Gemini is the primary.
 *
 * The model answers prose, so the text is cleaned here: trimmed, wrapped quotes removed, a `Transcript:`
 * prefix removed, and capped at `REPAIR_MAX_CHARS` (a model that rambles must not fill the input).
 */
function cleanTranscript(raw: string): string {
  /** Remove one pair of wrapping quotes, if the whole string is quoted. */
  const unquote = (value: string): string => {
    const text = value.trim();
    if (text.length < 2) return text;
    const first = text[0];
    const last = text[text.length - 1];
    const paired =
      (first === '"' && last === '"') || (first === '“' && last === '”') || (first === "'" && last === "'");
    return paired ? text.slice(1, -1).trim() : text;
  };
  // Order matters: a model may answer `"Transcript: …"` — quotes outside the prefix it was told to add.
  const text = unquote(unquote(raw).replace(/^transcript\s*:\s*/i, ''));
  return text.replace(/\s+/g, ' ').slice(0, REPAIR_MAX_CHARS);
}

async function transcribe(
  settings: GeminiSettings,
  audio: Uint8Array,
  mimeType: string,
  opts: SttOptions,
  call: CallOptions,
): Promise<SttOutcome> {
  const hint = opts.prompt === undefined ? '' : `\n${opts.prompt}`;
  const result = await generateContent(settings, {
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: geminiMimeType(mimeType), data: Buffer.from(audio).toString('base64') } },
          { text: `${STT_INSTRUCTION}${hint}` },
        ],
      },
    ],
    maxOutputTokens: STT_MAX_OUTPUT_TOKENS,
    deadlineMs: call.deadlineMs,
    fetchImpl: call.fetchImpl,
  });
  if (!result.ok) return result;

  const usage = usageOf(result.body);
  return { ok: true, text: cleanTranscript(candidateText(result.body)), usage };
}

/** The Gemini adapter, as the router sees it. */
export function geminiProvider(settings: GeminiSettings): AiProvider {
  return {
    id: 'gemini',
    configured: settings.apiKey !== '',
    completeReply: (messages, call) => completeReply(settings, messages, call),
    repairTranscript: (system, transcript, call) => repairTranscript(settings, system, transcript, call),
    transcribe: (audio, mimeType, opts, call) => transcribe(settings, audio, mimeType, opts, call),
  };
}
