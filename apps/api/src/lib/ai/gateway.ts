/**
 * The one place this product talks to a language model.
 *
 * ## Server only, key never leaves
 *
 * The key is read from the environment inside this module and used in an `Authorization` header on a
 * request this process makes. It is never put in a response, never logged, and never reaches a
 * browser: the Guest page calls our own route, which calls this.
 *
 * ## Why `fetch` and not the OpenAI SDK
 *
 * The gateway is OpenAI-compatible and this file needs exactly two endpoints. A `fetch` call cannot
 * accidentally get the key into a client bundle the way an SDK import can, and it adds no dependency
 * to a workspace that is already large. The trade is that the request and response shapes are written
 * out here instead of typed by the SDK — which is why the JSON schema below is explicit.
 *
 * ## Nothing here throws on a model failure
 *
 * A refusal, a timeout or an unparseable answer comes back as `{ ok: false, reason }`. A turn that
 * cannot be answered must not take the designer down with it: the page shows "the assistant is
 * unavailable" and the rest of the page works (plan G-g).
 */

/** Timeout for one completion. Twenty seconds, the same budget RFQ_PWA_SQ uses. */
const TIMEOUT_MS = 20_000;

export interface AssistantConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  sttModel: string;
}

/** Read the gateway's settings, or `null` when it is not configured (which means "assistant off"). */
export function assistantConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AssistantConfig | null {
  const apiKey = (env.VILAO_API_KEY ?? '').trim();
  if (apiKey === '') return null;
  const baseUrl = (env.VILAO_BASE_URL ?? 'https://api.vilao.ai/v1').trim().replace(/\/$/, '');
  return {
    baseUrl,
    apiKey,
    model: (env.VILAO_MODEL ?? 'wiki').trim(),
    sttModel: (env.VILAO_STT_MODEL ?? 'mgr/grok-stt').trim(),
  };
}

/**
 * What the model is asked to answer with, as a strict JSON schema.
 *
 * ## Why every object lists **all** of its keys in `required`
 *
 * OpenAI's Structured Outputs are stricter than "a JSON schema": with `strict: true` every object must
 * set `additionalProperties: false` **and** list every property in `required` — an optional field is
 * expressed as a union with `null`, never by omitting it. A schema that marks a field optional (or
 * omits it from a `required` list) is rejected with a 400, and the symptom is "the assistant is
 * unavailable", not "the schema is wrong". The first version of this file did exactly that: only `op`
 * was required, so any gateway passing the schema through would have refused every turn.
 *
 * ## Why each operation is its own `anyOf` branch
 *
 * A single object holding the union of every field (`mm`, `degrees`, `roof`, `index`, …) would need
 * all of them required, so the model would have to invent values for the fields an operation does
 * not use. One branch per operation means the shape itself says which fields belong together, and a
 * wrong combination cannot even be expressed.
 *
 * The branches deliberately carry **no** `null`s: they are the operations that exist. Nullability is
 * only needed inside `setColours`/`addBay`, whose fields are genuinely optional.
 */

/** A number the model may leave out, as Strict Structured Outputs requires: union with `null`. */
const optionalNumber = { type: ['number', 'null'] } as const;
const optionalString = { type: ['string', 'null'] } as const;

function opBranch(name: string, fields: Record<string, unknown> = {}): unknown {
  const properties = { op: { type: 'string', enum: [name] }, ...fields };
  return {
    type: 'object',
    additionalProperties: false,
    // Strict mode: `required` is exactly the property list, in the same order.
    required: Object.keys(properties),
    properties,
  };
}

/** The `trim` trio, all optional, each a colour name or `null`. */
const trimObject = {
  type: ['object', 'null'],
  additionalProperties: false,
  required: ['barge', 'gutter', 'downpipe'],
  properties: { barge: optionalString, gutter: optionalString, downpipe: optionalString },
} as const;

