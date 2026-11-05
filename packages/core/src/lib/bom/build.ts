/**
 * The BOM assembly: every group, merged, with the totals a price needs.
 *
 * The order matters and is not arbitrary. The frame optimisation runs first
 * because every other group reads its row counts and spans. Then the groups run,
 * then the options, then the merge.
 *
 * **Merging** is by `code|unit` within a group. Two contributions of the same
 * material — a purlin that appears on both roof runs, a bracket family used at
 * two connections — become one line whose quantity is the sum, and whose amount
 * is recomputed from that sum. That is one rounding per line instead of one per
 * contributing piece, which is the difference between a quote and an estimate.
 * A mocked line is never merged into a priced one: `MOCK` is a sentinel code, so
 * the merge key keeps them apart automatically.
 *
 * **The two totals** follow the desktop: `buildingCost` is the eleven material
 * groups, `totalCost` adds `misc`. Only `totalCost` is used to set a price, which
 * is why a misc line cannot be forgotten at the margin step.
 *
 * **Determinism** matters because a saved revision stores the BOM it priced. The
 * same config and the same book must produce byte-identical output, so nothing
 * here iterates a `Set`, a `Map` insertion order that depends on object identity,
 * or `Object.keys` of a hash.
 */

import type { ShedConfig } from '@/domain/types';
import type { PriceLookup } from '@/lib/pricing/types';
import { optimise } from './optimise';
import {
  buildingInfillColumns,
  frameLines,
  frameMemberSchedule,
  type FrameMember,
} from './groups/frame';
import { buildPunchingPages, type PunchPage, type PunchSource } from './punchings';
import { infillOverrideRefusal } from '@/domain/placementRules';
import { resolveOpeningPlacement } from '@/domain/placement';
import { purlinLines } from './groups/purlin';
import { flashingLines, gutterLines } from './groups/gutter';
import { sheetingGroup, isOpenStructure } from './groups/sheeting';
import { bracketLines, flatFlyLines } from './groups/bracket';
import { bracingLines } from './groups/bracing';
import { fixingLines } from './groups/fixings';
import { optionLines } from './options';
import { openingLines } from './openings';
import { miscOptionLines } from './groups/misc';
import { safeCall } from './safe';
import { DEFAULT_BOM_RULES, type BomRules } from './rules';
import { DEFAULT_CONTRACTS } from '@/lib/pricing/catalogueManifest';
import type { MaterialUnitContract } from '@/lib/pricing/catalogueManifest';
import type {
  EstimateIssue,
  EstimateStatus,
  MaterialEvidence,
} from '@/lib/estimating/types';
import { classifyEstimate } from '@/lib/estimating/issues';

import {
  BOM_GROUP_ORDER,
  bomLine,
  type BomGroup,
  type BomGroupId,
  type BomLine,
  type BomResult,
  type OptimisedFrame,
} from './types';

/**
 * Merge lines that are the same material in the same group.
 *
 * The key is `code | unit | description`, and the description is load-bearing:
 * it carries the cut length (`Roof sheeting — 0.42 Corro, 6173 mm`) and the
 * member's role (`Main rafter`). Two sheets of the same profile cut to 6173 and
 * 4235 mm are not one product, and a column is not a rafter even when both come
 * off the same length of SHS. Merging on code alone would order one length and
 * bill it at the other's price.
 *
 * The first occurrence decides the order; later ones add their quantity and
 * mass. The amount is recomputed from the merged quantity so the line is rounded
 * once, not once per contribution.
 */
export function mergeLines(lines: BomLine[]): BomLine[] {
  const merged = new Map<string, BomLine>();

  for (const line of lines) {
    // The unit cost is part of the identity. Two lines for the same product at
    // two rates are two different quotes of the same item — one from the book,
    // one from an assumption — and summing their quantities would apply the
    // wrong rate to half of them.
    const key = `${line.code}|${line.unit}|${line.description}|${line.unitCost}`;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, { ...line });
      continue;
    }
    const quantity = existing.quantity + line.quantity;
    merged.set(
      key,
      bomLine({
        group: existing.group,
        code: existing.code,
        description: existing.description,
        unit: existing.unit,
        quantity,
        unitCost: existing.unitCost,
        massKg: existing.massKg + line.massKg,
        mocked: existing.mocked === true || line.mocked === true,
      }),
    );
  }

  return [...merged.values()];
}

/** One group with its lines merged. */
function group(id: BomGroupId, label: string, lines: BomLine[]): BomGroup {
  return { id, label, lines: mergeLines(lines) };
}

