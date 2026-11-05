import { describe, expect, it } from 'vitest';
import type { FrameMember } from '../groups/frame';
import { buildPunchingPages, type PunchSource } from '../punchings';

/**
 * The default shed: 12 000 span, 10° pitch, 4 200 walls, 4 bays.
 *
 * The sections are the book's own for that building — `C20015` for the portal
 * (web 20) and `C15012` for the end wall (web 15) — and the connector rows below
 * are the real book's rows for those sections at that pitch.
 */
const members: FrameMember[] = [
  {
    item: 'main_column',
    label: 'Main column',
    section: 'C20015',
    assumed: false,
    lengthMm: 4800,
    quantity: 6,
    web: 20,
    depth: 203,
  },
  {
    item: 'main_rafter',
    label: 'Main rafter',
    section: 'C20015',
    assumed: false,
    lengthMm: 6188,
    quantity: 6,
    web: 20,
    depth: 203,
  },
  {
    item: 'end_column',
    label: 'End wall column',
    section: 'C15012',
    assumed: false,
    lengthMm: 4800,
    quantity: 4,
    web: 15,
    depth: 152,
  },
  {
    item: 'end_rafter',
    label: 'End wall rafter',
    section: 'C15012',
    assumed: false,
    lengthMm: 6188,
    quantity: 4,
    web: 15,
    depth: 152,
  },
];

/** The book's rows for this building: `kneeedge`@10, `AP20-10`, `AP15-10`, `HP20-10`. */
const source: PunchSource = {
  kneeEdge: (pitch) => (pitch === 10 ? { kneeEdgeCode: 92, apex: 35, haunch: 35 } : undefined),
  apex: (web, pitch) => {
    if (pitch !== 10) return undefined;
    if (web === 20) return { r1: 300, r2: 0 };
    if (web === 15) return { r1: 150, r2: 0 };
    return undefined;
  },
  haunch: (web, pitch) => (pitch === 10 && web === 20 ? { e1: 92, e2: 258, e3: 0 } : undefined),
};

