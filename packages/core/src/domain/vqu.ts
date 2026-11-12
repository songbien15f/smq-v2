/**
 * The `.vqu` export: a quote in the shape the external BOM tool reads.
 *
 * Ported from `smq-code-smartquote/Modules/Main/SmartQuote.Module.Main/Data/ExportFileVQU.cs`.
 * The format is an INI-like text file written in **ISO-8859-1** with three sections in a fixed
 * order: `[QUOTE DETAILS]`, `[SHED DETAILS]`, `[OPTIONS]`.
 *
 * Two things are easy to get wrong and both change what the tool builds:
 *
 * - Colours are **names** (`Shale Grey`), not hex. The caller resolves them through the price
 *   book; this module never sees a `#rrggbb`.
 * - The footing code is translated to the label the tool expects. Writing `CHEMSET` where it
 *   reads `Chemset` is a different footing to the tool.
 *
 * Pure TypeScript: the route does the file encoding.
 */

import { sheetingSpec } from './sheeting';
import type { ShedConfig, ShedColors } from './types';

/** Everything the file states. */
export interface VquInput {
  quoteNumber: string;
  customer: {
    name: string;
    postcode: string;
    siteStreet: string;
    siteState: string;
    siteSuburb: string;
    sitePostcode: string;
  };
  config: ShedConfig;
  /** Colour **names**, resolved from the book by the caller. */
  colors: Pick<
    ShedColors,
    | 'wall'
    | 'roof'
    | 'barge'
    | 'gutter'
    | 'downpipe'
    | 'rollerDoor'
    | 'slidingDoor'
    | 'window'
    | 'paDoor'
    | 'dividingWall'
  >;
  /** The `misc_option` names on the quote. */
  miscOptions: string[];
}

/** The desktop's footing-code labels. Anything else is written as it is. */
const FOOTING_LABELS: Record<string, string> = {
  CAST_IN_STRAP: 'Cast-in Strap',
  CHEMSET: 'Chemset',
  DYNABOLT: 'Dynabolt',
  HD_BOLTS: 'HD Bolts',
  HD_BOLT: 'HD Bolts',
  POST_IN_GROUND: 'Post in Ground',
  RIGID_BRACKET: 'Rigid Bracket',
};

function footingLabel(code: string): string {
  return FOOTING_LABELS[code.toUpperCase()] ?? code;
}

/** `STEEL` is written `Steel`; every other downpipe style is its own name. */
function downpipeStyle(code: string): string {
  return code.toUpperCase() === 'STEEL' ? 'Steel' : code;
}

/** The boilerplate flags the desktop writes as `True`/`False`. */
function flag(value: boolean): string {
  return value ? 'True' : 'False';
}

export function buildVqu(input: VquInput): string {
  const { config, colors, customer } = input;
  const lines: string[] = [];

  lines.push('[QUOTE DETAILS]');
  lines.push(`QuoteNumber=${input.quoteNumber}`);
  lines.push(`PostCode=${customer.postcode}`);
  lines.push(`SiteStreet=${customer.siteStreet}`);
  lines.push(`SiteState=${customer.siteState}`);
  lines.push(`SiteSuburb=${customer.siteSuburb}`);
  lines.push(`SitePostCode=${customer.sitePostcode}`);
  lines.push(`Name=${customer.name}`);
  lines.push('');

  lines.push('[SHED DETAILS]');
  lines.push(`TypeOfStructure=${config.structureType}`);
  lines.push(`WindRegion=${config.windRegion}`);
  lines.push(`TerrainCategory=${config.terrainCategory}`);
  lines.push(`BaseType=${config.footingType}`);
  lines.push(`BaySize=${config.nomBaySpacing}`);
  lines.push(`NumofBays=${config.bays}`);
  lines.push(`Footings=${footingLabel(config.footingType)}`);
  // The desktop's own joined form (`'0.42 TL-5'`), which is what its reader splits back apart.
  // Writing a bare profile would lose the thickness the quote was priced at.
  lines.push(`WallSheet=${sheetingSpec(config.wallProfile, config.wallBmt ?? 0.42)}`);
  lines.push(`RoofSheet=${sheetingSpec(config.roofProfile, config.roofBmt ?? 0.42)}`);
  lines.push(`DownpipeStyle=${downpipeStyle(config.downpipeType)}`);
  lines.push(`WidthSpan=${config.span}`);
  lines.push(`Height=${config.height}`);
  lines.push(`RoofPitch=${config.roofPitchDeg}`);
  lines.push(`WallColour=${colors.wall}`);
  lines.push(`DoorColour=${colors.rollerDoor}`);
  lines.push(`RoofColour=${colors.roof}`);
  lines.push(`DownpipeColour=${colors.downpipe}`);
  lines.push(`TrimColour=${colors.barge}`);
  lines.push(`GutterColour=${colors.gutter}`);
  lines.push(`SLDoorColour=${colors.slidingDoor}`);
  lines.push(`WindowColour=${colors.window}`);
  lines.push(`DivwallColour=${colors.dividingWall}`);
  lines.push(`PADoorColour=${colors.paDoor}`);
  lines.push(`ForceOpenDesign=${config.internalPressure}`);
  lines.push(`OpenBaySide1=${flag(config.sideOpening.front)}`);
  lines.push(`OpenBaySide2=${flag(config.sideOpening.back)}`);
  lines.push(`OpenBayEnd1=${flag(config.endOpening.left)}`);
  lines.push(`OpenBayEnd2=${flag(config.endOpening.right)}`);
  lines.push('');

  lines.push('[OPTIONS]');
  /*
   * The desktop writes `width / doorWidth` for a sliding door on each end wall. v2 keeps the
   * door's own width, so the count is the same arithmetic per door.
   */
  const endDoors = (side: 'left' | 'right'): number =>
    config.openings
      .filter((opening) => opening.type === 'sliding_door' && opening.wall === side)
      .reduce((total, opening) => total + Math.max(1, Math.round((config.length ?? 0) / opening.width)), 0);
  lines.push(`SLDoorEndCount_1=${endDoors('left')}`);
  lines.push(`SLDoorEndCount_2=${endDoors('right')}`);
  lines.push('');

  lines.push(`NumMiscOptions=${input.miscOptions.length}`);
  input.miscOptions.forEach((name, index) => {
    lines.push(`MiscOption${index + 1}=${name}`);
  });

  return lines.join('\n');
}
