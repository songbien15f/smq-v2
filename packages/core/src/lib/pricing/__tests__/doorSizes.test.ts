import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteCatalogueSource } from '../catalogues';

function book(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE material_window (id INTEGER, description TEXT, code TEXT, height INTEGER, width INTEGER, is_active INTEGER, index_sort INTEGER);
    CREATE TABLE padoor (padoor_name TEXT, height INTEGER, width INTEGER, padoor_product_code TEXT, isActive INTEGER, indexSort INTEGER);
    CREATE TABLE roller_door (rdoor_name TEXT, rdoor_code TEXT, rdoor_type TEXT, width INTEGER, height INTEGER, isActive INTEGER, indexSort INTEGER);
    CREATE TABLE sliding_door (sld_id INTEGER, sld_size TEXT, sld_code TEXT, sld_width INTEGER, sld_height INTEGER);
  `);
  db.exec(`
    INSERT INTO material_window VALUES (1,'1200 x 900 fixed','WIN-1200',900,1200,1,1),(2,'Old','OLD',1,1,0,2);
    INSERT INTO padoor VALUES ('820 x 2040','2040','820','PA-820',1,1);
    INSERT INTO roller_door VALUES ('4800 x 3000','RD-B-4800','B',4800,3000,1,1);
    INSERT INTO sliding_door VALUES (1,'3000 x 2400','SLD-3000',3000,2400);
  `);
  return db;
}

describe('door sizes', () => {
  it('reads each table despite its own column names', () => {
    const sizes = createSqliteCatalogueSource(book()).load().doorSizes;
    expect(sizes.window).toEqual([{ code: 'WIN-1200', label: '1200 x 900 fixed', width: 1200, height: 900 }]);
    expect(sizes.paDoor).toEqual([{ code: 'PA-820', label: '820 x 2040', width: 820, height: 2040 }]);
    expect(sizes.rollerDoor).toEqual([
      { code: 'RD-B-4800', label: '4800 x 3000', width: 4800, height: 3000, series: 'B' },
    ]);
    expect(sizes.slidingDoor).toEqual([{ code: 'SLD-3000', label: '3000 x 2400', width: 3000, height: 2400 }]);
  });
});
