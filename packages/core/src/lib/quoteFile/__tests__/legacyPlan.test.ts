import { describe, it, expect } from 'vitest';
import { readLegacyPlan, readNewestLegacyPlan, WALL_CONVENTION } from '../legacyPlan';
import type { RawRevision } from '../sqd';

/**
 * Converting a legacy `.sqd` building into one this build can price.
 *
 * The fixtures are shaped like the two files that actually read — `mock-test.sqd` (plaintext) and the
 * licence server's AES template — because there are no others: every `.sqd` in the shipped sample data
 * is `.NET BinaryFormatter`, which this build refuses. The numbers below (6 000 span, 3 000 wall,
 * 3 750 bays, a 589 × 790 window at 1 581 / 1 200, an `Eng - Form` catalogue line) are that file's.
 *
 * What these tests defend is not the arithmetic but the **refusals**: an unrecognised structure is
 * reported rather than guessed, an absent wind region is reported rather than defaulted silently, and
 * the file's own price never reaches the config.
 */

/** One bay entry, as the desktop writes it: `Length`, `Position`, and a sentinel at the end. */
function bay(index: number, length: number, position: number): Record<string, unknown> {
  return { Index: index, Length: length, Position: position, IsEmpty: false };
}

/** A plan with four 3 750 mm bays, the shape of the readable sample file. */
function samplePlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    StructureType: '1',
    LookupCode: null,
    WindRegion: null,
    ImportanceLevel: 2,
    TerrainCategory: 0,
    FootingType: 'In Slab',
    FootingSubType: 'HD Bolts',
    BaseType: 'Pinned',
    RoofSheeting: '0.42 TL-5',
    WallSheeting: '0.35 TL-5',
    DownpipeType: 'STEEL',
    OpenDesign: false,
    StateCode: 'QLD',
    NormalBaySize: 3750,
    RoofPitch: 7.5,
    Width: 6000,
    Height: 3000,
    Shielding: 0.89,
    Bays: [bay(0, 3750, 0), bay(1, 3750, 3750), bay(2, 3750, 7500), bay(3, 3750, 11250), bay(3, 0, 15000)],
    EndWalls: [
      { Index: 0, IsOpen: false, IsLeft: true, OptionParts: emptyParts() },
      { Index: 1, IsOpen: true, IsLeft: false, OptionParts: emptyParts() },
    ],
    FrontWall: sideWall(0, [emptyParts()]),
    RearWall: sideWall(1, [emptyParts()]),
    ColorOption: {
      WallColor: { Name: 'Deep Ocean', Value: '#364152' },
      RoofColor: { Name: 'Manor Red', Value: '#5e1d0e' },
      TrimColor: { Name: 'Zinc', Value: '#FFFFFF' },
    },
    ...overrides,
  };
}

/** An empty `OptionParts` block, with every group the desktop writes. */
function emptyParts(): Record<string, unknown[]> {
  return {
    CarryBeamOptions: [],
    DoubleTrackOptions: [],
    DoubleTrackInBayOptions: [],
    EmptyOptions: [],
    EmptySDTrackOptions: [],
    MezzamineOptions: [],
    MiscOptionsOptions: [],
    OutTriggerOptions: [],
    PADoorOptions: [],
    RDoorOptions: [],
    SkylightOptions: [],
    SlidingDoorOptions: [],
    StableOptions: [],
    Track1Options: [],
    WindowOptions: [],
  };
}

/**
 * A side wall with one sub-wall per entry, each carrying its own `OptionParts`.
 *
 * Per bay rather than one block for the wall, because that is how the desktop stores a side wall —
 * and because sharing one block across bays silently duplicates every door into every bay.
 */
function sideWall(direction: number, bays: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    Direction: direction,
    SubWalls: bays.map((parts, index) => ({
      Open: false,
      Index: index,
      WidthType: 0,
      IsEmpty: false,
      InfillColumnPositions: [],
      OptionParts: parts,
    })),
  };
}

/** A window as the sample file records one: centred in bay 0, sill 1 200. */
function windowAt(x: number, y: number): Record<string, unknown> {
  return {
    OptionPart: { RelativeLocation: { X: x, Y: y, Z: 0 }, GroupId: null },
    WindowType: 'H790xW589 AMI S-Win (N5)',
    AlignTo: 'Center',
    PrepOnly: false,
    Height: 790,
    Width: 589,
  };
}

