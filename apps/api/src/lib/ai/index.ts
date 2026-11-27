/**
 * The AI entry point: which provider answers, in what order, and one log line per call.
 *
 * ## Two providers, one interface
 *
 * Google Gemini direct is the **primary**; the vilao gateway is the **automatic fallback**. Both
 * implement `AiProvider` (`types.ts`), so the rest of the product never learns which one answered — the
 * Guest contracts, routes, quotas and redaction are unchanged.
 *
 * ## The walk
 *
 * 1. Read the configuration (`resolveAiConfig`): env defaults, and the `ai_settings` row a platform
 *    admin saved once slice 4 is in. **Keys are never part of that row** — they come from `.env` only,
 *    which is why the admin screen can show "key set: yes/no" and nothing else (migration 008 dropped
 *    `platform_settings` for exactly this reason).
 * 2. If the primary has no key, the fallback **becomes** the primary. With nothing configured at all
 *    the call answers `not_configured`, which the routes already render.
 * 3. Call the primary with its share of the budget.
 * 4. On a **fallback-worthy** failure, call the fallback once if a fallback is configured and enough
 *    budget remains.
 *
 * Fallback-worthy: a timeout or network error, HTTP 400/402/403/429/5xx, an answer that did not parse,
 * and an empty transcript for a clip of at least {@link STT_MIN_AUDIO_MS}. **Not** fallback-worthy:
 * content blocked by safety — the guest's sentence was the problem, and the second provider would either
 * refuse the same way or dodge a refusal the product asked for.
 *
 * ## Budgets
 *
 * One deadline per job, computed once:
 *
 * | Job | Total | Primary share | Fallback |
 * |---|---|---|---|
 * | Assistant turn | 25 s | 14 s | what remains, if ≥ 5 s |
 * | Speech to text | 25 s | 14 s | what remains, if ≥ 5 s |
 * | Transcript repair | 8 s | 5 s | what remains, if ≥ 2 s, else `null` |
 *
 * With a fallback configured the primary does **no** internal retry: the fallback *is* the retry. With
 * `fallback: none` the primary gets the whole budget and is retried **once** on 429/500/503/504 or a
 * network error, after a 500–1000 ms jittered pause. 400/402/403/404 are never retried on the same
 * provider — those are answers about the request or the account, not a hiccup.
 *
 * ## One log line per call, and never a body
 *
 * The line names the job, the provider that answered (or last tried), the status, whether the fallback
 * fired, the latency and the token counts. Never the request, never the audio, never a key.
 */

import type {
  AiConfig,
  AiProvider,
  ChatMessage,
  CompletionResult,
  FallbackChoice,
  GeminiSettings,
  GeminiThinking,
  ProviderId,
  SttOptions,
  TranscriptRepair,
  VilaoSettings,
} from './types.js';
import { geminiProvider } from './gemini.js';
import { anyProviderConfigured, aiConfigFromEnv, resolveAiConfig } from './settings.js';
import { vilaoProvider } from './vilao.js';

/*
 * Settings live in `settings.ts` (the env defaults and the admin's row); the router only walks the
 * providers. Re-exported so callers keep one import path.
 */
export { aiConfigFromEnv, anyProviderConfigured, resolveAiConfig, effectiveAiSettings } from './settings.js';

export type {
  AiConfig,
  AiProvider,
  ChatMessage,
  CompletionResult,
  FallbackChoice,
  GeminiSettings,
  GeminiThinking,
  ProviderId,
  SttOptions,
  TranscriptRepair,
  VilaoSettings,
};

/** The three budgets, and the primary's share of each. */
export const AI_BUDGETS = {
  turn: { totalMs: 25_000, primaryMs: 14_000, fallbackMinMs: 5_000 },
  stt: { totalMs: 25_000, primaryMs: 14_000, fallbackMinMs: 5_000 },
  repair: { totalMs: 8_000, primaryMs: 5_000, fallbackMinMs: 2_000 },
} as const;

/** A clip at least this long that came back empty is a provider failure, not a silent guest. */
export const STT_MIN_AUDIO_MS = 1_500;

/** Statuses worth retrying on the same provider when there is no fallback. */
const RETRY_STATUSES = new Set([429, 500, 503, 504]);

/** One provider object for an id, or `null` when that provider has no key. */
export function providerFor(config: AiConfig, id: ProviderId): AiProvider | null {
  if (id === 'gemini') return config.gemini.apiKey === '' ? null : geminiProvider(config.gemini);
  return config.vilao.apiKey === '' ? null : vilaoProvider(config.vilao);
}

/** The two providers in the order they will be tried, after "primary with no key" is resolved. */
export interface ProviderPlan {
  first: AiProvider;
  second: AiProvider | null;
  /** True when the fallback became the first because the configured primary has no key. */
  promoted: boolean;
}

