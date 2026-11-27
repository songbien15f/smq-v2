import { describe, expect, it } from 'vitest';
import { geminiProvider, geminiMimeType, STT_INSTRUCTION } from '../lib/ai/gemini';
import type { ChatMessage, GeminiSettings } from '../lib/ai/types';

/**
 * The Gemini adapter, asserted as a request and a response — no network.
 *
 * Every test injects `fetchImpl`, so nothing here can spend money or reach Google. The request-side
 * tests matter more than usual: four of Gemini's rules are silent when broken (`temperature` is simply
 * deprecated, a trailing `model` turn is a 400, the system prompt must not be a turn, and the schema
 * must be the bare one) and the symptom of getting them wrong is "the assistant is unavailable".
 */

const settings: GeminiSettings = {
  apiKey: 'unit-test-key',
  model: 'gemini-3.5-flash-lite',
  sttModel: 'gemini-3.5-flash-lite',
  baseUrl: 'https://gemini.invalid/v1beta',
  thinking: 'minimal',
};

interface Captured {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

/** A fake `fetch` that records the request and answers with `payload`. */
function fakeFetch(payload: unknown, status = 200): { calls: Captured[]; fetchImpl: typeof fetch } {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    const i = (init ?? {}) as RequestInit;
    calls.push({ url: String(url), init: i, body: JSON.parse(String(i.body ?? '{}')) as Record<string, unknown> });
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const replyJson = { message: 'Made it 9 metres wide.', ops: [], needsConfirm: false };

/** A `generateContent` answer carrying one text part. */
function answer(text: string, extra: Record<string, unknown> = {}) {
  return {
    candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 },
    ...extra,
  };
}

const messages: ChatMessage[] = [
  { role: 'system', content: 'You are the shed assistant.' },
  { role: 'system', content: 'Current design: 6 x 6 m.' },
  { role: 'user', content: 'make it 9 wide' },
];

describe('Gemini adapter — the outgoing request', () => {
  it('posts to generateContent with the key in the header, never in the URL', async () => {
    const fake = fakeFetch(answer(JSON.stringify(replyJson)));
    const result = await geminiProvider(settings).completeReply(messages, { fetchImpl: fake.fetchImpl });

    expect(result.ok).toBe(true);
    const [call] = fake.calls;
    expect(call?.url).toBe('https://gemini.invalid/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(call?.url).not.toContain('unit-test-key');
    expect((call?.init.headers as Record<string, string>)['x-goog-api-key']).toBe('unit-test-key');
  });

  it('sends the system messages as systemInstruction, not as turns', async () => {
    const fake = fakeFetch(answer(JSON.stringify(replyJson)));
    await geminiProvider(settings).completeReply(messages, { fetchImpl: fake.fetchImpl });

    const body = fake.calls[0]?.body;
    expect(body?.['systemInstruction']).toEqual({
      parts: [{ text: 'You are the shed assistant.' }, { text: 'Current design: 6 x 6 m.' }],
    });
    expect((body?.['contents'] as { role: string }[]).map((c) => c.role)).toEqual(['user']);
  });

  it('maps assistant turns to `model`, and never ends on a `model` turn', async () => {
    const fake = fakeFetch(answer(JSON.stringify(replyJson)));
    const withHistory: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: '{"message":"ok","ops":[],"needsConfirm":false}' },
    ];
    await geminiProvider(settings).completeReply(withHistory, { fetchImpl: fake.fetchImpl });

    // The trailing assistant turn is dropped rather than sent: Gemini answers a trailing `model` with 400.
    const contents = fake.calls[0]?.body['contents'] as { role: string }[];
    expect(contents.map((c) => c.role)).toEqual(['user']);
  });

  it('keeps an assistant turn that sits mid-conversation', async () => {
    const fake = fakeFetch(answer(JSON.stringify(replyJson)));
    await geminiProvider(settings).completeReply(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'six wide' },
        { role: 'assistant', content: 'done' },
        { role: 'user', content: 'and nine wide' },
      ],
      { fetchImpl: fake.fetchImpl },
    );
    const contents = fake.calls[0]?.body['contents'] as { role: string }[];
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
  });

  it('asks for JSON with the bare schema and the thinking level, and sends no sampling knobs', async () => {
    const fake = fakeFetch(answer(JSON.stringify(replyJson)));
    await geminiProvider(settings).completeReply(messages, { fetchImpl: fake.fetchImpl });

    const config = fake.calls[0]?.body['generationConfig'] as Record<string, unknown>;
    expect(config['responseMimeType']).toBe('application/json');
    expect(config['responseJsonSchema']).toBeDefined();
    // The bare schema: OpenAI's wrapper keys must not travel.
    expect((config['responseJsonSchema'] as Record<string, unknown>)['name']).toBeUndefined();
    expect((config['responseJsonSchema'] as Record<string, unknown>)['strict']).toBeUndefined();
    expect(config['thinkingConfig']).toEqual({ thinkingLevel: 'minimal' });
    expect(typeof config['maxOutputTokens']).toBe('number');

    // Deprecated for 3.5 Flash-Lite and later: sending any of them is a 400 waiting to happen.
    for (const knob of ['temperature', 'topP', 'topK', 'candidateCount']) {
      expect(config[knob], knob).toBeUndefined();
      expect(fake.calls[0]?.body[knob], knob).toBeUndefined();
    }
  });
});

