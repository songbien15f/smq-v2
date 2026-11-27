import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AiSettingsView } from '@sq/contracts';
import { makeTestApp, seedPlatformAdmin, signInPlatform, testConfig, type TestApp } from './helpers.js';

/**
 * The AI settings screen: who may change the provider, what a save writes, and what a GET must never say.
 *
 * The load-bearing one is the last: **no key value crosses the wire**. The response carries
 * `geminiKeySet: true` and nothing else about the key, and these tests set a sentinel key in the
 * environment so "it never appears" is checked against a string that would be easy to spot.
 */

let ctx: TestApp;
let app: FastifyInstance;
let admin: string;
let support: string;

const PASSWORD = 'platform-password-long-enough';
const SENTINEL_GEMINI_KEY = 'sentinel-gemini-value-should-not-travel';
const SENTINEL_VILAO_KEY = 'sentinel-vilao-value-should-not-travel';

const savedEnv = { gemini: process.env.GEMINI_API_KEY, vilao: process.env.VILAO_API_KEY };

const VALID = {
  primary: 'gemini',
  fallback: 'vilao',
  geminiModel: 'gemini-3.5-flash-lite',
  geminiSttModel: 'gemini-3.5-flash-lite',
  geminiThinking: 'minimal',
  vilaoModel: 'wiki',
  vilaoSttModel: 'mgr/grok-stt',
} as const;

async function get(cookie: string) {
  return app.inject({ method: 'GET', url: '/api/v1/admin/ai-settings', headers: { cookie } });
}

async function put(cookie: string, body: unknown) {
  return app.inject({
    method: 'PUT',
    url: '/api/v1/admin/ai-settings',
    headers: { cookie, 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });
}

beforeEach(async () => {
  process.env.GEMINI_API_KEY = SENTINEL_GEMINI_KEY;
  process.env.VILAO_API_KEY = SENTINEL_VILAO_KEY;
  ctx = await makeTestApp(testConfig());
  app = ctx.app;
  await seedPlatformAdmin(ctx.db, { email: 'admin@platform.test', password: PASSWORD });
  await seedPlatformAdmin(ctx.db, { email: 'support@platform.test', password: PASSWORD, role: 'platform_support' });
  admin = await signInPlatform(app, 'admin@platform.test', PASSWORD);
  support = await signInPlatform(app, 'support@platform.test', PASSWORD);
});

afterEach(async () => {
  await ctx.close();
  if (savedEnv.gemini === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedEnv.gemini;
  if (savedEnv.vilao === undefined) delete process.env.VILAO_API_KEY;
  else process.env.VILAO_API_KEY = savedEnv.vilao;
});

describe('GET /admin/ai-settings', () => {
  it('answers the env defaults before anything is saved', async () => {
    const response = await get(admin);
    expect(response.statusCode).toBe(200);
    const view = (JSON.parse(response.body) as { data: AiSettingsView }).data;
    expect(view.source).toBe('env');
    expect(view.updatedAt).toBeNull();
    expect(view.primary).toBe('gemini');
    expect(view.fallback).toBe('vilao');
    expect(view.geminiModel).toBe('gemini-3.5-flash-lite');
  });

  it('reports whether each key is set, and never the key itself', async () => {
    const response = await get(admin);
    const view = (JSON.parse(response.body) as { data: AiSettingsView }).data;
    expect(view.geminiKeySet).toBe(true);
    expect(view.vilaoKeySet).toBe(true);
    expect(response.body).not.toContain(SENTINEL_GEMINI_KEY);
    expect(response.body).not.toContain(SENTINEL_VILAO_KEY);
  });

  it('refuses platform_support', async () => {
    const response = await get(support);
    expect(response.statusCode).toBe(403);
  });
});

describe('PUT /admin/ai-settings', () => {
  it('saves the settings, marks them as coming from the database, and says who saved', async () => {
    const response = await put(admin, { ...VALID, primary: 'vilao', fallback: 'gemini' });
    expect(response.statusCode).toBe(200);
    const view = (JSON.parse(response.body) as { data: AiSettingsView }).data;
    expect(view.primary).toBe('vilao');
    expect(view.fallback).toBe('gemini');
    expect(view.source).toBe('db');
    expect(view.updatedBy).not.toBeNull();

    const again = await get(admin);
    expect((JSON.parse(again.body) as { data: AiSettingsView }).data.primary).toBe('vilao');
  });

  it('writes an audit row in the same save', async () => {
    await put(admin, VALID);
    const rows = await ctx.db.all<{ action: string; target_id: string; summary: string }>(
      `SELECT action, target_id, summary FROM audit_events WHERE action = ?`,
      ['ai_settings.update'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.target_id).toBe('global');
    expect(rows[0]?.summary).toContain('gemini');
  });

  it('refuses a fallback that is the primary', async () => {
    const response = await put(admin, { ...VALID, primary: 'gemini', fallback: 'gemini' });
    expect(response.statusCode).toBe(422);
    // Nothing is written by a refused save.
    const rows = await ctx.db.all('SELECT id FROM ai_settings');
    expect(rows).toHaveLength(0);
  });

  it('refuses a model id that is not a safe path segment', async () => {
    const response = await put(admin, { ...VALID, geminiModel: 'Gemini 3.5 Flash Lite!' });
    expect(response.statusCode).toBe(422);
  });

  it('refuses platform_support', async () => {
    const response = await put(support, VALID);
    expect(response.statusCode).toBe(403);
  });

  it('never echoes a key in the saved view', async () => {
    const response = await put(admin, VALID);
    expect(response.body).not.toContain(SENTINEL_GEMINI_KEY);
    expect(response.body).not.toContain(SENTINEL_VILAO_KEY);
  });
});