export function planFor(config: AiConfig): ProviderPlan | null {
  const primary = providerFor(config, config.primary);
  const fallback = config.fallback === 'none' ? null : providerFor(config, config.fallback);
  if (primary !== null) {
    // A fallback that is the same provider as the primary is not a fallback.
    return { first: primary, second: fallback?.id === primary.id ? null : fallback, promoted: false };
  }
  if (fallback !== null) return { first: fallback, second: null, promoted: true };
  return null;
}

/** Is this failure worth asking the other provider about? */
function worthFallback(failure: { kind: string; status?: number }): boolean {
  // Content blocked is about the guest's words; another provider must not be asked to dodge it.
  if (failure.kind === 'blocked') return false;
  if (failure.kind === 'timeout' || failure.kind === 'network' || failure.kind === 'invalid') return true;
  if (failure.status === undefined) return true;
  if (failure.status === 400 || failure.status === 402 || failure.status === 403 || failure.status === 429) return true;
  if (failure.status >= 500) return true;
  return false;
}

/**
 * The one place the "try the other provider" decision is made, so the three jobs cannot drift apart.
 *
 * `worthy` is the failure classification (`worthFallback`); the budget floor is what keeps a fallback
 * from starting a call it cannot finish — a 25 s turn with 3 s left gets no second attempt, because the
 * guest's page would time out first.
 */
export function shouldFallback(input: {
  worthy: boolean;
  fallbackEnabled: boolean;
  remainingMs: number;
  minimumMs: number;
}): boolean {
  return input.fallbackEnabled && input.worthy && input.remainingMs >= input.minimumMs;
}