/** A bill of materials with the issues and evidence that produced it. */
export interface BomWithEvidence {
  bom: BomResult;
  issues: EstimateIssue[];
  materials: MaterialEvidence[];
  status: EstimateStatus;
  /**
   * The frame cut list the workshop builds from.
   *
   * Carried beside the BOM rather than derived from it: a priced frame line is
   * metres of steel, and metres cannot be turned back into "six columns 6 188 mm
   * long". It is computed from the same optimised frame and the same rules, so the
   * two describe one building.
   */
  members: FrameMember[];
  /**
   * The punching sheets: where each frame member's holes go.
   *
   * Empty when the book cannot name the connectors for this building's sections
   * — see `buildPunchingPages`. An empty list is a sheet that is not printed; a
   * guessed offset is a member that is cut and welded wrong.
   */
  punchings: PunchPage[];
}

/**
 * The assumptions this engine makes that no price can remove.
 *
 * Each is a design decision with no field behind it yet, so it is stated once
 * here and travels with every quote. They are what makes a fully priced quote
 * still *indicative*: a reader who sees a firm number and no caveat has been
 * told something untrue about the frame.
 */
function standingAssumptions(shed: ShedConfig, frame: OptimisedFrame): EstimateIssue[] {
  const issues: EstimateIssue[] = [];

  // The frame assumption is only true when the book has no structure-to-section
  // table. With one, every member takes the section the book names for this span
  // and the assumption would be a lie about a number that is now real.
  if (frame.scheduleMissing) {
    issues.push({
      code: 'FRAME_SECTION_ASSUMED',
      severity: 'assumption',
      message:
        'Every frame member is priced as 100 x 100 x 2.0 SHS. This price book has no structure-to-section table, so a wide portal is priced as light steel.',
      field: 'span',
    });
  }

  issues.push({
    code: 'FOOTING_ASSUMED',
    severity: 'assumption',
    message:
      'The quote does not say whether the columns are cast in the ground or bolted to a slab, so the column length uses one footing assumption for every column.',
    field: 'height',
  });

  // Wall girts priced from the purlin row. The reference book lists no girt material at
  // all, so this fires on every enclosed building — which is the point: the amounts are
  // real catalogue figures for the wrong member, and a quote that presents them without
  // saying so claims a precision it does not have.
  //
  // Suppressed for an open structure. A carport has no walls and therefore emits no
  // girts, and a caveat about a line that does not exist trains the reader to skip the
  // whole list.
  if (!frame.girtMaterialSeparate && !isOpenStructure(shed)) {
    issues.push({
      code: 'GIRT_PRICE_FROM_PURLIN',
      severity: 'assumption',
      message:
        'Wall girts are priced from the roof purlin material, because this price book lists no girt material. A girt is a different section carrying a different load, so the wall amounts are an approximation.',
      field: 'height',
    });
  }

  if (shed.terrainCategory === 2.5) {
    issues.push({
      code: 'TERRAIN_SUBSTITUTED',
      severity: 'assumption',
      message:
        'Terrain category 2.5 is priced from the category 2 span table, because the price book has no rows for the desktop’s category 4 code.',
      field: 'terrainCategory',
    });
  }

  return issues;
}

/** The whole bill of materials for a shed. */
export function buildBom(
  shed: ShedConfig,
  lookup: PriceLookup,
  rules: BomRules = DEFAULT_BOM_RULES,
): BomResult {
  return buildBomWithEvidence(shed, lookup, DEFAULT_CONTRACTS, rules).bom;
}

/**
 * Build a bill of materials with its issues and evidence.
 *
 * `contracts` says what each price-book column is per. The default is the real
 * book's manifest; a test supplies a synthetic one, so the group code never
 * carries a unit constant of its own.
 */