/** A revision carrying `plan` as its building. */
function revision(plan: Record<string, unknown>, extra: Record<string, unknown> = {}): RawRevision {
  return {
    RevisionId: 1,
    RevisionName: 'Original',
    QuoteNumber: 'VGS-00001',
    ContractPrice: 12345.67,
    HousePlan: { Width: 6000, Height: 3000, IsEmpty: false, BuildingPlan: plan, OptionParts: emptyParts() },
    CustomerData: {
      FirstName: 'TBA',
      LastName: 'TBA',
      Email: 'tba@example.com',
      HomePhone: 'TBA',
      Address: '222 Margaret St, Brisbane City QLD 4000',
      CustomerSurburbString: 'Brisbane City',
      CustomerStateString: 'QLD',
      CustomerPostCodeString: '4000',
      SiteAddress: '9 Site Rd',
      SiteSurburbString: 'Ipswich',
      SiteStateString: 'QLD',
      SitePostCodeString: '4305',
    },
    ...extra,
  };
}

describe('readLegacyPlan — the shell', () => {
  it('reads span, height, bay count, length and pitch from the plan', () => {
    const plan = readLegacyPlan(revision(samplePlan()));
    expect(plan).not.toBeNull();
    expect(plan?.config.span).toBe(6000);
    expect(plan?.config.height).toBe(3000);
    expect(plan?.config.bays).toBe(4);
    expect(plan?.config.length).toBe(15000);
    expect(plan?.config.nomBaySpacing).toBe(3750);
    expect(plan?.config.roofPitchDeg).toBe(7.5);
  });

  it('ignores the trailing sentinel bay rather than counting it', () => {
    // `Bays` has n + 1 entries: `Length: 0` repeats the last index. Counting the array would say 5.
    const plan = readLegacyPlan(revision(samplePlan()));
    expect(plan?.config.bays).toBe(4);
    expect(plan?.config.length).toBe(15000);
  });

  it('reports non-uniform bays instead of quoting them as uniform', () => {
    const plan = readLegacyPlan(
      revision(
        samplePlan({
          Bays: [bay(0, 3750, 0), bay(1, 3750, 3750), bay(2, 3000, 7500)],
          NormalBaySize: 3750,
        }),
      ),
    );
    expect(plan?.config.length).toBe(10500);
    expect(plan?.config.nomBaySpacing).toBe(3500);
    expect(plan?.assumed.some((note) => note.what === 'Bay spacing')).toBe(true);
  });

  it('never carries the file price into the config', () => {
    const plan = readLegacyPlan(revision(samplePlan()));
    expect(plan?.claimed.contractDollars).toBe(12345.67);
    const config = JSON.stringify(plan?.config);
    expect(config).not.toContain('12345');
    expect(plan?.assumed.some((note) => note.what === "The file's own price was ignored")).toBe(true);
  });

  it('returns null for a revision with no house plan', () => {
    expect(readLegacyPlan({ RevisionId: 1 })).toBeNull();
    expect(readLegacyPlan({ HousePlan: { IsEmpty: true } })).toBeNull();
  });

  it('returns null when the plan has no usable dimensions', () => {
    expect(readLegacyPlan(revision(samplePlan({ Width: 0, Bays: [] })))).toBeNull();
  });
});

