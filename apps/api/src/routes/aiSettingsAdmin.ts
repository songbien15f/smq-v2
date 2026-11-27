/**
 * The vendor's AI settings screen (2026-11-27): which provider answers the Guest assistant.
 *
 * ## What this owns
 *
 * One platform-wide row in `ai_settings` — primary provider, fallback, and the model ids each uses. The
 * table has no `tenant_id` on purpose: the assistant is one assistant for every visitor, and a per-company
 * model would make two customers' answers differ for reasons neither can see.
 *
 * ## What it will not do
 *
 * - **No key, in or out.** `GEMINI_API_KEY` and `VILAO_API_KEY` live in `.env` and nowhere else. The
 *   GET reports `geminiKeySet` / `vilaoKeySet` as booleans, and the PUT cannot change them. Rotating a
 *   key is editing `.env` and restarting the API (migration 008 dropped `platform_settings` for this
 *   rule, and it still holds).
 * - **No silent fall-through to the wrong provider.** `aiSettingsSchema` refuses a fallback equal to
 *   the primary, because that spends the remaining budget on the provider that just failed.
 * - **No unaudited change.** The upsert and its `audit_events` row are written in one transaction.
 *
 * ## The cache
 *
 * `effectiveAiSettings` caches for 30 s; a save invalidates it in this process, so the next turn uses the
 * new value without a restart.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { now } from '@sq/db';
import { aiSettingsSchema, type AiSettingsView } from '@sq/contracts';
import { audit } from '../lib/audit.js';
import { requirePlatformCapability } from '../lib/guard.js';
import { parseBody, sendOk } from '../lib/http.js';
import { effectiveAiSettings, invalidateAiSettings } from '../lib/ai/settings.js';

/** Which model answers the Guest assistant, and with which model ids. Platform-wide, vendor-only. */
const CAPABILITY = 'platform:ai';

export function registerAiSettingsAdmin(app: FastifyInstance, db: Db): void {
  // ---------------------------------------------------------------- read

  app.get('/admin/ai-settings', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, CAPABILITY);
    if (session === null) return;
    const view: AiSettingsView = await effectiveAiSettings(db);
    return sendOk(reply, view);
  });

  // ---------------------------------------------------------------- write

  app.put('/admin/ai-settings', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, CAPABILITY);
    if (session === null) return;

    const body = parseBody(aiSettingsSchema, request.body, reply);
    if (body === null) return;

    await db.transaction(async (tx) => {
      const at = now();
      /*
       * One row, id `'global'`. The upsert keeps the row's identity stable so a reader can tell "saved
       * once" from "never saved" — the latter has no row at all and uses the env defaults.
       */
      await tx.run(
        `INSERT INTO ai_settings
           (id, primary_provider, fallback_provider, gemini_model, gemini_stt_model, gemini_thinking,
            vilao_model, vilao_stt_model, updated_at, updated_by)
         VALUES ('global', ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           primary_provider = excluded.primary_provider,
           fallback_provider = excluded.fallback_provider,
           gemini_model = excluded.gemini_model,
           gemini_stt_model = excluded.gemini_stt_model,
           gemini_thinking = excluded.gemini_thinking,
           vilao_model = excluded.vilao_model,
           vilao_stt_model = excluded.vilao_stt_model,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
        [
          body.primary,
          body.fallback,
          body.geminiModel,
          body.geminiSttModel,
          body.geminiThinking,
          body.vilaoModel,
          body.vilaoSttModel,
          at,
          session.userId,
        ],
      );
      await audit(tx, {
        actorId: session.userId,
        actorEmail: session.email,
        action: 'ai_settings.update',
        targetType: 'ai_settings',
        targetId: 'global',
        summary:
          `AI provider set to ${body.primary} (fallback ${body.fallback}); ` +
          `Gemini ${body.geminiModel}/${body.geminiSttModel} thinking ${body.geminiThinking}; ` +
          `vilao ${body.vilaoModel}/${body.vilaoSttModel}`,
      });
    });

    // This process served the save, so the caller sees its own change on the next turn.
    invalidateAiSettings(db);
    const view: AiSettingsView = await effectiveAiSettings(db);
    return sendOk(reply, view);
  });
}
