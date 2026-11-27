/**
 * The three JSON shapes the Guest assistant asks a model for, and the result types that go with them.
 *
 * ## Why this is its own file
 *
 * There are now **two** providers (Gemini direct and the vilao gateway), and each wraps a schema in
 * its own dialect: OpenAI's `response_format.json_schema` with `name`/`strict`, versus Gemini's
 * `responseJsonSchema`, which takes the bare schema. The schema itself is the same document in both
 * cases, so it lives here once — a second copy is how one provider quietly starts accepting shapes the
 * other rejects.
 *
 * ## The strict-mode rules (OpenAI)
 *
 * Every object lists **all** of its keys in `required`: `strict: true` allows an optional field only as
 * a union with `null`, never by omitting it. A schema that marks a field optional is rejected with a
 * 400, and the symptom is "the assistant is unavailable", not "the schema is wrong". Gemini ignores the
 * `name`/`strict` wrapper, so nothing here has to be conditioned on the provider.
 *
 * ## Why each operation is its own `anyOf` branch
 *
 * A single object holding the union of every field (`mm`, `degrees`, `roof`, `index`, …) would need all
 * of them required, so the model would have to invent values for the fields an operation does not use.
 * One branch per operation means the shape itself says which fields belong together, and a wrong
 * combination cannot even be expressed.
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

export const OPS_SCHEMA = {
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

/** The full reply schema as OpenAI's Structured Outputs wants it: a name, `strict`, and the schema. */
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

/**
 * Why a call failed, in the terms the router uses: `blocked` is the guest's text (no point trying
 * another provider), `invalid` is an answer that did not parse, `http` carries the status.
 */
export type FailureKind = 'blocked' | 'invalid' | 'http' | 'timeout' | 'network';

/** Token counts as the provider reports them, for the one log line per call. Never a body. */
export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export type CompletionResult =
  | { ok: true; reply: ModelReply; usage?: AiUsage }
  | { ok: false; reason: string; kind: FailureKind; status?: number; usage?: AiUsage };

/**
 * What the repair pass answers with: the transcript steered back to shed English, whether it is about
 * a shed at all, and — when the recogniser plainly guessed — up to two other readings the visitor can
 * pick instead. Strict shape, same rules as `REPLY_JSON_SCHEMA`.
 */
export const REPAIR_JSON_SCHEMA = {
  name: 'guest_transcript_repair',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'onTopic', 'confidence', 'alternatives'],
    properties: {
      text: {
        type: 'string',
        description: 'The corrected sentence. Empty only when the input was empty or pure noise.',
      },
      onTopic: {
        type: 'boolean',
        description: 'True when the sentence is a request or question about designing this shed.',
      },
      confidence: {
        type: 'string',
        enum: ['high', 'low'],
        description: 'Low when a word or a number could reasonably have been something else.',
      },
      alternatives: {
        type: 'array',
        maxItems: 2,
        items: { type: 'string' },
        description: 'Other plausible readings of the same speech, most likely first. Empty when confident.',
      },
    },
  },
} as const;

/** The longest sentence the repair may hand back, so a model that rambles cannot fill the input. */
export const REPAIR_MAX_CHARS = 1_000;

export interface TranscriptRepair {
  text: string;
  onTopic: boolean;
  confidence: 'high' | 'low';
  alternatives: string[];
}

/**
 * The bare JSON Schema for a job, without the OpenAI wrapper.
 *
 * Gemini's `responseJsonSchema` takes the schema itself; the `name` and `strict` keys are OpenAI's.
 */
export function bareSchema(schema: { schema: unknown }): unknown {
  return schema.schema;
}

/**
 * The schema in the shape Gemini will compile: `bareSchema` minus `maxItems` on any array whose items are
 * an `anyOf`.
 *
 * Gemini implements `maxItems` by expanding the item schema once per allowed position, so `OPS_SCHEMA`
 * (ten positions × fifteen branches) was refused with 400 "too many states for serving" by the live probe
 * of 2026-11-27. `parseOps` in `guestAssistant.ts` still caps the list at ten, so nothing is lost. Simple
 * arrays (`alternatives`, `maxItems: 2` of strings) compile and keep their bound.
 */
export function geminiSchema(schema: { schema: unknown }): unknown {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node === null || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) out[key] = strip(value);
    const items = out['items'];
    if (items !== null && typeof items === 'object' && 'anyOf' in items) delete out['maxItems'];
    return out;
  };
  return strip(bareSchema(schema));
}