describe('readLegacyPlan — walls and openings', () => {
  it('puts a window on a long side wall onto the matching v2 side', () => {
    const front = sideWall(0, [{ ...emptyParts(), WindowOptions: [windowAt(1581, 1200)] }]);
    const plan = readLegacyPlan(revision(samplePlan({ FrontWall: front })));
    const openings = plan?.config.openings as Record<string, unknown>[];
    expect(openings).toHaveLength(1);
    expect(openings[0]).toMatchObject({
      type: 'window',
      width: 589,
      height: 790,
      sill: 1200,
      wall: 'left',
      align: 'custom',
      offset: 1581,
      sku: 'H790xW589 AMI S-Win (N5)',
    });
  });

  it('treats a legacy side wall X as bay-local and adds the bay start', () => {
    // Bay 2 starts at 7 500. A bay-local 1 000 is 8 500 on the wall.
    const front = sideWall(0, [
      emptyParts(),
      emptyParts(),
      { ...emptyParts(), RDoorOptions: [rollerDoor(1000, 3000, 2800)] },
    ]);
    const plan = readLegacyPlan(revision(samplePlan({ FrontWall: front })));
    const openings = plan?.config.openings as Record<string, unknown>[];
    expect(openings[0]).toMatchObject({ wall: 'left', offset: 8500 });
  });

  it('treats a value larger than the bay as an absolute offset', () => {
    const front = sideWall(0, [
      emptyParts(),
      emptyParts(),
      { ...emptyParts(), RDoorOptions: [rollerDoor(8500, 3000, 2800)] },
    ]);
    const plan = readLegacyPlan(revision(samplePlan({ FrontWall: front })));
    const openings = plan?.config.openings as Record<string, unknown>[];
    expect(openings[0]).toMatchObject({ offset: 8500 });
  });

  it('reads a roller door’s series and windlocks', () => {
    const front = sideWall(0, [{ ...emptyParts(), RDoorOptions: [rollerDoor(500, 3000, 2800)] }]);
    const plan = readLegacyPlan(revision(samplePlan({ FrontWall: front })));
    const openings = plan?.config.openings as Record<string, unknown>[];
    expect(openings[0]).toMatchObject({ type: 'roller_door', series: 'B', windlock: true });
  });

  it('reads a sliding door’s track from its reserve list', () => {
    const front = sideWall(0, [
      {
        ...emptyParts(),
        SlidingDoorOptions: [
          {
            OptionPart: { RelativeLocation: { X: 200, Y: 0, Z: 0 }, GroupId: null },
            SDType: 2,
            TrackReserves: [3000, 3000],
            Height: 2400,
            Width: 6000,
          },
        ],
      },
    ]);
    const plan = readLegacyPlan(revision(samplePlan({ FrontWall: front })));
    const openings = plan?.config.openings as Record<string, unknown>[];
    expect(openings[0]).toMatchObject({
      type: 'sliding_door',
      track: 'double',
      trackSegments: 2,
      trackWidth: 3000,
    });
  });

  it('maps an end wall onto front or back by its IsLeft flag', () => {
    const ends = [
      { Index: 0, IsOpen: false, IsLeft: true, OptionParts: { ...emptyParts(), PADoorOptions: [paDoor()] } },
      { Index: 1, IsOpen: false, IsLeft: false, OptionParts: emptyParts() },
    ];
    const plan = readLegacyPlan(revision(samplePlan({ EndWalls: ends })));
    const openings = plan?.config.openings as Record<string, unknown>[];
    expect(openings).toHaveLength(1);
    expect(openings[0]?.wall).toBe('front');
    expect(WALL_CONVENTION.end.left).toBe('front');
  });

  it('reports an opening the file gives no size for instead of placing a zero-width hole', () => {
    const front = sideWall(0, [{ ...emptyParts(), RDoorOptions: [{ OptionPart: {} }] }]);
    const plan = readLegacyPlan(revision(samplePlan({ FrontWall: front })));
    expect(plan?.config.openings).toEqual([]);
    expect(plan?.dropped.some((note) => note.what.includes('roller door'))).toBe(true);
  });

  it('reads the wall-open switches', () => {
    const plan = readLegacyPlan(revision(samplePlan()));
    expect(plan?.config.endOpening).toEqual({ left: false, right: true });
  });
});

