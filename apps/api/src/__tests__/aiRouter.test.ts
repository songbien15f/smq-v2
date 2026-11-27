import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeReply, repairTranscript, shouldFallback, transcribe, type AiConfig } from '../lib/ai/index';

/**
 * The router: primary, then the fallback, under one budget.
 *
 * Every test drives the **real** adapters through a fake `fetch` that answers by host, so the request
 * each provider would send is exercised too — and nothing leaves the machine. No key here is real.
 */

const reply = (message: string) => ({ message, ops: [], needsConfirm: false });

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    primary: 'gemini',
    fallback: 'vilao',
    gemini: {
      apiKey: 'gemini-unit-key',
      model: 'gemini-test',
      sttModel: 'gemini-test',
      baseUrl: 'https://gemini.invalid/v1beta',
      thinking: 'minimal',
    },
    vilao: {
      apiKey: 'vilao-unit-key',
      model: 'vilao-test',
      sttModel: 'vilao-stt-test',
      baseUrl: 'https://vilao.invalid/v1',
    },
    ...overrides,
  };
}

const messages = [
  { role: 'system' as const, content: 'You are the shed assistant.' },
  { role: 'user' as const, content: 'make it nine wide' },
];

/** A Gemini answer carrying `text` as its single part. */
function geminiAnswer(text: string, extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 },
      ...extra,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** A vilao (OpenAI-shaped) answer carrying `text` as the message content. */
