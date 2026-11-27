/**
 * The shapes the two model adapters share.
 *
 * There are two providers — Google Gemini direct and the vilao gateway — with **one** interface, so the
 * router can treat them interchangeably and the rest of the product never learns which one answered.
 *
 * The failure contract does not change from the single-gateway days: no adapter throws. A refusal, a
 * timeout, a blocked answer or unparseable JSON comes back as a value, because a turn that cannot be
 * answered must not take the designer down with it (`lib/guestAssistant.ts` turns it into the page's
 * "unavailable" strip).
 */

import type { AiUsage, CompletionResult, FailureKind, ModelReply, TranscriptRepair } from './schemas.js';

export type { AiUsage, CompletionResult, FailureKind, ModelReply, TranscriptRepair };

export type ProviderId = 'gemini' | 'vilao';
/** `none` is a setting, not a provider: it means "do not fall back". */
export type FallbackChoice = ProviderId | 'none';
export type GeminiThinking = 'minimal' | 'low' | 'medium' | 'high';

export interface GeminiSettings {
  apiKey: string;
  model: string;
  sttModel: string;
  baseUrl: string;
  thinking: GeminiThinking;
}

export interface VilaoSettings {
  apiKey: string;
  model: string;
  sttModel: string;
  baseUrl: string;
}

/**
 * Everything one call needs: which provider goes first, what each is called, and the two keys.
 *
 * The keys are read from the environment and travel in this object **inside the API process only**.
 * They are never put in a response, a log line or the database.
 */
export interface AiConfig {
  primary: ProviderId;
  fallback: FallbackChoice;
  gemini: GeminiSettings;
  vilao: VilaoSettings;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Per-call knobs. `deadlineMs` is the whole budget for this attempt; the adapter must not exceed it. */
export interface CallOptions {
  deadlineMs?: number;
  fetchImpl?: typeof fetch;
}

/** Speech to text either produced words or it did not; an empty string is a real answer ("no speech"). */
export type SttOutcome =
  | { ok: true; text: string; status?: number; usage?: AiUsage }
  | { ok: false; reason: string; kind: FailureKind; status?: number; usage?: AiUsage };

export interface SttOptions {
  /** Vocabulary hint. Gemini finally accepts one; the vilao STT model refused it (see `vilao.ts`). */
  prompt?: string;
  language?: string;
  /** How long the clip was, so the router can tell "no speech" from "the model failed silently". */
  durationMs?: number;
}

/** One provider. `configured` is "its key is present in env", not "it is reachable". */
export interface AiProvider {
  readonly id: ProviderId;
  readonly configured: boolean;
  completeReply(messages: ChatMessage[], call: CallOptions): Promise<CompletionResult>;
  repairTranscript(system: string, transcript: string, call: CallOptions): Promise<TranscriptRepair | null>;
  transcribe(audio: Uint8Array, mimeType: string, opts: SttOptions, call: CallOptions): Promise<SttOutcome>;
}