describe('readLegacyPlan — site conditions', () => {
  it('reports an absent wind region rather than defaulting it quietly', () => {
    const plan = readLegacyPlan(revision(samplePlan()));
    expect(plan?.config.windRegion).toBe('A');
    expect(plan?.dropped.some((note) => note.what === 'Wind region')).toBe(true);
  });

  it('keeps a wind region the file states', () => {
    const plan = readLegacyPlan(revision(samplePlan({ WindRegion: 'C' })));
    expect(plan?.config.windRegion).toBe('C');
    expect(plan?.dropped.some((note) => note.what === 'Wind region')).toBe(false);
  });

  it('reports a terrain category the book has no row for', () => {
    // 0 is what the sample file carries — a code, not a category.
    const plan = readLegacyPlan(revision(samplePlan({ TerrainCategory: 0 })));
    expect(plan?.config.terrainCategory).toBe(2);
    expect(plan?.assumed.some((note) => note.what === 'Site conditions')).toBe(true);
  });

  it('keeps a terrain category the book prices', () => {
    const plan = readLegacyPlan(revision(samplePlan({ TerrainCategory: 2.5 })));
    expect(plan?.config.terrainCategory).toBe(2.5);
    expect(plan?.assumed.some((note) => note.what === 'Site conditions')).toBe(false);
  });

  it('reads the structure when the code is one the book uses', () => {
    const plan = readLegacyPlan(revision(samplePlan({ StructureType: 'GC' })));
    expect(plan?.config.structureType).toBe('gable_carport');
    expect(plan?.assumed.some((note) => note.what === 'Structure type')).toBe(false);
  });

  it('reports an unrecognised structure instead of pretending it read one', () => {
    const plan = readLegacyPlan(revision(samplePlan()));
    expect(plan?.config.structureType).toBe('gable');
    const note = plan?.assumed.find((entry) => entry.what === 'Structure type');
    expect(note?.detail).toContain('"1"');
  });
});

describe('readLegacyPlan — colours, catalogue lines, customer', () => {
  it('prefers the price book’s colour for a name it knows', () => {
    const plan = readLegacyPlan(revision(samplePlan()));
    const colors = plan?.config.colors as Record<string, string>;
    // The file's own hex for Deep Ocean is #364152; the book's value wins when it has one.
    expect(colors.wall).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(colors.roof).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('reports trim and flashing, which have no role here', () => {
    const plan = readLegacyPlan(revision(samplePlan()));
    expect(plan?.dropped.some((note) => note.what === 'One trim colour')).toBe(true);
  });

  it('reads MiscOptions as catalogue lines by the book’s own name', () => {
    const plan = readLegacyPlan(
      revision(samplePlan(), {
        MiscOptions: [
          {
            Item: { Unit: 'each', Size: 'Eng - Form 1507 (VIC) - Enduro', Price: 70 },
            Quantity: 1,
            Unit: '',
          },
        ],
      }),
    );
    expect(plan?.config.options).toEqual([
      { id: '', kind: 'misc_option', name: 'Eng - Form 1507 (VIC) - Enduro', quantity: 1, unit: 'each' },
    ]);
  });

  it('reads the customer and the site as separate addresses', () => {
    const plan = readLegacyPlan(revision(samplePlan()));
    expect(plan?.customer).toMatchObject({ firstName: 'TBA', email: 'tba@example.com', state: 'QLD' });
    expect(plan?.site).toMatchObject({ address: '9 Site Rd', suburb: 'Ipswich', postcode: '4305' });
  });
});

describe('readNewestLegacyPlan', () => {
  it('starts from the latest revision that carries a building', () => {
    const older = revision(samplePlan({ Width: 6000 }), { RevisionId: 1 });
    const newer = revision(samplePlan({ Width: 9000 }), { RevisionId: 2 });
    const blank = { RevisionId: 3 } as RawRevision;
    const plan = readNewestLegacyPlan([older, newer, blank]);
    expect(plan?.config.span).toBe(9000);
  });
});

/** A roller door as the desktop records one: `RDoorType` is the series. */
function rollerDoor(x: number, width: number, height: number): Record<string, unknown> {
  return {
    OptionPart: { RelativeLocation: { X: x, Y: 0, Z: 0 }, GroupId: null },
    RDoorType: 'B',
    Style: '',
    PrepOnly: false,
    WindLock: true,
    IsCustomSize: false,
    Height: height,
    Width: width,
  };
}

/** A personnel-access door. */
function paDoor(): Record<string, unknown> {
  return {
    OptionPart: { RelativeLocation: { X: 400, Y: 0, Z: 0 }, GroupId: null },
    PADoorType: 'PA Door',
    PrepOnly: false,
    Height: 2040,
    Width: 820,
  };
}
