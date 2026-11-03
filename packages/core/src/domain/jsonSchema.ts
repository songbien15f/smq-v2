/**
 * Gateway-safe JSON Schema generation.
 *
 * The AI gateway at `https://api.vilao.ai/v1` is OpenAI-compatible but rejects
 * Zod 4's default nullable representation: `z.toJSONSchema` emits
 * `"type": ["string", "null"]` for a nullable field, and the gateway answers
 * `400 BAD_REQUEST`. `convertNullableUnions` rewrites every such type array into
 * `anyOf: [{ type: X }, { type: 'null' }]`, recursively through nested objects
 * and arrays, and drops the `$schema` key the gateway does not need. A plain
 * union of two real types (no `null`) is left untouched.
 *
 * `toGatewaySchema` builds the request schema from `extractionSchema`, not
 * `shedConfigSchema`: the request must not require `colors` / `displayUnit`, or
 * `strict: true` would make the model fabricate colour hexes it was never asked
 * for.
 *
 * Pure TypeScript: imports only `zod` and sibling domain modules. No React,
 * Next.js, Zustand, Konva, or three.
 */

import { z } from 'zod';
import { requestExtractionSchema } from './schema';

/**
 * Recursively rewrite `type: [X, 'null']` (and any type array containing
 * `'null'`) into an `anyOf` with an explicit `{ type: 'null' }` branch, and
 * remove `$schema`. Arrays are mapped element-wise; objects are rebuilt key by
 * key; scalars pass through. A type array with no `null` entry is left alone.
 */
export function convertNullableUnions(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convertNullableUnions);
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.type) && obj.type.includes('null')) {
      const rest = (obj.type as string[]).filter((t) => t !== 'null');
      return { anyOf: [...rest.map((t) => ({ type: t })), { type: 'null' }] };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) if (k !== '$schema') out[k] = convertNullableUnions(v);
    return out;
  }
  return node;
}

/**
 * The JSON Schema for the extraction response, safe for the gateway: nullables
 * are `anyOf`, and `$schema` is omitted. This is the only function used to build
 * the request schema.
 *
 * Built from `requestExtractionSchema` (every field optional), **not** the
 * complete `extractionSchema`: `strict: true` turns a `required` list into a hard
 * constraint, so requiring all seven fields would make a correct partial answer
 * ("3 things stated, 4 omitted") a schema violation — the model's answer would be
 * thrown away and the request would silently fall back to the local parser.
 */
export function toGatewaySchema(): Record<string, unknown> {
  return convertNullableUnions(z.toJSONSchema(requestExtractionSchema)) as Record<string, unknown>;
}