const OPS_SCHEMA = {
  type: 'array',
  maxItems: 10,
  description: 'Design changes to apply, in order. Empty when the sentence was a question.',
  items: {
    anyOf: [
      opBranch('setSpan', { mm: { type: 'number' } }),
      opBranch('setHeight', { mm: { type: 'number' } }),
      opBranch('setPitch', { degrees: { type: 'number' } }),
      opBranch('setRoof', { roof: { type: 'string', enum: ['gable', 'skillion'] } }),
      opBranch('setSlab', { slab: { type: 'string', enum: ['in_slab', 'on_slab', 'footing_only'] } }),
      opBranch('setKneeBrace', {
        kneeBrace: { type: 'string', enum: ['standard', 'none_if_possible'] },
      }),
      opBranch('setCladding', { cladding: { type: 'string', enum: ['vertical', 'horizontal'] } }),
      opBranch('addBay', { atIndex: optionalNumber }),
      opBranch('setBayWidth', { index: { type: 'number' }, mm: { type: 'number' } }),
      opBranch('removeBay', { index: { type: 'number' } }),
      opBranch('addOpening', {
        kind: { type: 'string', enum: ['roller_door', 'pa_door', 'sliding_door', 'window'] },
        wall: { type: 'string', enum: ['front', 'back', 'left', 'right'] },
        size: {
          type: 'object',
          additionalProperties: false,
          required: ['width', 'height'],
          properties: { width: { type: 'number' }, height: { type: 'number' } },
        },
        offset: optionalNumber,
      }),
      opBranch('removeOpening', { index: { type: 'number' } }),
      opBranch('moveOpening', {
        index: { type: 'number' },
        wall: { type: 'string', enum: ['front', 'back', 'left', 'right'] },
        offset: { type: 'number' },
      }),
      opBranch('resizeOpening', {
        index: { type: 'number' },
        size: {
          type: 'object',
          additionalProperties: false,
          required: ['width', 'height'],
          properties: { width: { type: 'number' }, height: { type: 'number' } },
        },
      }),
      /*
       * `roofColour`, not `roof`: `setRoof` already means "change the roof shape", and one name for two
       * things in one schema is how a model ends up putting a colour where a gable belongs.
       */
      opBranch('setColours', {
        walls: optionalString,
        roofColour: optionalString,
        trim: trimObject,
      }),
    ],
  },
} as const;

export const REPLY_JSON_SCHEMA = {
  name: 'guest_assistant_reply',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['message', 'ops', 'needsConfirm'],
    properties: {
      message: {
        type: 'string',
        description:
          'What to say to the guest, in Australian English, at most three short sentences. Never a price, never a delivery date.',
      },
      needsConfirm: {
        type: 'boolean',
        description:
          'True when the change removes two or more openings, replaces the whole design, or resizes the building enough that openings move. The page asks the guest first.',
      },
      ops: OPS_SCHEMA,
    },
  },
} as const;

export interface ModelReply {
  message: string;
  ops: unknown[];
  needsConfirm: boolean;
}

export type CompletionResult =
  | { ok: true; reply: ModelReply }
  | { ok: false; reason: string; status?: number };

/**
 * One chat completion, parsed into a `ModelReply`.
 *
 * The answer is checked structurally here rather than trusted: `response_format` is a request, not a
 * guarantee, and a gateway that answers with prose would otherwise reach the change-set parser as a
 * confusing shape error.
 */
export async function completeReply(
  config: AssistantConfig,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  fetchImpl: typeof fetch = fetch,
): Promise<CompletionResult> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        response_format: { type: 'json_schema', json_schema: REPLY_JSON_SCHEMA },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
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
      status: response.status,
      reason: detail === '' ? `the model refused with ${response.status}` : `the model refused with ${response.status} — ${detail}`,
    };
  }

  let payload: { choices?: { message?: { content?: unknown } }[] };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    return { ok: false, reason: 'the model answered with something that is not JSON' };
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    return { ok: false, reason: 'the model answered with no content' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, reason: 'the model answered with text that is not the reply shape' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, reason: 'the model answered with a non-object' };
  }
  const shape = parsed as { message?: unknown; ops?: unknown; needsConfirm?: unknown };
  if (typeof shape.message !== 'string' || !Array.isArray(shape.ops) || typeof shape.needsConfirm !== 'boolean') {
    return { ok: false, reason: 'the model answer is missing message, ops or needsConfirm' };
  }
  return { ok: true, reply: { message: shape.message, ops: shape.ops, needsConfirm: shape.needsConfirm } };
}

/**
 * Speech to text. Returns `''` on any failure rather than throwing, because a transcript that cannot
 * be produced is "type it instead", not an error page.
 */
export async function transcribe(
  config: AssistantConfig,
  audio: Uint8Array,
  mimeType: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  try {
    const form = new FormData();
    // `Blob` wants an ArrayBuffer-backed view; a `Uint8Array<ArrayBufferLike>` may be shared-backed.
    const bytes = new Uint8Array(audio.byteLength);
    bytes.set(audio);
    form.append('file', new Blob([bytes], { type: mimeType }), 'speech');
    form.append('model', config.sttModel);
    const response = await fetchImpl(`${config.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return '';
    const body = (await response.json()) as { text?: unknown };
    return typeof body.text === 'string' ? body.text.trim() : '';
  } catch {
    return '';
  }
}
