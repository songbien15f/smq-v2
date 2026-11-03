/**
 * Deterministic fallback parser.
 *
 * When the AI gateway is unavailable, the app still has to turn a typed
 * sentence into a config. `parseShedText` is a best-effort, purely local
 * alternative: case-insensitive regexes that recognise the common phrasings of
 * a shed description and return only the fields they actually found, as a
 * `Partial<ShedConfig>` the caller can merge over the current config.
 *
 * It never throws. Unrecognised text yields `{}`. Because the result is partial
 * and is merged over an existing config, unrecognised fields are simply left
 * alone rather than guessed.
 *
 * Pure TypeScript: imports only sibling domain modules. No React, Next.js,
 * Zustand, Konva, or three.
 */

import { clampBays } from './bays';
import { parseDimension } from './units';
import type { AlignMode, Opening, OpeningType, ShedConfig, SwingDirection, WallSide } from './types';

/**
 * A number followed by an optional unit and a dimension keyword. The keyword
 * decides which field the value fills.
 */
const DIMENSION_RE =
  /(\d+(?:\.\d+)?)\s*(mm|m|metres?|meters?)?\s*\b(wide|width|long|length|deep|high|height)\b/gi;

/** `N bays`, e.g. "4 bays" / "4 bay". */
const BAYS_RE = /(\d+)\s*bays?\b/i;

/** "15 degree roof pitch" / "roof pitch of 15". */
const PITCH_BEFORE_RE = /(\d+(?:\.\d+)?)\s*(?:degrees?|degs?|°)\s*(?:roof\s*)?pitch/i;
const PITCH_AFTER_RE = /roof\s*pitch\s*(?:of\s*)?(\d+(?:\.\d+)?)/i;

/** Every door/window keyword, longest alternatives first so matches are exact. */
const OPENING_RE =
  /(personal\s+access\s+doors?|roller\s+doors?|sliding\s+doors?|pa\s+doors?|roller|windows?)/gi;

/** `4.2 x 3.6`, with an optional unit on either side. */
const SIZE_RE = /(\d+(?:\.\d+)?)\s*(mm|m)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mm|m)?/i;

/** A wall name, used only near a door keyword. */
const WALL_RE = /\b(front|back|left|right)\b/i;

/**
 * "centre" / "center" / "centred" / "centered" / "middle" → the centre
 * alignment. Exported so its behaviour can be pinned directly: `align` defaults
 * to `'center'` when nothing matches, so a parse-level assertion cannot tell a
 * matching pattern from a broken one. The optional `(?:ed|d)?` suffix is what
 * lets the US "centered" through — a bare `\b…d?\b` leaves the trailing "ed"
 * unaccounted for.
 */
export const CENTRE_RE = /\b(cent(?:re|er)(?:ed|d)?|middle)\b/i;

/** Swing sense. */
const SWING_RE = /\b(inward|outward)\b/i;

/** "500mm from the corner" → a wall-local offset. */
const OFFSET_RE = /(\d+)\s*mm\s*from\s+the\s+corner/i;

/** Map a matched keyword to the trailing keyword's field name. */
function fieldForKeyword(keyword: string): 'span' | 'length' | 'height' | undefined {
  switch (keyword.toLowerCase()) {
    case 'wide':
    case 'width':
      return 'span';
    case 'long':
    case 'length':
    case 'deep':
      return 'length';
    case 'high':
    case 'height':
      return 'height';
    default:
      return undefined;
  }
}

/** Map a matched door/window keyword to an `OpeningType`. */
function openingTypeForKeyword(keyword: string): OpeningType {
  const k = keyword.toLowerCase();
  if (k.startsWith('personal') || k.startsWith('pa')) return 'pa_door';
  if (k.startsWith('roller')) return 'roller_door';
  if (k.startsWith('sliding')) return 'sliding_door';
  return 'window';
}

/**
 * Parse a captured number, honouring an explicit suffix when present and
 * otherwise applying the same metric-drift heuristic the config guard uses: a
 * bare value under 100 is metres, anything else is millimetres. This lets
 * "4.2 x 3.6" read as 4200 x 3600 while "900 x 2100" stays in millimetres.
 */
function parseCapturedDimension(raw: string, suffix: string | undefined): number {
  if (suffix) return parseDimension(`${raw} ${suffix}`, 'mm');
  const value = Number.parseFloat(raw);
  return parseDimension(raw, value < 100 ? 'm' : 'mm');
}