function vilaoAnswer(text: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fake fetch that answers by hostname and records who was called, in order. */
function routed(handlers: {
  gemini?: () => Response | Promise<Response>;
  vilao?: () => Response | Promise<Response>;
}): { fetchImpl: typeof fetch; seen: ('gemini' | 'vilao')[] } {
  const seen: ('gemini' | 'vilao')[] = [];
  const fetchImpl = (async (url: unknown) => {
    const which = String(url).includes('gemini.invalid') ? 'gemini' : 'vilao';
    seen.push(which);
    const handler = which === 'gemini' ? handlers.gemini : handlers.vilao;
    if (handler === undefined) throw new Error(`unexpected call to ${which}`);
    return handler();
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('router — the turn', () => {
  it('falls back to vilao when Gemini refuses with a 503', async () => {
    const fake = routed({
      gemini: () => new Response(JSON.stringify({ error: { status: 'UNAVAILABLE' } }), { status: 503 }),
      vilao: () => vilaoAnswer(JSON.stringify(reply('From vilao'))),
    });
    const result = await completeReply(config(), messages, fake.fetchImpl);
    expect(result.ok && result.reply.message).toBe('From vilao');
    expect(fake.seen).toEqual(['gemini', 'vilao']);
  });

  it('does not fall back when the answer was blocked by safety', async () => {
    const fake = routed({
      gemini: () => geminiAnswer('', { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }),
      vilao: () => vilaoAnswer(JSON.stringify(reply('From vilao'))),
    });
    const result = await completeReply(config(), messages, fake.fetchImpl);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.kind).toBe('blocked');
    // The guest's sentence was the problem; the second provider is never asked.
    expect(fake.seen).toEqual(['gemini']);
  });

  it('uses the fallback as the primary when the primary has no key', async () => {
    const base = config();
    const noGemini: AiConfig = { ...base, gemini: { ...base.gemini, apiKey: '' } };
    const fake = routed({ vilao: () => vilaoAnswer(JSON.stringify(reply('From vilao'))) });
    const result = await completeReply(noGemini, messages, fake.fetchImpl);
    expect(result.ok).toBe(true);
    expect(fake.seen).toEqual(['vilao']);
  });

  it('fails without calling anyone when neither provider has a key', async () => {
    const base = config();
    const none: AiConfig = {
      ...base,
      gemini: { ...base.gemini, apiKey: '' },
      vilao: { ...base.vilao, apiKey: '' },
    };
    const fake = routed({});
    const result = await completeReply(none, messages, fake.fetchImpl);
    expect(result.ok).toBe(false);
    expect(fake.seen).toEqual([]);
  });

  it('retries the primary once on a 503 when there is no fallback', async () => {
    let attempt = 0;
    const fake = routed({
      gemini: () => {
        attempt += 1;
        return attempt === 1
          ? new Response(JSON.stringify({ error: { status: 'UNAVAILABLE' } }), { status: 503 })
          : geminiAnswer(JSON.stringify(reply('Second time lucky')));
      },
    });
    const result = await completeReply(config({ fallback: 'none' }), messages, fake.fetchImpl);
    expect(result.ok && result.reply.message).toBe('Second time lucky');
    expect(fake.seen).toEqual(['gemini', 'gemini']);
  }, 10_000);

  it('never retries a 400 on the same provider', async () => {
    const fake = routed({
      gemini: () => new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT' } }), { status: 400 }),
    });
    const result = await completeReply(config({ fallback: 'none' }), messages, fake.fetchImpl);
    expect(result.ok).toBe(false);
    // One attempt: a 400 is an answer about the request, not a hiccup.
    expect(fake.seen).toEqual(['gemini']);
  });

  it('logs one line naming job, provider, status and tokens — and no prompt text', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const fake = routed({ gemini: () => geminiAnswer(JSON.stringify(reply('Done'))) });
    await completeReply(config(), messages, fake.fetchImpl);

    const ai = lines.filter((line) => line.startsWith('[ai]'));
    expect(ai).toHaveLength(1);
    expect(ai[0]).toContain('job=turn');
    expect(ai[0]).toContain('provider=gemini');
    expect(ai[0]).toContain('status=ok');
    expect(ai[0]).toContain('fallbackFired=false');
    expect(ai[0]).toContain('inputTokens=11');
    // Never the sentence, never a key.
    expect(ai[0]).not.toContain('nine wide');
    expect(ai[0]).not.toContain('unit-key');
  });
});

describe('router — speech to text', () => {
  const audio = new Uint8Array([1, 2, 3]);

  it('falls back when a 2 s clip comes back empty', async () => {
    const fake = routed({
      gemini: () => geminiAnswer(''),
      vilao: () => new Response(JSON.stringify({ text: 'add a roller door' }), { status: 200 }),
    });
    const text = await transcribe(config(), audio, 'audio/webm', { durationMs: 2_000 }, fake.fetchImpl);
    expect(text).toBe('add a roller door');
    expect(fake.seen).toEqual(['gemini', 'vilao']);
  });

  it('keeps a short empty answer: below 1.5 s that is "no speech", not a failure', async () => {
    const fake = routed({ gemini: () => geminiAnswer('') });
    const text = await transcribe(config(), audio, 'audio/webm', { durationMs: 500 }, fake.fetchImpl);
    expect(text).toBe('');
    expect(fake.seen).toEqual(['gemini']);
  });

  it('passes the clip length through, so the rule above can exist', async () => {
    const fake = routed({ gemini: () => geminiAnswer('hello') });
    await transcribe(config(), audio, 'audio/webm', { durationMs: 2_000 }, fake.fetchImpl);
    expect(fake.seen).toEqual(['gemini']);
  });
});

describe('router — the repair pass', () => {
  it('falls back when Gemini answers prose instead of the repair shape', async () => {
    const fake = routed({
      gemini: () => geminiAnswer('I think they said nine by six.'),
      vilao: () =>
        vilaoAnswer(JSON.stringify({ text: '9 x 6 shed', onTopic: true, confidence: 'high', alternatives: [] })),
    });
    const repaired = await repairTranscript(config(), 'repair this', 'nine by six', fake.fetchImpl);
    expect(repaired?.text).toBe('9 x 6 shed');
    expect(fake.seen).toEqual(['gemini', 'vilao']);
  });

  it('returns null, not a throw, when both providers fail', async () => {
    const fake = routed({
      gemini: () => new Response('{}', { status: 500 }),
      vilao: () => new Response('{}', { status: 500 }),
    });
    await expect(repairTranscript(config(), 'repair this', 'nine by six', fake.fetchImpl)).resolves.toBeNull();
    expect(fake.seen).toEqual(['gemini', 'vilao']);
  });
});

describe('router — the budget floor', () => {
  it('does not start a fallback it cannot finish', () => {
    expect(shouldFallback({ worthy: true, fallbackEnabled: true, remainingMs: 4_999, minimumMs: 5_000 })).toBe(false);
    expect(shouldFallback({ worthy: true, fallbackEnabled: true, remainingMs: 5_000, minimumMs: 5_000 })).toBe(true);
    // A repair's floor is lower, because its whole budget is shorter.
    expect(shouldFallback({ worthy: true, fallbackEnabled: true, remainingMs: 2_000, minimumMs: 2_000 })).toBe(true);
    expect(shouldFallback({ worthy: true, fallbackEnabled: false, remainingMs: 9_000, minimumMs: 2_000 })).toBe(false);
    expect(shouldFallback({ worthy: false, fallbackEnabled: true, remainingMs: 9_000, minimumMs: 2_000 })).toBe(false);
  });
});
