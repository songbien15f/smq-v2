/**
 * The AI settings in force: the `ai_settings` row an admin saved, over the env defaults.
 *
 * ## The merge, and why it is in this order
 *
 * ```
 * env defaults  <  ai_settings row (if any)
 * ```
 *
 * The environment states what a fresh install runs. A saved row is a decision somebody made, so it
 * wins. **No row means no decision**: an install that has never opened the admin screen runs the env
 * defaults, and deleting the row is a supported way back to them.
 *
 * ## No key is in this file's data
 *
 * `GEMINI_API_KEY` and `VILAO_API_KEY` are read from the environment and never copied into a settings
 * value. `AiSettingsView` reports only `geminiKeySet` / `vilaoKeySet` — booleans — which is what the
 * admin screen shows. Migration 008 dropped `platform_settings` because credentials must not live in a
 * table; the same rule governs this table.
 *
 * ## The cache
 *
 * Every turn, repair and transcription reads these settings. A 30-second cache keeps that off the
 * database on a busy page, and `PUT /admin/ai-settings` invalidates it in the same process that served
 * the save, so "change the primary and watch the next turn" works without a restart.
 *
 * The cache is keyed by the `Db` instance, not globally: the API has one, and a test suite that builds
 * several must never read another database's settings.
 */

import type { Db } from '@sq/db';
import type { AiSettings, AiSettingsView } from '@sq/contracts';
import type { AiConfig, FallbackChoice, GeminiSettings, GeminiThinking, ProviderId, VilaoSettings } from './types.js';

/** Defaults for the two providers, as the plan's env table states them. */
const GEMINI_DEFAULTS = {
  model: 'gemini-3.5-flash-lite',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  thinking: 'minimal',
} as const;
const VILAO_DEFAULTS = {
  baseUrl: 'https://api.vilao.ai/v1',
  model: 'wiki',
  sttModel: 'mgr/grok-stt',
} as const;

/** How long a settings read is trusted. Cleared on save (`invalidateAiSettings`). */
export const AI_SETTINGS_TTL_MS = 30_000;

const PROVIDERS: readonly ProviderId[] = ['gemini', 'vilao'];

function trimmed(value: string | undefined, fallback = ''): string {
  const v = (value ?? '').trim();
  return v === '' ? fallback : v;
}

function asProvider(value: string | undefined, fallback: ProviderId): ProviderId {
  const v = (value ?? '').trim().toLowerCase();
  return (PROVIDERS as readonly string[]).includes(v) ? (v as ProviderId) : fallback;
}

function asFallback(value: string | undefined, fallback: FallbackChoice): FallbackChoice {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'none' || (PROVIDERS as readonly string[]).includes(v) ? (v as FallbackChoice) : fallback;
}

function asThinking(value: string | undefined, fallback: GeminiThinking): GeminiThinking {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'minimal' || v === 'low' || v === 'medium' || v === 'high' ? (v as GeminiThinking) : fallback;
}

/**
 * The settings the environment states, before anything is saved.
 *
 * `GEMINI_STT_MODEL` defaults to `GEMINI_MODEL`: a project that points one at a newer model usually
 * wants the same model listening.
 */
export function envAiSettings(env: NodeJS.ProcessEnv = process.env): AiSettings {
  const geminiModel = trimmed(env.GEMINI_MODEL, GEMINI_DEFAULTS.model);
  return {
    primary: asProvider(env.AI_PRIMARY, 'gemini'),
    fallback: asFallback(env.AI_FALLBACK, 'vilao'),
    geminiModel,
    geminiSttModel: trimmed(env.GEMINI_STT_MODEL, geminiModel),
    geminiThinking: asThinking(env.GEMINI_THINKING_LEVEL, GEMINI_DEFAULTS.thinking),
    vilaoModel: trimmed(env.VILAO_MODEL, VILAO_DEFAULTS.model),
    vilaoSttModel: trimmed(env.VILAO_STT_MODEL, VILAO_DEFAULTS.sttModel),
  };
}

/** True when at least one provider has a key. `assistantEnabled` reads this. */
export function anyProviderConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return trimmed(env.GEMINI_API_KEY) !== '' || trimmed(env.VILAO_API_KEY) !== '';
}

