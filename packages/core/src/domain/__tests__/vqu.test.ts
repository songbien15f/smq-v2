import { describe, expect, it } from 'vitest';
import { TEST_SHED } from '../defaults';
import { buildVqu } from '../vqu';

const input = {
  quoteNumber: 'Q-2026-0007',
  customer: {
    name: 'Jane Citizen',
    postcode: '4000',
    siteStreet: '1 Test Street',
    siteState: 'QLD',
    siteSuburb: 'Brisbane',
    sitePostcode: '4000',
  },
  config: {
    ...TEST_SHED,
    structureType: 'gable' as const,
    windRegion: 'B' as const,
    terrainCategory: 2.5 as const,
    bays: 4,
    length: 24000,
    span: 12000,
    height: 4200,
    roofPitchDeg: 10,
    footingType: 'CHEMSET',
    wallProfile: 'Corro',
    roofProfile: 'Corro',
    downpipeType: 'STEEL',
    internalPressure: 'open' as const,
    endOpening: { left: true, right: false },
    sideOpening: { front: true, back: false },
  },
  colors: {
    wall: 'Shale Grey',
    roof: 'Surfmist',
    trim: 'Surfmist',
    barge: 'Surfmist',
    gutter: 'Surfmist',
    downpipe: 'Surfmist',
    rollerDoor: 'Monument',
    slidingDoor: 'Monument',
    window: 'Monument',
    dividingWall: 'Surfmist',
    paDoor: 'Monument',
  },
  miscOptions: ['Insulation - Foil 1200w'],
};

describe('buildVqu', () => {
  it('writes the three sections in the desktop order', () => {
    const text = buildVqu(input);
    expect(text).toContain('[QUOTE DETAILS]');
    expect(text).toContain('[SHED DETAILS]');
    expect(text).toContain('[OPTIONS]');
    expect(text.indexOf('[QUOTE DETAILS]')).toBeLessThan(text.indexOf('[SHED DETAILS]'));
    expect(text.indexOf('[SHED DETAILS]')).toBeLessThan(text.indexOf('[OPTIONS]'));
  });

  it('writes the quote details the external tool needs', () => {
    const text = buildVqu(input);
    expect(text).toContain('QuoteNumber=Q-2026-0007');
    expect(text).toContain('Name=Jane Citizen');
    expect(text).toContain('SiteState=QLD');
  });

  it('translates the footing code to the label the tool expects', () => {
    expect(buildVqu(input)).toContain('Footings=Chemset');
  });

  it('writes colours by name and the open/closed flags as True/False', () => {
    const text = buildVqu(input);
    expect(text).toContain('WallColour=Shale Grey');
    expect(text).toContain('DoorColour=Monument');
    expect(text).toContain('ForceOpenDesign=open');
    expect(text).toContain('OpenBayEnd1=True');
    expect(text).toContain('OpenBayEnd2=False');
  });

  it('counts the misc options', () => {
    expect(buildVqu(input)).toContain('NumMiscOptions=1');
  });
});
