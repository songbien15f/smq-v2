/**
 * The shed vocabulary the speech-to-text step is given, and the checks that keep a transcript in scope.
 *
 * ## Why this exists at all
 *
 * A general-purpose recogniser hears "roller door" as "role a door" and "skillion" as "sky lion",
 * and it has no reason to prefer shed words over the words of an everyday sentence. Its `prompt`
 * parameter is the only lever a server-side STT call has, so the prompt carries a sentence of shed
 * English plus the vocabulary of the building type in front of the visitor.
 *
 * ## Why the checks do not call the model again
 *
 * A second model call to ask "is this about a shed?" costs money and can disagree with itself between
 * two identical sentences. A fixed word list plus a number-with-a-unit pattern is cheap, predictable
 * and testable, and the chat turn (`SYSTEM_PROMPT`, plan G-g) is the real scope guard: this only
 * decides whether to say "I can only help with the shed design" under the composer.
 *
 * ## Nothing here sees personal data
 *
 * The prompt names colours and dimensions, never a visitor's words. The transcript is redacted by
 * `redact()` before it leaves the API, not here — one redaction path for typed and spoken text alike.
 */

import type { GuestBuildingTypeSpec } from '@sq/core/domain';

/**
 * The words a shed request is made of.
 *
 * Deliberately broad and flat: the check is "does this sentence use the vocabulary of the task", not
 * a grammar. Multi-word terms are matched as phrases, so "roller" alone does not pass but "roller
 * door" does.
 */
const SHED_TERMS: readonly string[] = [
  'shed',
  'garage',
  'carport',
  'barn',
  'workshop',
  'span',
  'width',
  'wide',
  'length',
  'long',
  'height',
  'high',
  'tall',
  'bay',
  'bays',
  'metre',
  'metres',
  'meter',
  'meters',
  'millimetre',
  'millimetres',
  'millimeter',
  'millimeters',
  'roof',
  'gable',
  'skillion',
  'pitch',
  'degrees',
  'degree',
  'slab',
  'footing',
  'knee brace',
  'cladding',
  'vertical',
  'horizontal',
  'wall',
  'front',
  'back',
  'left',
  'right',
  'roller door',
  'pa door',
  'personal access door',
  'sliding door',
  'window',
  'motorised',
  'motorized',
  'colour',
  'color',
  'colorbond',
  'trim',
  'barge',
  'gutter',
  'downpipe',
  'add',
  'remove',
  'delete',
  'move',
  'bigger',
  'smaller',
  'larger',
  'centre',
  'center',
  'middle',
];

/**
 * The phrase list, longest first, so "personal access door" is tried before "pa door" and one
 * replacement cannot cut another one out of the sentence.
 */
const SHED_PHRASES = [...SHED_TERMS].sort((a, b) => b.length - a.length);

/**
 * Corrections for the mishearings a shed vocabulary actually produces.
 *
 * Only whole-word matches, case-insensitive, so "role" in another context is not rewritten twice.
 * Each pattern is written out rather than built from the plain word so an apostrophe or a space in the
 * misheard form is explicit.
 */
const HEARD_WRONG: ReadonlyArray<{ pattern: RegExp; term: string }> = [
  { pattern: /\b(?:role a door|roll a door|rolled a door|roller dor|roll door)\b/gi, term: 'roller door' },
  { pattern: /\b(?:role door|rolling door)\b/gi, term: 'roller door' },
  { pattern: /\b(?:p ?a door|pee a door|pea door)\b/gi, term: 'PA door' },
  { pattern: /\b(?:sky lion|skill ion|skillion roof sky)\b/gi, term: 'skillion' },
  { pattern: /\b(?:colour bond|color bond|colourbond)\b/gi, term: 'Colorbond' },
  { pattern: /\b(?:meters|meter)\b/gi, term: 'metres' },
  { pattern: /\b(?:milli ?meters?|milli ?metres?)\b/gi, term: 'millimetres' },
  { pattern: /\b(?:knee bracing|knee braces)\b/gi, term: 'knee brace' },
  { pattern: /\b(?:down pipe|down piper)\b/gi, term: 'downpipe' },
  { pattern: /\b(?:gutter ing|gutters)\b/gi, term: 'gutter' },
  { pattern: /\b(?:motorized|motorised door)\b/gi, term: 'motorised' },
];

/** The type's colours, as one comma-separated line — nothing that a model turns into a request. */
function colourList(type: GuestBuildingTypeSpec): string {
  return type.config.colours.allowed.join(', ');
}

/**
 * The `prompt` for one transcription.
 *
 * Whisper (and models that copy its interface) reads only the last ~224 tokens of a prompt, so this is
 * ordered most-useful first — the example sentence, then the colours — and capped at 900 characters.
 * It carries the building type's name and colours because those are the words a visitor is most likely
 * to say and the recogniser is least likely to know.
 */
export function shedSttPrompt(type: GuestBuildingTypeSpec): string {
  const example =
    'Shed design request: make it 9 metres wide, add a 3 metre roller door on the front wall, Colorbond Monument roof.';
  const vocabulary =
    'Words used: shed, garage, carport, span, width, length, height, bays, metres, millimetres, roof, gable, skillion, pitch, slab, footing, knee brace, cladding, wall, front, back, left, right, roller door, PA door, sliding door, window, motorised, colour, Colorbond, trim, barge, gutter, downpipe, add, remove, move, bigger, smaller, centre.';
  const prompt = [
    `Building type: ${type.name}.`,
    example,
    vocabulary,
    `Colours: ${colourList(type)}.`,
  ].join(' ');

  if (prompt.length <= 900) return prompt;
  // Cut on a space so the prompt cannot end mid-word, and never exceed the cap.
  const cut = prompt.slice(0, 900);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}

/**
 * The transcript as the visitor would have typed it.
 *
 * Fixes the mishearings in `HEARD_WRONG`, collapses runs of whitespace and trims. Case is preserved
 * otherwise: "Colorbond Monument" came back with its capitals and losing them would look like our bug.
 */
export function normaliseShedTranscript(text: string): string {
  let next = text;
  for (const { pattern, term } of HEARD_WRONG) next = next.replace(pattern, term);
  return next.replace(/\s+/g, ' ').trim();
}

/** A number with a unit, which a shed sentence almost always has and a general sentence rarely does. */
const NUMBER_WITH_UNIT = /\b\d+(?:\.\d+)?\s?(?:m|mm|metres?|meters?|metre|meter|millimetres?|millimeters?)\b/i;

/**
 * Whether `text` is about a shed at all.
 *
 * Runs on the already-normalised, already-redacted transcript. `true` when it uses one shed term or
 * carries a dimension; `false` for an empty string and for an unrelated sentence. This is a hint for
 * the composer, not a gate: an off-topic transcript still reaches the input so the visitor can edit it,
 * and the chat turn's own system prompt is what stops the model answering it.
 */
export function isShedTopic(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  if (NUMBER_WITH_UNIT.test(trimmed)) return true;

  const lower = ` ${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  return SHED_PHRASES.some((term) => lower.includes(` ${term} `));
}
