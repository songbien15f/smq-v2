import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteCatalogueSource } from '../catalogues';

function emptyBook(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE system_colour (colour_name TEXT, colour_value TEXT, colour_status INTEGER, colour_index INTEGER, option_spec_array TEXT);
    CREATE TABLE misc_option (option_name TEXT, product_code TEXT, price REAL, unit TEXT, type TEXT, indexSort INTEGER);
    CREATE TABLE system_structure_option (code TEXT, name TEXT, description TEXT, display_priority INTEGER, min_value REAL, default_value REAL, max_value REAL, is_active TEXT);
  `);
  return db;
}

describe('createSqliteCatalogueSource', () => {
  it('đọc màu đang bật, kèm các vai trò hợp lệ', () => {
    const db = emptyBook();
    db.exec(
      `INSERT INTO system_colour VALUES ('Shale Grey','#bcbdc0',1,2,'WALL_SPEC, GUTTER_SPEC'),('Old','#000000',0,1,'')`,
    );
    expect(createSqliteCatalogueSource(db).load().colours).toEqual([
      { name: 'Shale Grey', hex: '#bcbdc0', roles: ['WALL_SPEC', 'GUTTER_SPEC'] },
    ]);
  });

  it('tách misc khỏi engineering theo type', () => {
    const db = emptyBook();
    db.exec(`INSERT INTO misc_option VALUES
      ('Insulation','INS',12.5,'m','MicsellaneousOptions',1),
      ('Engineering QLD','ENG',99,'ea','EngineeringCharges',2)`);
    const c = createSqliteCatalogueSource(db).load();
    expect(c.miscOptions.map((o) => o.name)).toEqual(['Insulation']);
    expect(c.engineeringCharges.map((o) => o.name)).toEqual(['Engineering QLD']);
  });

  it('đọc structure option đang bật, sắp theo display_priority', () => {
    const db = emptyBook();
    db.exec(`INSERT INTO system_structure_option VALUES
      ('ROLLER_DOOR','ROLLER DOOR','',3,NULL,NULL,NULL,'1.0'),
      ('WINDOW','WINDOW','',1,900,1000,3000,'1.0'),
      ('OLD','OLD','',2,NULL,NULL,NULL,'0.0')`);
    const rows = createSqliteCatalogueSource(db).load().structureOptions;
    expect(rows.map((r) => r.code)).toEqual(['WINDOW', 'ROLLER_DOOR']);
    expect(rows[0]).toMatchObject({ min: 900, defaultValue: 1000, max: 3000 });
  });

  it('trả rỗng khi sách giá thiếu bảng', () => {
    const db = new DatabaseSync(':memory:');
    const c = createSqliteCatalogueSource(db).load();
    expect(c.colours).toEqual([]);
    expect(c.structureOptions).toEqual([]);
    expect(c.spanHints).toEqual([]);
    expect(c.deliveryScopes).toEqual([]);
  });

  it('ném lỗi khi bảng có nhưng thiếu cột, thay vì trả rỗng', () => {
    // A dump that predates a column is a real incompatibility. Returning `[]` would
    // leave the editor with an empty colour list and no error to act on.
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE system_colour (colour_name TEXT, colour_value TEXT, colour_status INTEGER)');
    expect(() => createSqliteCatalogueSource(db).load()).toThrow(/no such column/i);
  });

  it('reads each roof profile’s sheet cover per state, in millimetres', () => {
    /*
     * A skylight is snapped onto a whole roof sheet (R12), so the editor needs the cover
     * — and `sheeting_cover` packs it per state in **metres** (`'QLD:0.762;'`).
     *
     * This test exists because the first version asked for `row.description` from a query
     * that did not select it. `undefined` compares unequal to the map's keys and nothing
     * complains, so every profile's cover came back null and the feature silently did
     * nothing.
     */
    const db = emptyBook();
    db.exec(`
      CREATE TABLE material_sheeting (description TEXT, bmt REAL, profile TEXT, is_active INTEGER, index_sort INTEGER, is_wall INTEGER, is_roof INTEGER);
      CREATE TABLE sheeting_cover (sheeting_size TEXT, isWall INTEGER, sheet_cover TEXT);
      INSERT INTO material_sheeting VALUES ('0.42 Corro',0.42,'Corro',1,1,1,1),
                                           ('0.42 Lo-Rib',0.42,'Lo-Rib',1,2,1,0);
      INSERT INTO sheeting_cover VALUES
        ('0.42 Corro',1,'ACT:0.762;NSW:0.762;QLD:0.762;'),
        ('0.42 Lo-Rib',1,'ACT:0.817;NSW:0.817;QLD:0.817;');
    `);
    const c = createSqliteCatalogueSource(db).load();
    const corro = c.profiles.find((p) => p.profile === 'Corro');
    const loRib = c.profiles.find((p) => p.profile === 'Lo-Rib');
    // Metres in the book, millimetres above it: 0.762 must arrive as 762, not 0.
    expect(corro?.coverByState).toEqual({ ACT: 762, NSW: 762, QLD: 762 });
    expect(loRib?.coverByState).toEqual({ ACT: 817, NSW: 817, QLD: 817 });
    // Only the Corro is a roof profile, and that is what a skylight snaps to.
    expect(corro?.isRoof).toBe(true);
    expect(loRib?.isRoof).toBe(false);
  });


  it('reads the downpipe materials and the colours each one is stocked in', () => {
    /*
     * The desktop's Downpipe Type was `SELECT DISTINCT downpipe_kind`, and choosing one re-filtered
     * the downpipe colour list through a join to `system_colour`. Both facts are one table, so they
     * are read as one list — a materials list and a colour list from two queries could disagree.
     *
     * Three things the query must get right, each measured on the reference book:
     * - an **inactive** colour is dropped (five steel colours exist in `downpipe` but are inactive);
     * - a part row does not add a colour — PVC's adaptor names `90mm OD to 100x50`, and listing a
     *   colour because an elbow of it exists is a palette entry with no pipe behind it;
     * - the same colour appears once per material, not once per state.
     */
    const db = emptyBook();
    db.exec(`
      CREATE TABLE downpipe (downpipe_kind TEXT, downpipe_size TEXT, downpipe_color TEXT,
                             downpipe_type TEXT, downpipe_price REAL, state TEXT);
      INSERT INTO downpipe VALUES
        ('PVC','90mm RND','White','DOWNPIPE',10.9,'NSW'),
        ('PVC','90mm RND','Shale Grey','DOWNPIPE',10.9,'NSW'),
        ('PVC','90mm OD to 100x50','White','DOWNPIPE_ADAPTOR',4.0,'NSW'),
        ('STEEL','100x75','Monument','DOWNPIPE',8.4,'NSW'),
        ('STEEL','100x75','Monument','DOWNPIPE',8.4,'VIC'),
        ('STEEL','100x75','Monument','DOWNPIPE_ELBOW',1.2,'NSW'),
        ('STEEL','100x75','Loft','DOWNPIPE',8.4,'NSW');
      INSERT INTO system_colour VALUES
        ('White','#ffffff',1,10,'DOWNPIPE_PVC'),
        ('Shale Grey','#bdbfba',1,11,'DOWNPIPE_STEEL'),
        ('Monument','#323232',1,12,'DOWNPIPE_STEEL'),
        ('Loft','#5a5a5a',0,13,'DOWNPIPE_STEEL');
    `);
    expect(createSqliteCatalogueSource(db).load().downpipeMaterials).toEqual([
      { kind: 'PVC', colourNames: ['Shale Grey', 'White'] },
      { kind: 'STEEL', colourNames: ['Monument'] },
    ]);
  });

  it('reads roof pitch groups with the span band each one covers', () => {
    /*
     * The desktop rebuilds the pitch dropdown on every span change (`GetHintListRoofPitch`), so the
     * catalogue has to carry the band each hint list applies to — a single global list would be right
     * only for a book whose bands never differ.
     */
    const db = emptyBook();
    db.exec(`
      CREATE TABLE config_shed (id INTEGER, span_min REAL, span_max REAL,
                                 roof_pitch_min REAL, roof_pitch_max REAL);
      CREATE TABLE shed_hint_roof_pitch (id INTEGER PRIMARY KEY, config_shed_id INTEGER, hint_value REAL);
      INSERT INTO config_shed VALUES
        (1, 1800, 9000, 7.5, 15),
        (2, 9001, 15000, 20, 30),
        (3, 1800, 15000, 0, 0);
      INSERT INTO shed_hint_roof_pitch (config_shed_id, hint_value) VALUES
        (1, 7.5), (1, 10), (1, 15),
        (2, 20), (2, 25), (2, 30),
        (3, 5);
    `);
    const groups = createSqliteCatalogueSource(db).load().roofPitchGroups;
    expect(groups).toEqual([
      { spanMin: 1800, spanMax: 9000, pitchMin: 7.5, pitchMax: 15, hints: [7.5, 10, 15] },
      { spanMin: 9001, spanMax: 15000, pitchMin: 20, pitchMax: 30, hints: [20, 25, 30] },
      // A row that states no bounds takes its own hints as the bounds, rather than 0..0.
      { spanMin: 1800, spanMax: 15000, pitchMin: 5, pitchMax: 5, hints: [5] },
    ]);
  });

  it('has no roof pitch groups when the book has neither table', () => {
    expect(
      createSqliteCatalogueSource(new DatabaseSync(':memory:')).load().roofPitchGroups,
    ).toEqual([]);
  });

  it('has no downpipe materials when the book has no downpipe table', () => {
    expect(createSqliteCatalogueSource(new DatabaseSync(':memory:')).load().downpipeMaterials).toEqual(
      [],
    );
  });

  it('leaves the cover null when the book has no cover row for a profile', () => {
    const db = emptyBook();
    db.exec(`
      CREATE TABLE material_sheeting (description TEXT, bmt REAL, profile TEXT, is_active INTEGER, index_sort INTEGER, is_wall INTEGER, is_roof INTEGER);
      CREATE TABLE sheeting_cover (sheeting_size TEXT, isWall INTEGER, sheet_cover TEXT);
      INSERT INTO material_sheeting VALUES ('0.42 Zinc',0.42,'Zinc',1,1,1,1);
    `);
    expect(createSqliteCatalogueSource(db).load().profiles[0]?.coverByState).toBeNull();
  });
});
