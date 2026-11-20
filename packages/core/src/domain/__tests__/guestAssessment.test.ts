import { describe, expect, it } from 'vitest';
import {
  GUEST_DEFAULT_TYPES,
  guestDesignFromType,
  guestSiteEstimate,
  setRoof,
} from '../guest';
import { assessGuestDesign } from '../guestAssessment';
import { applyGuestOps } from '../guestOps';

const type = (id: string) => {
  const found = GUEST_DEFAULT_TYPES.find((t) => t.id === id);
  if (found === undefined) throw new Error(`no type ${id}`);
  return found;
};

const garage = type('garage');
const carport = type('carport');
const house = type('house');

const estimate = (region: 'A' | 'B' | 'C' | 'D' | null, mode: 'design' | 'enquiry' = 'design') =>
  guestSiteEstimate({ region, enclosure: 'enclosed', mode });

describe('assessGuestDesign', () => {
  it('says a default garage is inside the book, and never mentions a price', () => {
    const items = assessGuestDesign(guestDesignFromType(garage), garage, estimate('B'));
    expect(items.every((i) => i.level === 'ok')).toBe(true);
    // The rule that must never break: no money, in any form. `prices` is the verb ("the book prices
    // a 4 m bay"), not a price, so the pattern looks for an amount and for money nouns instead.
    const text = items.map((i) => `${i.title} ${i.detail}`).join(' ');
    expect(text).not.toMatch(/\$\s?\d|\d+\s?(?:dollars?|cents?)/i);
    expect(text).not.toMatch(/(quote|customer) price/i);
  });

  it('flags a 5° skillion for review, and points at the roof control', () => {
    // `setRoof` re-picks the pitch to the new roof's default (10°); the 5° is then chosen explicitly,
    // the same way the page's chip does.
    const design = setRoof(guestDesignFromType(garage), garage, 'skillion');
    const five = { ...design, building: { ...design.building, pitchDeg: 5 } };
    const items = assessGuestDesign(five, garage, estimate('B'));
    const pitch = items.find((i) => i.level === 'review' && /below the book's minimum/i.test(i.title));
    expect(pitch).toBeDefined();
    // The pitch chips, not the roof switch: the roof is already skillion.
    expect(pitch?.focus).toContain('g-pitch');
  });

  it('flags a carport bay wider than the book, and names which bay', () => {
    const items = assessGuestDesign(guestDesignFromType(carport), carport, estimate('A'));
    const bay = items.find((i) => i.level === 'review' && /wider than/i.test(i.title));
    expect(bay?.title).toContain('Bay 1');
    expect(bay?.focus).toBe('#g-bay-0');
  });

  it('records Footing Only as the estimator’s call rather than an error', () => {
    const design = guestDesignFromType(garage);
    const footing = { ...design, building: { ...design.building, slab: 'footing_only' as const } };
    const items = assessGuestDesign(footing, garage, estimate('A'));
    expect(items.some((i) => i.level === 'review' && /Footing Only/i.test(i.title))).toBe(true);
  });

  it('mentions a cyclonic region, and says nothing about one in region A', () => {
    const design = guestDesignFromType(garage);
    expect(assessGuestDesign(design, garage, estimate('C')).some((i) => /Cyclonic/i.test(i.title))).toBe(true);
    expect(assessGuestDesign(design, garage, estimate('A')).some((i) => /Cyclonic/i.test(i.title))).toBe(false);
  });

  it('gives an enquiry type one line and no design rules', () => {
    const items = assessGuestDesign(guestDesignFromType(house), house, estimate('B', 'enquiry'));
    expect(items).toHaveLength(1);
    expect(items[0]?.level).toBe('note');
  });
});

describe('applyGuestOps', () => {
  it('applies a valid change set in order', () => {
    const design = guestDesignFromType(garage);
    const out = applyGuestOps(design, garage, [
      { op: 'setSpan', mm: 9000 },
      { op: 'setPitch', degrees: 20 },
    ]);
    expect(out.failures).toHaveLength(0);
    expect(out.applied).toBe(2);
    expect(out.design.building.span).toBe(9000);
    expect(out.design.building.pitchDeg).toBe(20);
  });

  it('refuses an operation outside the type’s limits, and applies the rest', () => {
    const design = guestDesignFromType(garage);
    const out = applyGuestOps(design, garage, [
      { op: 'setSpan', mm: 40_000 },
      { op: 'setHeight', mm: 3200 },
    ]);
    expect(out.design.building.span).toBe(design.building.span);
    expect(out.design.building.height).toBe(3200);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0]?.index).toBe(0);
    expect(out.failures[0]?.reason).toContain('outside');
  });

  it('refuses a pitch the current roof does not offer', () => {
    const design = guestDesignFromType(garage);
    const out = applyGuestOps(design, garage, [{ op: 'setPitch', degrees: 12.5 }]);
    expect(out.failures).toHaveLength(1);
    expect(out.design.building.pitchDeg).toBe(design.building.pitchDeg);
  });

  it('refuses changing the building type: that restarts the design', () => {
    const out = applyGuestOps(guestDesignFromType(garage), garage, [{ op: 'setType', typeId: 'carport' }]);
    expect(out.failures).toHaveLength(1);
    expect(out.design.typeId).toBe('garage');
  });

  it('refuses an opening size that is not a chip the type offers', () => {
    const out = applyGuestOps(guestDesignFromType(garage), garage, [
      { op: 'addOpening', kind: 'window', wall: 'left', size: { width: 350, height: 400 } },
    ]);
    expect(out.failures).toHaveLength(1);
    expect(out.design.openings).toHaveLength(guestDesignFromType(garage).openings.length);
  });

  it('adds and removes a bay', () => {
    const design = guestDesignFromType(garage);
    const added = applyGuestOps(design, garage, [{ op: 'addBay' }]);
    expect(added.design.building.bayWidths).toHaveLength(3);
    const removed = applyGuestOps(added.design, garage, [{ op: 'removeBay', index: 0 }]);
    expect(removed.design.building.bayWidths).toHaveLength(2);
  });

  it('refuses a colour the type does not offer', () => {
    const out = applyGuestOps(guestDesignFromType(garage), garage, [{ op: 'setColours', walls: 'Not A Colour' }]);
    expect(out.failures).toHaveLength(1);
    expect(out.design.colours.walls).toBe(guestDesignFromType(garage).colours.walls);
  });
});