/** A pause between two attempts on the same provider: 500–1000 ms, jittered. */
function retryDelayMs(): number {
  return 500 + Math.floor(Math.random() * 500);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** One structured line per call. Fields only — never a body, an audio clip or a key. */
function logCall(fields: {
  job: 'turn' | 'stt' | 'repair';
  provider: ProviderId | null;
  status: string;
  fallbackFired: boolean;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}): void {
  const parts = [
    `job=${fields.job}`,
    `provider=${fields.provider ?? 'none'}`,
    `status=${fields.status}`,
    `fallbackFired=${fields.fallbackFired}`,
    `latencyMs=${fields.latencyMs}`,
  ];
  if (fields.inputTokens !== undefined) parts.push(`inputTokens=${fields.inputTokens}`);
  if (fields.outputTokens !== undefined) parts.push(`outputTokens=${fields.outputTokens}`);
  console.info(`[ai] ${parts.join(' ')}`);
}

/* ------------------------------------------------------------------ the calls */

/**
 * One assistant turn: primary, then the fallback when the failure is worth it.
 *
 * The corrective retry in `guestAssistant.ts` calls this again, and this picks a provider again — that
 * is intended: a second attempt is a second chance for the primary.
 */
export async function completeReply(
  config: AiConfig,
  messages: ChatMessage[],
  fetchImpl: typeof fetch = fetch,
): Promise<CompletionResult> {
  const plan = planFor(config);
  const started = Date.now();
  if (plan === null) {
    logCall({ job: 'turn', provider: null, status: 'not_configured', fallbackFired: false, latencyMs: 0 });
    return { ok: false, kind: 'http', reason: 'no AI provider is configured' };
  }

  const budget = AI_BUDGETS.turn;
  const primaryMs = plan.second === null ? budget.totalMs : budget.primaryMs;
  let result = await plan.first.completeReply(messages, { deadlineMs: primaryMs, fetchImpl });

  /*
   * With no fallback, the primary is the only chance: one retry on a hiccup. 400/402/403/404 are not
   * hiccups — they are answers about the request or the account, and repeating them just spends time.
   */
  if (!result.ok && plan.second === null && result.kind === 'network') {
    await sleep(retryDelayMs());
    result = await plan.first.completeReply(messages, {
      deadlineMs: Math.max(1_000, budget.totalMs - (Date.now() - started)),
      fetchImpl,
    });
  } else if (!result.ok && plan.second === null && result.status !== undefined && RETRY_STATUSES.has(result.status)) {
    await sleep(retryDelayMs());
    result = await plan.first.completeReply(messages, {
      deadlineMs: Math.max(1_000, budget.totalMs - (Date.now() - started)),
      fetchImpl,
    });
  }

  if (result.ok) {
    logCall({
      job: 'turn',
      provider: plan.first.id,
      status: 'ok',
      fallbackFired: false,
      latencyMs: Date.now() - started,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    });
    return result;
  }

  const remaining = budget.totalMs - (Date.now() - started);
  if (
    plan.second !== null &&
    shouldFallback({
      worthy: worthFallback(result),
      fallbackEnabled: true,
      remainingMs: remaining,
      minimumMs: budget.fallbackMinMs,
    })
  ) {
    const second = await plan.second.completeReply(messages, { deadlineMs: remaining, fetchImpl });
    logCall({
      job: 'turn',
      provider: second.ok ? plan.second.id : plan.first.id,
      status: second.ok ? 'ok' : second.kind,
      fallbackFired: true,
      latencyMs: Date.now() - started,
      inputTokens: second.usage?.inputTokens,
      outputTokens: second.usage?.outputTokens,
    });
    return second;
  }

  logCall({
    job: 'turn',
    provider: plan.first.id,
    status: result.kind,
    fallbackFired: false,
    latencyMs: Date.now() - started,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  });
  return result;
}

/** The repair pass. `null` means "keep the raw transcript", exactly as before. */
export async function repairTranscript(
  config: AiConfig,
  system: string,
  transcript: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TranscriptRepair | null> {
  const plan = planFor(config);
  const started = Date.now();
  if (plan === null) return null;

  const budget = AI_BUDGETS.repair;
  const first = await plan.first.repairTranscript(system, transcript, {
    deadlineMs: plan.second === null ? budget.totalMs : budget.primaryMs,
    fetchImpl,
  });
  if (first !== null) {
    logCall({ job: 'repair', provider: plan.first.id, status: 'ok', fallbackFired: false, latencyMs: Date.now() - started });
    return first;
  }

  const remaining = budget.totalMs - (Date.now() - started);
  if (
    plan.second !== null &&
    shouldFallback({ worthy: true, fallbackEnabled: true, remainingMs: remaining, minimumMs: budget.fallbackMinMs })
  ) {
    const second = await plan.second.repairTranscript(system, transcript, { deadlineMs: remaining, fetchImpl });
    logCall({
      job: 'repair',
      provider: second === null ? plan.first.id : plan.second.id,
      status: second === null ? 'failed' : 'ok',
      fallbackFired: true,
      latencyMs: Date.now() - started,
    });
    return second;
  }

  logCall({
    job: 'repair',
    provider: plan.first.id,
    status: 'failed',
    fallbackFired: false,
    latencyMs: Date.now() - started,
  });
  return null;
}

/**
 * Speech to text. `''` means "type it instead", exactly as before.
 *
 * An empty answer is only a provider failure when the clip was long enough to contain speech
 * ({@link STT_MIN_AUDIO_MS}); below that, "no speech" is the honest answer and no second provider is
 * asked.
 */
export async function transcribe(
  config: AiConfig,
  audio: Uint8Array,
  mimeType: string,
  opts: SttOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const plan = planFor(config);
  const started = Date.now();
  if (plan === null) return '';

  const budget = AI_BUDGETS.stt;
  const primaryMs = plan.second === null ? budget.totalMs : budget.primaryMs;
  let outcome = await plan.first.transcribe(audio, mimeType, opts, { deadlineMs: primaryMs, fetchImpl });

  const emptyIsFailure = outcome.ok && outcome.text === '' && (opts.durationMs ?? 0) >= STT_MIN_AUDIO_MS;
  const failed = !outcome.ok;

  /** No fallback: retry the primary once on a hiccup. */
  if (plan.second === null && (emptyIsFailure || (failed && outcome.ok === false && isRetryable(outcome)))) {
    await sleep(retryDelayMs());
    outcome = await plan.first.transcribe(audio, mimeType, opts, {
      deadlineMs: Math.max(1_000, budget.totalMs - (Date.now() - started)),
      fetchImpl,
    });
  }

  const stillEmpty = outcome.ok && outcome.text === '' && (opts.durationMs ?? 0) >= STT_MIN_AUDIO_MS;
  const worthIt =
    (outcome.ok === false && worthFallback(outcome)) || stillEmpty;

  const remaining = budget.totalMs - (Date.now() - started);
  if (
    plan.second !== null &&
    shouldFallback({ worthy: worthIt, fallbackEnabled: true, remainingMs: remaining, minimumMs: budget.fallbackMinMs })
  ) {
    const second = await plan.second.transcribe(audio, mimeType, opts, { deadlineMs: remaining, fetchImpl });
    logCall({
      job: 'stt',
      provider: plan.second.id,
      status: second.ok ? (second.text === '' ? 'empty' : 'ok') : second.kind,
      fallbackFired: true,
      latencyMs: Date.now() - started,
      inputTokens: second.usage?.inputTokens,
      outputTokens: second.usage?.outputTokens,
    });
    return second.ok ? second.text : '';
  }

  logCall({
    job: 'stt',
    provider: plan.first.id,
    status: outcome.ok ? (outcome.text === '' ? 'empty' : 'ok') : outcome.kind,
    fallbackFired: false,
    latencyMs: Date.now() - started,
    inputTokens: outcome.usage?.inputTokens,
    outputTokens: outcome.usage?.outputTokens,
  });
  return outcome.ok ? outcome.text : '';
}

/** A failure the same provider may answer differently in a moment. */
function isRetryable(outcome: { kind: string; status?: number }): boolean {
  if (outcome.kind === 'network') return true;
  return outcome.status !== undefined && RETRY_STATUSES.has(outcome.status);
}
