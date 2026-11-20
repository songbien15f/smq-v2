/**
 * The Guest assistant's wire shapes (plan G-g S10).
 *
 * ## What crosses the wire, and what must not
 *
 * A turn sends the **design** and the guest's sentence. It never sends the contact details: the
 * server refuses a body that carries them, and it strips anything that looks like an email or an
 * Australian mobile out of the text before a model sees it. No price ever comes back.
 *
 * ## Why the change set is validated here *and* in core
 *
 * This schema says the operations are well-formed (known kinds, numbers, enum values). Whether they
 * are *possible* — a bay wider than the book, a door the wall cannot hold — is `applyGuestOps`'s
 * answer, which needs the building type. Shape here, engineering there; the server runs both before
 * it answers.
 */

import { z } from 'zod';
import { AU_STATES } from './guest.js';

const mm = z.number().int().min(0).max(100_000);
const size = z.object({ width: mm, height: mm }).strict();
const wall = z.enum(['front', 'back', 'left', 'right']);
const openingKind = z.enum(['roller_door', 'pa_door', 'sliding_door', 'window']);

/** One design operation. Kept in step with `GuestOp` in `@sq/core/domain` by an assert at the end. */
export const guestOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('setSpan'), mm }).strict(),
  z.object({ op: z.literal('setHeight'), mm }).strict(),
  z.object({ op: z.literal('setPitch'), degrees: z.number().min(0).max(45) }).strict(),
  z.object({ op: z.literal('setRoof'), roof: z.enum(['gable', 'skillion']) }).strict(),
  z.object({ op: z.literal('setSlab'), slab: z.enum(['in_slab', 'on_slab', 'footing_only']) }).strict(),
  z
    .object({ op: z.literal('setKneeBrace'), kneeBrace: z.enum(['standard', 'none_if_possible']) })
    .strict(),
  z.object({ op: z.literal('setCladding'), cladding: z.enum(['vertical', 'horizontal']) }).strict(),
  z.object({ op: z.literal('addBay'), atIndex: z.number().int().min(0).max(12).optional() }).strict(),
  z.object({ op: z.literal('setBayWidth'), index: z.number().int().min(0).max(11), mm }).strict(),
  z.object({ op: z.literal('removeBay'), index: z.number().int().min(0).max(11) }).strict(),
  z
    .object({ op: z.literal('addOpening'), kind: openingKind, wall, size, offset: mm.optional() })
    .strict(),
  z.object({ op: z.literal('removeOpening'), index: z.number().int().min(0).max(19) }).strict(),
  z
    .object({ op: z.literal('moveOpening'), index: z.number().int().min(0).max(19), wall, offset: mm })
    .strict(),
  z
    .object({
      op: z.literal('resizeOpening'),
      index: z.number().int().min(0).max(19),
      size,
    })
    .strict(),
  /*
   * `roofColour` and not `roof`: `setRoof` already means the roof *shape*, and a strict JSON schema can
   * only carry one meaning per name. Fields may be `null` because Structured Outputs cannot omit an
   * optional property — the server strips the nulls before this schema sees them (see
   * `dropNulls` in `lib/guestAssistant.ts`).
   */
  z
    .object({
      op: z.literal('setColours'),
      walls: z.string().max(40).nullable().optional(),
      roofColour: z.string().max(40).nullable().optional(),
      trim: z
        .object({
          barge: z.string().max(40).nullable().optional(),
          gutter: z.string().max(40).nullable().optional(),
          downpipe: z.string().max(40).nullable().optional(),
        })
        .strict()
        .nullable()
        .optional(),
    })
    .strict(),
  z.object({ op: z.literal('setType'), typeId: z.string().max(64) }).strict(),
]);
export type GuestOpWire = z.infer<typeof guestOpSchema>;

/** The site the assistant may fill in from a sentence ("it's going in Ballarat, 3350"). */
export const guestSitePatchSchema = z
  .object({
    suburb: z.string().trim().min(1).max(80),
    state: z.enum(AU_STATES),
    postcode: z.string().regex(/^\d{4}$/),
  })
  .strict();

/** What the model is asked to return, as a JSON schema (`response_format`). */
export const ASSISTANT_REPLY_SHAPE = 'guest_assistant_reply';

export const guestAssistantTurnRequest = z
  .object({
    /** The conversation so far, oldest first. The server caps how much of it reaches the model. */
    message: z.string().trim().min(1).max(1000),
    /** The design as the page has it now — the assistant must see edits the guest made by hand. */
    design: z.unknown(),
    /** Which type the design is for, so the server can apply the change set against its limits. */
    typeId: z.string().min(1).max(64),
    /**
     * The wind region the page is showing, as a **letter** (A–D) or `null`.
     *
     * A letter, never a coordinate: it is the derived value step ① already displays, and the model
     * needs it to explain a cyclonic finding. Coordinates never leave the server.
     */
    region: z.enum(['A', 'B', 'C', 'D']).nullable().optional(),
    /**
     * Text the model answered with. Echoed back so the session's transcript reads correctly; the
     * server still stores its own copy.
     */
    history: z
      .array(z.object({ role: z.enum(['guest', 'assistant']), text: z.string().max(4000) }).strict())
      .max(40)
      .optional(),
    /** Where the assistant should stay out of: `Design` is the only place it may write. */
    website: z.string().max(200).optional(),
  })
  .strict();
export type GuestAssistantTurnRequest = z.infer<typeof guestAssistantTurnRequest>;

/** One line of the transcript as the page renders it. */
export interface GuestAssistantMessage {
  role: 'guest' | 'assistant';
  text: string;
}

export interface GuestAssistantTurnResponse {
  /** What the assistant said. Plain text; the page renders it as text, never as HTML. */
  message: string;
  /** Operations the server applied, in order. Empty when the sentence asked a question. */
  ops: GuestOpWire[];
  /** The design **after** those operations — the page replaces its own copy with this. */
  design: unknown;
  /** Operations that could not be applied, with the reason to show the guest. */
  failures: { index: number; reason: string }[];
  /** A change big enough that a person should agree to it before it is applied. */
  needsConfirm: boolean;
  /** True when the assistant is switched off or out of quota: the page shows its "unavailable" strip. */
  unavailable?: boolean;
}