/** The two provider blocks, keys included, built from the environment. */
function providersFromEnv(env: NodeJS.ProcessEnv): Pick<AiConfig, 'gemini' | 'vilao'> {
  const gemini: GeminiSettings = {
    apiKey: trimmed(env.GEMINI_API_KEY),
    model: trimmed(env.GEMINI_MODEL, GEMINI_DEFAULTS.model),
    sttModel: trimmed(env.GEMINI_STT_MODEL, trimmed(env.GEMINI_MODEL, GEMINI_DEFAULTS.model)),
    baseUrl: trimmed(env.GEMINI_BASE_URL, GEMINI_DEFAULTS.baseUrl).replace(/\/$/, ''),
    thinking: asThinking(env.GEMINI_THINKING_LEVEL, GEMINI_DEFAULTS.thinking),
  };
  const vilao: VilaoSettings = {
    apiKey: trimmed(env.VILAO_API_KEY),
    model: trimmed(env.VILAO_MODEL, VILAO_DEFAULTS.model),
    sttModel: trimmed(env.VILAO_STT_MODEL, VILAO_DEFAULTS.sttModel),
    baseUrl: trimmed(env.VILAO_BASE_URL, VILAO_DEFAULTS.baseUrl).replace(/\/$/, ''),
  };
  return { gemini, vilao };
}

/** A settings value as the router wants it: the chosen providers, the model ids, and the keys. */
export function aiConfigFromSettings(settings: AiSettings, env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const providers = providersFromEnv(env);
  if (providers.gemini.apiKey === '' && providers.vilao.apiKey === '') return null;
  return {
    primary: settings.primary,
    fallback: settings.fallback,
    gemini: { ...providers.gemini, model: settings.geminiModel, sttModel: settings.geminiSttModel, thinking: settings.geminiThinking },
    vilao: { ...providers.vilao, model: settings.vilaoModel, sttModel: settings.vilaoSttModel },
  };
}

/** The configuration as the environment alone states it, or `null` when no provider has a key. */
export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  return aiConfigFromSettings(envAiSettings(env), env);
}

interface SettingsRow {
  primary_provider: string;
  fallback_provider: string;
  gemini_model: string;
  gemini_stt_model: string;
  gemini_thinking: string;
  vilao_model: string;
  vilao_stt_model: string;
  updated_at: string;
  updated_by: string;
}

const CACHE = new WeakMap<Db, { at: number; value: AiSettingsView }>();

/** Drop the cached settings — called by the save route so the next call sees the new row. */
export function invalidateAiSettings(db?: Db): void {
  if (db === undefined) {
    // No instance given: nothing to key on. Callers inside the API always have one.
    return;
  }
  CACHE.delete(db);
}

/** Read the row, or `null` when there is none (or the table is not there yet). */
async function readRow(db: Db): Promise<SettingsRow | null> {
  try {
    return await db.get<SettingsRow>(
      `SELECT primary_provider, fallback_provider, gemini_model, gemini_stt_model, gemini_thinking,
              vilao_model, vilao_stt_model, updated_at, updated_by
         FROM ai_settings WHERE id = ?`,
      ['global'],
    );
  } catch (error) {
    /*
     * A database that has not run migration 025 yet. Falling back to the env defaults keeps the
     * assistant answering during a deploy that migrates after the API starts; the warning names the
     * table and nothing else.
     */
    const message = error instanceof Error ? error.message : String(error);
    if (/ai_settings|does not exist|no such table/i.test(message)) {
      console.warn('[ai] ai_settings is unavailable, using the environment defaults');
      return null;
    }
    throw error;
  }
}

/**
 * The settings in force, cached for {@link AI_SETTINGS_TTL_MS}.
 *
 * The view carries the key flags for the admin screen: the booleans are read from this process's
 * environment, so they change on restart (which is what rotating a key means), never through a save.
 */
export async function effectiveAiSettings(db: Db, env: NodeJS.ProcessEnv = process.env): Promise<AiSettingsView> {
  const now = Date.now();
  const cached = CACHE.get(db);
  if (cached !== undefined && now - cached.at < AI_SETTINGS_TTL_MS) return cached.value;

  const defaults = envAiSettings(env);
  const row = await readRow(db);
  const value: AiSettingsView = {
    ...(row === null
      ? defaults
      : {
          primary: asProvider(row.primary_provider, defaults.primary),
          fallback: asFallback(row.fallback_provider, defaults.fallback),
          geminiModel: row.gemini_model,
          geminiSttModel: row.gemini_stt_model,
          geminiThinking: asThinking(row.gemini_thinking, defaults.geminiThinking),
          vilaoModel: row.vilao_model,
          vilaoSttModel: row.vilao_stt_model,
        }),
    geminiKeySet: trimmed(env.GEMINI_API_KEY) !== '',
    vilaoKeySet: trimmed(env.VILAO_API_KEY) !== '',
    source: row === null ? 'env' : 'db',
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
  };
  CACHE.set(db, { at: now, value });
  return value;
}

/** The router's configuration: the effective settings, with the keys from the environment. */
export async function resolveAiConfig(db: Db | null, env: NodeJS.ProcessEnv = process.env): Promise<AiConfig | null> {
  if (db === null) return aiConfigFromEnv(env);
  return aiConfigFromSettings(await effectiveAiSettings(db, env), env);
}
