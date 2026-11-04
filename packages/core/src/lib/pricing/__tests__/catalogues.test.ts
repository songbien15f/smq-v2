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
});