describe('Gemini adapter — parsing an answer', () => {
  it('joins several text parts', async () => {
    const fake = fakeFetch({
      candidates: [{ content: { parts: [{ text: '{"message":"Made it ' }, { text: '9 metres wide.","ops":[],"needsConfirm":false}' }] } }],
    });
    const result = await geminiProvider(settings).completeReply(messages, { fetchImpl: fake.fetchImpl });
    expect(result.ok && result.reply.message).toBe('Made it 9 metres wide.');
  });

  it('skips thought parts', async () => {
    const fake = fakeFetch({
      candidates: [
        {
          content: {
            parts: [
              { text: 'thinking about the span…', thought: true },
              { text: JSON.stringify(replyJson) },
            ],
          },
        },
      ],
    });
    const result = await geminiProvider(settings).completeReply(messages, { fetchImpl: fake.fetchImpl });
    expect(result.ok).toBe(true);
  });

  it('reports a SAFETY finish as blocked, not as a failure to retry', async () => {
    const fake = fakeFetch({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] });
    const result = await geminiProvider(settings).completeReply(messages, { fetchImpl: fake.fetchImpl });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.kind).toBe('blocked');
  });

  it('reports a promptFeedback blockReason as blocked', async () => {
    const fake = fakeFetch({ promptFeedback: { blockReason: 'OTHER' }, candidates: [] });
    const result = await geminiProvider(settings).completeReply(messages, { fetchImpl: fake.fetchImpl });
    expect(!result.ok && result.kind).toBe('blocked');
  });

  it('reports MAX_TOKENS as invalid', async () => {
    const fake = fakeFetch({ candidates: [{ content: { parts: [{ text: '{"message":' }] }, finishReason: 'MAX_TOKENS' }] });
    const result = await geminiProvider(settings).completeReply(messages, { fetchImpl: fake.fetchImpl });
    expect(!result.ok && result.kind).toBe('invalid');
  });

  it('reports JSON that is not the reply shape as invalid', async () => {
    const fake = fakeFetch(answer('Sure! I made it nine metres wide.'));
    const result = await geminiProvider(settings).completeReply(messages, { fetchImpl: fake.fetchImpl });
    expect(!result.ok && result.kind).toBe('invalid');
  });

  it('carries the HTTP status of a refusal, and never the body', async () => {
    const fake = fakeFetch({ error: { code: 403, message: 'API key not valid. Please pass a valid API key.', status: 'PERMISSION_DENIED' } }, 403);
    const result = await geminiProvider(settings).completeReply(messages, { fetchImpl: fake.fetchImpl });
    expect(!result.ok && result.status).toBe(403);
    expect(!result.ok && result.reason).toContain('PERMISSION_DENIED');
    expect(!result.ok && result.reason).not.toContain('Please pass a valid API key');
  });
});

describe('Gemini adapter — speech to text', () => {
  it('sends the audio inline, maps audio/mp4 to audio/m4a, and includes the vocabulary hint', async () => {
    const fake = fakeFetch(answer('add a roller door on the front'));
    const audio = new Uint8Array([1, 2, 3]);
    const outcome = await geminiProvider(settings).transcribe(
      audio,
      'audio/mp4',
      { prompt: 'Vocabulary: roller door, PA door, span.', language: 'en' },
      { fetchImpl: fake.fetchImpl },
    );

    expect(outcome.ok && outcome.text).toBe('add a roller door on the front');
    const parts = (fake.calls[0]?.body['contents'] as { parts: Record<string, unknown>[] }[])[0]?.parts ?? [];
    expect(parts[0]?.['inlineData']).toEqual({
      mimeType: 'audio/m4a',
      data: Buffer.from(audio).toString('base64'),
    });
    const instruction = parts[1]?.['text'] as string;
    expect(instruction.startsWith(STT_INSTRUCTION)).toBe(true);
    expect(instruction).toContain('Vocabulary: roller door, PA door, span.');
  });

  it('passes the other MIME types through untouched', () => {
    expect(geminiMimeType('audio/webm')).toBe('audio/webm');
    expect(geminiMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(geminiMimeType('audio/ogg')).toBe('audio/ogg');
    expect(geminiMimeType('audio/mpeg')).toBe('audio/mpeg');
    expect(geminiMimeType('audio/wav')).toBe('audio/wav');
  });

  it('cleans the prose a transcript model returns', async () => {
    // Quotes outside the prefix, which is what a chatty model does: `"Transcript: …"`.
    const fake = fakeFetch(answer('  "Transcript: add a door"  '));
    const outcome = await geminiProvider(settings).transcribe(new Uint8Array([1]), 'audio/webm', {}, { fetchImpl: fake.fetchImpl });
    expect(outcome.ok && outcome.text).toBe('add a door');
  });

  it('reports an empty answer as an empty transcript, which the router judges by clip length', async () => {
    const fake = fakeFetch(answer('   '));
    const outcome = await geminiProvider(settings).transcribe(new Uint8Array([1]), 'audio/webm', {}, { fetchImpl: fake.fetchImpl });
    expect(outcome).toMatchObject({ ok: true, text: '' });
  });
});

describe('geminiSchema', () => {
  it('drops maxItems on the ops list (a live 400 on 2026-11-27) and keeps every other bound', async () => {
    const { geminiSchema, REPLY_JSON_SCHEMA, REPAIR_JSON_SCHEMA } = await import('../lib/ai/schemas');
    const reply = geminiSchema(REPLY_JSON_SCHEMA) as { properties: { ops: Record<string, unknown> } };
    expect(reply.properties.ops['maxItems']).toBeUndefined();
    expect(reply.properties.ops['items']).toBeDefined();
    // The OpenAI copy is untouched: vilao still gets the bound.
    expect(JSON.stringify(REPLY_JSON_SCHEMA)).toContain('"maxItems":10');
    // A simple string array compiles on Gemini and keeps its bound.
    const repair = geminiSchema(REPAIR_JSON_SCHEMA) as { properties: { alternatives: Record<string, unknown> } };
    expect(repair.properties.alternatives['maxItems']).toBe(2);
  });
});