describe('buildPunchingPages', () => {
  it('makes one sheet for the gable end and one for the portal', () => {
    const pages = buildPunchingPages(members, source, 10);
    expect(pages).toHaveLength(2);
    expect(pages[0].left?.mark).toBe('C2');
    expect(pages[0].right?.mark).toBe('R2');
    expect(pages[1].left?.mark).toBe('C1');
    expect(pages[1].right?.mark).toBe('R1');
  });

  it('measures a bottom hole up from the near end and a top hole down from the far one', () => {
    // The desktop's `createColumn`: top holes accumulate from `length` downward,
    // bottom holes from zero upward. Reading them the other way round would put
    // the haunch connection at the base of every column.
    const [endPage] = buildPunchingPages(members, source, 10);
    const column = endPage.left!;
    expect(column.top.map((hole) => hole.positionMm)).toEqual([4708, 4616]);
    expect(column.top.map((hole) => hole.spacingMm)).toEqual([92, 92]);
    expect(column.bottom.map((hole) => hole.positionMm)).toEqual([45, 105]);
    expect(column.bottom.map((hole) => hole.spacingMm)).toEqual([45, 60]);
  });

  it('keeps what the desktop keeps between the two hole groups', () => {
    const [endPage] = buildPunchingPages(members, source, 10);
    // 4 800 − (92 + 92) − (45 + 60) = 4 511. This is the run a shear can cut
    // between, so it is a number the workshop reads off the sheet.
    expect(endPage.left!.remainingMm).toBe(4511);
  });

  it('uses the haunch offsets on a portal column and the apex ones on its rafter', () => {
    const [, portal] = buildPunchingPages(members, source, 10);
    // C1 top: the knee edge, then haunch E1 and E2 (E3 is zero, so no hole there).
    expect(portal.left!.top.map((hole) => hole.spacingMm)).toEqual([92, 92, 258]);
    // R1 top: the knee edge's *haunch* figure 35, then the same E1 and E2.
    expect(portal.right!.top.map((hole) => hole.spacingMm)).toEqual([35, 92, 258]);
    // R1 bottom: the apex figure, then AP20's R1 of 300 (its R2 is zero).
    expect(portal.right!.bottom.map((hole) => hole.spacingMm)).toEqual([35, 300]);
  });

  it('punches the end-wall rafter from the apex row for its own smaller section', () => {
    const [endPage] = buildPunchingPages(members, source, 10);
    // R2 is C15012 (web 15) so it takes AP15-10, whose R1 is 150 — not the portal
    // rafter's 300. One apex for both would over-punch the gable.
    expect(endPage.right!.bottom.map((hole) => hole.spacingMm)).toEqual([35, 150]);
  });

  it('takes the portal haunch for the end wall, as the desktop does', () => {
    // The desktop reads ONE haunch from the internal column and uses it for C1 and
    // C2 (`PunchingDetailForm.cs:100,139`), while the apex is looked up per rafter.
    // The haunch plate spans the knee of the portal, so it serves both members it
    // bolts to. A test would not catch this by accident: the lighter end-wall web
    // asks for `HP15-10`, whose d1 is 50, not the portal's 92.
    const [endPage] = buildPunchingPages(members, source, 10);
    expect(endPage.left!.top.map((hole) => hole.spacingMm)).toEqual([92, 92]);
    expect(endPage.right!.top.map((hole) => hole.spacingMm)).toEqual([35, 92]);
  });

  it('names the hole size and the centre the workshop sets the punch to', () => {
    const [endPage, portal] = buildPunchingPages(members, source, 10);
    expect(endPage.left!.holeSize).toBe('18x22');
    // A web of 10 mm takes a 60 mm centre; anything wider takes 90.
    expect(endPage.left!.centreMm).toBe(90);
    expect(portal.left!.centreMm).toBe(90);
  });

  it('marks which of the three screw lines each portal hole is punched on', () => {
    const [, portal] = buildPunchingPages(members, source, 10);
    for (const hole of portal.left!.top) expect(hole.screwLines).toEqual([1, 3]);
  });

  it('gives back nothing when the book has no connector table', () => {
    // A book without `kneeedge`/`cost_apex`/`cost_haunch` cannot say where a hole
    // goes. An empty list is honest; a guessed offset is a wrong part.
    const empty: PunchSource = {
      kneeEdge: () => undefined,
      apex: () => undefined,
      haunch: () => undefined,
    };
    expect(buildPunchingPages(members, empty, 10)).toEqual([]);
  });

  it('gives back nothing when a connector the sheet needs is missing', () => {
    // This is the `assumed`-section case: a 100 x 100 SHS has no `HP100-10`, so the
    // book cannot name the plate. Printing the sheet anyway would show the knee hole
    // and omit the haunch, and a workshop reads "two holes" as the whole
    // instruction — the members come back undrilled at the heaviest connection.
    const noHaunch: PunchSource = { ...source, haunch: () => undefined };
    expect(buildPunchingPages(members, noHaunch, 10)).toEqual([]);

    const noApex: PunchSource = { ...source, apex: () => undefined };
    expect(buildPunchingPages(members, noApex, 10)).toEqual([]);
  });

  it('gives back nothing at a pitch the connector table does not list', () => {
    const eleven: PunchSource = {
      kneeEdge: () => undefined,
      apex: source.apex,
      haunch: source.haunch,
    };
    expect(buildPunchingPages(members, eleven, 11)).toEqual([]);
  });

  it('gives back nothing when a member the sheet needs is absent', () => {
    const noRafters = members.filter((member) => !member.item.includes('rafter'));
    expect(buildPunchingPages(noRafters, source, 10)).toEqual([]);
  });

  it('still draws what it can when the design has no knee brace', () => {
    // The brace is a flat plate, not a member with punched holes, so its absence
    // changes nothing on the sheet.
    const withoutBrace = members.filter((member) => member.item !== 'knee_brace');
    expect(buildPunchingPages(withoutBrace, source, 10)).toHaveLength(2);
  });
});