/** The two text regions belonging to one door keyword. `after` runs from the end
 * of the keyword to the next door keyword; `before` runs from the start of the
 * text to the keyword, but only for the *first* keyword — for later ones it is
 * empty so an earlier opening's size/wall cannot leak in. Properties are
 * searched in `after` first (the usual "roller door 4.2 x 3.6" order) and then
 * in `before` ("a 4.2 x 3.6 roller door"). */
function doorSegments(
  text: string,
): Array<{ type: OpeningType; after: string; before: string }> {
  const matches = [...text.matchAll(OPENING_RE)];
  return matches.map((match, i) => {
    const keywordStart = match.index ?? 0;
    const keywordEnd = keywordStart + match[0].length;
    const nextStart = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    return {
      type: openingTypeForKeyword(match[0]),
      after: text.slice(keywordEnd, nextStart),
      before: i === 0 ? text.slice(0, keywordStart) : '',
    };
  });
}

/** The first match of `re` in `after`, else in `before`. `re` must not be global
 * so its `lastIndex` carries no state between calls. */
function pick(re: RegExp, after: string, before: string): RegExpExecArray | null {
  return re.exec(after) ?? re.exec(before);
}

/** Build one opening from the text regions around its door keyword. */
function openingFromSegment(
  type: OpeningType,
  after: string,
  before: string,
  index: number,
): Opening {
  const size = pick(SIZE_RE, after, before);
  const width = size ? parseCapturedDimension(size[1], size[2]) : type === 'window' ? 900 : 1000;
  const height = size ? parseCapturedDimension(size[3], size[4]) : type === 'window' ? 900 : 2100;

  const wallMatch = pick(WALL_RE, after, before);
  const wall: WallSide = (wallMatch?.[1].toLowerCase() as WallSide | undefined) ?? 'front';

  const offsetMatch = pick(OFFSET_RE, after, before);
  const offset = offsetMatch ? Number.parseInt(offsetMatch[1], 10) : null;

  const swingMatch = pick(SWING_RE, after, before);
  const swing: SwingDirection = swingMatch
    ? (swingMatch[1].toLowerCase() as SwingDirection)
    : null;

  let align: AlignMode = 'center';
  if (offset !== null) align = 'custom';
  else if (CENTRE_RE.test(after) || CENTRE_RE.test(before)) align = 'center';

  const sill = type === 'window' ? 900 : 0;

  return { id: `fb-${index + 1}`, type, width, height, sill, wall, align, offset, swing, track: null };
}

/**
 * Best-effort parse of a free-text shed description into a partial config.
 *
 * Recognises overall dimensions (width/length/height), bay count, roof pitch,
 * structure type, and doors/windows with their size, wall, alignment, swing,
 * and offset. Returns only the keys it found; returns `{}` for text it cannot
 * read. Never throws.
 */
export function parseShedText(text: string): Partial<ShedConfig> {
  const result: Partial<ShedConfig> = {};
  if (typeof text !== 'string' || text.length === 0) return result;

  try {
    // Overall dimensions: the last mention of each field wins.
    for (const match of text.matchAll(DIMENSION_RE)) {
      const field = fieldForKeyword(match[3]);
      if (!field) continue;
      try {
        result[field] = parseCapturedDimension(match[1], match[2]);
      } catch {
        // Unreadable number; ignore this mention and keep scanning.
      }
    }

    const bays = BAYS_RE.exec(text);
    if (bays) result.bays = clampBays(Number.parseInt(bays[1], 10));

    const pitch = PITCH_BEFORE_RE.exec(text) ?? PITCH_AFTER_RE.exec(text);
    if (pitch) {
      const deg = Number.parseFloat(pitch[1]);
      if (Number.isFinite(deg)) result.roofPitchDeg = Math.min(45, Math.max(0, deg));
    }

    if (/\bskillion\b/i.test(text)) result.structureType = 'skillion';
    else if (/\bgable\b/i.test(text)) result.structureType = 'gable';

    const segments = doorSegments(text);
    if (segments.length > 0) {
      const openings: Opening[] = [];
      for (const { type, after, before } of segments) {
        try {
          openings.push(openingFromSegment(type, after, before, openings.length));
        } catch {
          // A malformed fragment is skipped rather than aborting the parse.
        }
      }
      if (openings.length > 0) result.openings = openings;
    }
  } catch {
    // Defensive: a fallback parser must never throw. Return whatever we have.
  }

  return result;
}
