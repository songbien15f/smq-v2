/**
 * The AI provider settings a platform admin chooses (2026-11-27).
 *
 * ## What is here, and what is deliberately not
 *
 * These are the *names*: which provider goes first, which is the fallback, and the model ids each one
 * uses. **No API key is ever part of this shape.** Keys live in `.env` only — migration 008 dropped
 * `platform_settings` for exactly this reason — and the view below reports only whether one is present.
 * A response that carried a key would put it in a browser, a log and a screenshot.
 *
 * ## The two cross-field rules
 *
 * 1. A fallback may not be the primary: falling back to the provider that just failed spends the
 *    remaining budget on the same answer.
 * 2. A model id is a path segment on Google's side (`models/{id}:generateContent`) and a free string on
 *    vilao's, so it is constrained to what is safe in a URL and in a log line: lowercase letters,
 *    digits, dot, dash, slash and underscore.
 *
 * ## `source`
 *
 * `db` means an admin saved a row; `env` means the defaults compiled into the API are in force. The
 * admin screen shows which, because "I saved it" and "it is running my values" are different claims.
 */

import { z } from 'zod';

export const AI_PROVIDERS = ['gemini', 'vilao'] as const;
export const AI_FALLBACKS = ['gemini', 'vilao', 'none'] as const;
export const AI_THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;

/** Safe in a URL path segment and readable in a log line. */
const modelId = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9._/-]{1,63}$/, 'Use lowercase letters, digits and . _ / - (2–64 characters).');

/** The writable settings: what `PUT /admin/ai-settings` accepts. */
export const aiSettingsSchema = z
  .object({
    primary: z.enum(AI_PROVIDERS),
    fallback: z.enum(AI_FALLBACKS),
    geminiModel: modelId,
    geminiSttModel: modelId,
    geminiThinking: z.enum(AI_THINKING_LEVELS),
    vilaoModel: modelId,
    vilaoSttModel: modelId,
  })
  .strict()
  .refine((value) => value.fallback === 'none' || value.fallback !== value.primary, {
    path: ['fallback'],
    message: 'The fallback has to be a different provider from the primary.',
  });

export type AiSettings = z.infer<typeof aiSettingsSchema>;

/** Where the values in force came from. */
export type AiSettingsSource = 'db' | 'env';

/** What `GET`/`PUT /admin/ai-settings` answer with: the settings, the key flags and the source. */
export interface AiSettingsView extends AiSettings {
  /** Is `GEMINI_API_KEY` set in this process's environment? Never the value. */
  geminiKeySet: boolean;
  /** Is `VILAO_API_KEY` set in this process's environment? Never the value. */
  vilaoKeySet: boolean;
  source: AiSettingsSource;
  /** ISO-8601, or `null` while the env defaults are in force. */
  updatedAt: string | null;
  /** The admin who last saved, or `null` for the env defaults. */
  updatedBy: string | null;
}