export function buildBomWithEvidence(
  shed: ShedConfig,
  lookup: PriceLookup,
  contracts: Record<string, MaterialUnitContract> = DEFAULT_CONTRACTS,
  rules: BomRules = DEFAULT_BOM_RULES,
): BomWithEvidence {
  const frame = optimise(shed, lookup, rules);

  const byId = new Map<BomGroupId, BomLine[]>();
  const issues: EstimateIssue[] = [...standingAssumptions(shed, frame)];
  const materials: MaterialEvidence[] = [];

  byId.set('frame', frameLines(shed, frame, lookup, rules));
  byId.set('purlin', purlinLines(shed, frame, lookup, rules));
  const sheeting = sheetingGroup(shed, frame, lookup, contracts.sheeting, rules);
  byId.set('sheeting', sheeting.lines);
  issues.push(...sheeting.issues);
  materials.push(...sheeting.materials);
  byId.set('gutter', gutterLines(shed, frame, lookup, rules));
  byId.set('flashing', flashingLines(shed, frame, lookup, rules));
  byId.set('bracket', bracketLines(shed, frame, lookup, rules));
  byId.set('flatfly', flatFlyLines(shed, frame, lookup, rules));
  byId.set('bracing', bracingLines(shed, frame, lookup, rules));

  // Bolts and screws share one module because they share the pack rule, but they
  // are two sections in the document.
  const fixings = fixingLines(shed, frame, lookup, rules);
  byId.set('bolt', fixings.filter((line) => line.group === 'bolt'));
  byId.set('screw', fixings.filter((line) => line.group === 'screw'));

  // Doors and windows share the option section: they are added items on a quote,
  // and separating them would make a reader hunt for the door they asked for.
  const openings = openingLines(shed, lookup);
  const options = optionLines(shed, frame, lookup, rules);
  byId.set('option', [...openings, ...options]);

  // Every other group's evidence is stated once per group rather than per line:
  // the unit contract belongs to the material kind, and a reader needs to know
  // that sheeting is priced per metre, not that eleven lines each are.
  //
  // `bracket`, `flatfly` and `bracing` used to be labelled `option`, whose source
  // key is `misc_option.price` — a table this build never reads. So a bracket line
  // recorded provenance naming a price it was not priced from, which is worse than
  // recording nothing: it is a wrong answer to "why is this line this price?".
  // Each now names the material it is actually read from.
  const kindByGroup: Partial<Record<BomGroupId, keyof typeof contracts>> = {
    frame: 'frame',
    purlin: 'purlin',
    gutter: 'gutter',
    flashing: 'flashing',
    bracket: 'bracket',
    flatfly: 'bracket',
    bracing: 'bracing',
    bolt: 'fixings',
    screw: 'fixings',
  };
  for (const [groupId, kind] of Object.entries(kindByGroup) as [
    BomGroupId,
    keyof typeof contracts,
  ][]) {
    const lines = byId.get(groupId) ?? [];
    const contract = contracts[kind];
    if (contract === undefined) continue;
    for (const line of lines) {
      materials.push({
        lineId: `${groupId}|${line.code}|${line.description}`,
        sourceKey: contract.sourceKey,
        priceBasis: contract.priceBasis,
        massBasis: contract.massBasis,
        status: contract.status,
      });
      // An `assumed` contract is exactly what makes a quote indicative, and it
      // has to be visible as an issue rather than only as a manifest row.
      if (contract.status === 'assumed') {
        issues.push({
          code: `UNIT_ASSUMED_${groupId.toUpperCase()}`,
          severity: 'assumption',
          message: `${line.description}: the price book's unit for this material is read as ${contract.priceBasis}, which the book does not state.`,
          lineId: `${groupId}|${line.code}|${line.description}`,
        });
      }
    }
  }

  // Option kinds whose material this build does not model. A skylight priced as
  // a steel roof sheet and a mezzanine priced at a fixed storage rate are
  // estimates, and the person quoting has to know which lines those are.
  for (const option of shed.options) {
    if (option.kind === 'skylight') {
      issues.push({
        code: 'SKYLIGHT_ASSUMED',
        severity: 'assumption',
        message:
          'The skylight is priced as a steel roof sheet: no polycarbonate rate is imported.',
      });
    }
    if (option.kind === 'mezzanine') {
      issues.push({
        code: 'MEZZANINE_RATE_ASSUMED',
        severity: 'assumption',
        message:
          'The mezzanine is priced at the lightest storage rate; this build has no floor-load field.',
      });
    }
  }

  // A door is priced from the catalogue, but the accessories around it — tracks,
  // mullions, jamb flashing — are not separately modelled, so the catalogue price
  // is doing work it may not cover.
  if (shed.openings.some((opening) => opening.type !== 'opening')) {
    issues.push({
      code: 'DOOR_ACCESSORIES_ASSUMED',
      severity: 'assumption',
      message:
        'Doors and windows are priced from the catalogue; door tracks, mullions and jamb flashing are assumed to be included in that price.',
    });
  }
  // The Charges tab is **not** material. A crane hire or a council permit is a
  // selling amount the operator typed, and it already includes whatever margin
  // and tax it should carry. Putting it in the BOM would run it through the
  // material margin and add GST a second time; the evaluator adds it once to the
  // contract instead (`sellingChargesCents`). The section still exists in the
  // document so a reader sees that nothing was silently dropped.
  //
  // **The ShedSafe fee is the one exception**, and it is not a charge: it is a
  // cost the supplier charges for the wind rating, it appears on every shed quote
  // in the market, and the book prices it (`misc_option` → `Shed Safe fee`, $15).
  // A quote that omits it does not save the customer $15 — it hides the fee and
  // recovers it out of the margin, which is the surprise the Charges tab exists
  // to prevent. So it is a priced line in `misc`, visible on the materials list,
  // and it flows through the margin like the steel it sits beside.
  const shedSafe = safeCall(() => lookup.miscOption('Shed Safe fee'));

  // The operator's own catalogue accessories sit beside the ShedSafe fee: they are
  // cost items the margin must recover, and the book prices each by name.
  const miscOptions = safeCall(() => miscOptionLines(shed, lookup)) ?? { lines: [], unknown: [] };
  for (const name of miscOptions.unknown) {
    issues.push({
      code: 'MISC_OPTION_UNKNOWN',
      severity: 'assumption',
      message: `“${name}” is not priced in the price book, so it is left out of the materials list. Choose another catalogue item or add it as a charge.`,
    });
  }

  byId.set('misc', [
    ...(shedSafe === undefined
      ? []
      : [
          bomLine({
            group: 'misc',
            code: shedSafe.code,
            description: 'ShedSafe wind rating fee',
            unit: 'ea',
            quantity: 1,
            unitCost: shedSafe.unitCost,
            massKg: 0,
          }),
        ]),
    ...miscOptions.lines,
  ]);

  // Every group appears, in the document's order, even when it is empty: a
  // section that vanishes makes a reader wonder whether something failed.
  const groups = BOM_GROUP_ORDER.map((entry) =>
    group(entry.id, entry.label, byId.get(entry.id) ?? []),
  );

  let buildingCost = 0;
  let miscCost = 0;
  let totalMassKg = 0;
  let mockedLines = 0;

  for (const section of groups) {
    for (const line of section.lines) {
      if (section.id === 'misc') miscCost += line.amount;
      else buildingCost += line.amount;
      totalMassKg += line.massKg;
      if (line.mocked === true) mockedLines += 1;
    }
  }

  // A line with no real price is a blocker in its own right: the quote cannot
  // stand on a number nobody can order.
  if (mockedLines > 0) {
    issues.push({
      code: 'MOCKED_LINES',
      severity: 'blocker',
      message: `${mockedLines} material line${mockedLines === 1 ? '' : 's'} could not be priced from the price book.`,
    });
  }

  // The cut list and the punch sheets are built from the same members, in that
  // order: a punch sheet names a member's section, so it cannot be drawn for a
  // member the cut list does not have.
  const members = frameMemberSchedule(shed, frame, lookup, rules);

  /*
   * R3 — a gable-end door standing where an infill column has to be.
   *
   * This is the one placement rule that needs the price book, so it lives here rather
   * than in the domain: the columns' positions come from the structure row, and the
   * domain module has no book to read. It is reported as an **assumption**, not a
   * blocker: the quote is still worth producing, but the gable's steel no longer
   * matches the wall it was designed for, and the reader has to know.
   */
  const columns = buildingInfillColumns(shed, frame, lookup, rules);
  if (columns.length > 0) {
    for (const opening of shed.openings) {
      const refusal = infillOverrideRefusal(
        shed,
        opening.wall,
        columns.map((column) => column.positionMm),
        safeCall(() => resolveOpeningPlacement(opening, shed).u) ?? 0,
        opening.width,
      );
      if (refusal !== null) {
        issues.push({
          code: 'DOOR_DISPLACES_INFILL_COLUMN',
          severity: 'assumption',
          message: refusal,
        });
      }
    }
  }
  const punchSource: PunchSource = {
    kneeEdge: (pitch) => safeCall(() => lookup.kneeEdge?.(pitch)),
    apex: (web, pitch) => safeCall(() => lookup.apex?.(web, pitch)),
    haunch: (web, pitch) => safeCall(() => lookup.haunch?.(web, pitch)),
  };

  return {
    bom: {
      groups,
      buildingCost,
      totalCost: buildingCost + miscCost,
      totalMassKg: Math.round(totalMassKg * 1000) / 1000,
      mockedLines,
    },
    issues,
    materials,
    status: classifyEstimate(issues),
    members,
    punchings: buildPunchingPages(members, punchSource, shed.roofPitchDeg),
  };
}
