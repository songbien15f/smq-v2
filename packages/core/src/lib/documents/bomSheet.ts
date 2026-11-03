/**
 * The bill of materials as a spreadsheet a workshop can use.
 *
 * ## Why this is separate from the customer's PDF
 *
 * The quote PDF answers "what will this cost me" for a buyer. A workshop answers
 * "what do I cut" — it wants the same lines without the price, in a grid it can
 * sort, and usually with its own code beside each item. Until now the only way to
 * get one was to read the PDF and retype it, which is exactly the work this
 * product exists to remove.
 *
 * ## What it carries
 *
 * Every line of the frozen revision: group, code, description, unit, quantity,
 * unit cost, amount and mass, plus a per-group subtotal and the two totals. The
 * **cost** is included because this is an internal document — the route requires
 * `cost:read`, the same capability the editor uses to show a price. A version
 * without cost would be a second document to keep in step, and a workshop that
 * cannot see cost cannot cost a variation.
 *
 * ## Why it reads a revision, not a live evaluation
 *
 * A workshop cuts what was quoted. A spreadsheet built from today's price book
 * would list steel for a building the customer did not agree to, if the
 * configuration changed between the quote and the download.
 */

import ExcelJS from 'exceljs';
import type { BomResult } from '@/lib/bom/types';

/** One sheet row: the shape both the detail and the summary write. */
type Cell = string | number | null;

/** Dollars for display, from whole cents. */
function dollars(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * A workbook of one building's materials.
 *
 * Two sheets: `Materials` is the list, `Summary` is the group subtotals and the
 * two totals. A workshop sorts and filters the first; a manager reads the second.
 * Keeping them apart means a filter on the detail cannot hide a subtotal, which is
 * how a materials list ends up understating a job.
 */
export async function buildBomSheet(
  bom: BomResult,
  meta: {
    /** The quote's number, so a printed sheet can be traced to it. */
    quoteNumber: string;
    revision: number;
    /** ISO date the revision was issued. */
    issuedAt: string;
    /** The building, in one line: "Gable 9.0 × 24.0 × 3.6 m". */
    building: string;
    companyName: string;
  },
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Shed Quoting';
  // A fixed timestamp keeps the file byte-identical for the same revision, which
  // is what lets a test assert on its contents and a person diff two downloads.
  workbook.created = new Date(0);

  const materials = workbook.addWorksheet('Materials');
  materials.columns = [
    { header: 'Group', key: 'group', width: 20 },
    { header: 'Code', key: 'code', width: 16 },
    { header: 'Description', key: 'description', width: 56 },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'Quantity', key: 'quantity', width: 11 },
    { header: 'Unit cost', key: 'unitCost', width: 12 },
    { header: 'Amount', key: 'amount', width: 13 },
    { header: 'Mass kg', key: 'mass', width: 11 },
  ];
  materials.getRow(1).font = { bold: true };
  materials.views = [{ state: 'frozen', ySplit: 1 }];

  const numberFormat = '#,##0.00';
  materials.getColumn('quantity').numFmt = '#,##0.00';
  materials.getColumn('unitCost').numFmt = numberFormat;
  materials.getColumn('amount').numFmt = numberFormat;
  materials.getColumn('mass').numFmt = '#,##0.000';

  for (const group of bom.groups) {
    if (group.lines.length === 0) continue;
    for (const line of group.lines) {
      materials.addRow([
        group.label,
        line.code,
        line.description,
        line.unit,
        Math.round(line.quantity * 100) / 100,
        dollars(line.unitCost),
        dollars(line.amount),
        Math.round(line.massKg * 1000) / 1000,
      ]);
    }
  }

  /**
   * A mocked line is flagged in its description rather than in a separate column.
   *
   * `MOCK` as a code is visible, but a workshop reading a printed sheet needs the
   * word: a line with no price is a line nobody can order, and the list has to say
   * so where the person cutting steel will see it.
   */
  for (let rowNumber = 2; rowNumber <= materials.rowCount; rowNumber++) {
    const row = materials.getRow(rowNumber);
    if (String(row.getCell(2).value) === 'MOCK') {
      row.getCell(3).value = `${String(row.getCell(3).value)} (no price — do not order)`;
      row.font = { color: { argb: 'FF9A3412' } };
    }
  }

  const summary = workbook.addWorksheet('Summary');
  summary.columns = [
    { header: '', key: 'label', width: 30 },
    { header: 'Amount', key: 'amount', width: 15 },
    { header: 'Mass kg', key: 'mass', width: 14 },
  ];
  summary.getRow(1).font = { bold: true };
  summary.getColumn('amount').numFmt = numberFormat;
  summary.getColumn('mass').numFmt = '#,##0.000';

  // What the sheet is for, above the numbers: a spreadsheet that leaves an office
  // and comes back a week later has to say which building it describes.
  summary.addRow(['Company', meta.companyName]);
  summary.addRow(['Quote', meta.quoteNumber]);
  summary.addRow(['Revision', meta.revision]);
  summary.addRow(['Issued', meta.issuedAt]);
  summary.addRow(['Building', meta.building]);
  summary.addRow([]);

  for (const group of bom.groups) {
    if (group.lines.length === 0) continue;
    const amount = group.lines.reduce((sum, line) => sum + line.amount, 0);
    const mass = group.lines.reduce((sum, line) => sum + line.massKg, 0);
    summary.addRow([group.label, dollars(amount), Math.round(mass * 1000) / 1000]);
  }

  summary.addRow([]);
  const buildingRow = summary.addRow(['Building cost', dollars(bom.buildingCost)]);
  const totalRow = summary.addRow(['Total material cost', dollars(bom.totalCost)]);
  const massRow = summary.addRow(['Total mass', null, Math.round(bom.totalMassKg * 1000) / 1000]);
  for (const row of [buildingRow, totalRow, massRow]) row.font = { bold: true };

  if (bom.mockedLines > 0) {
    summary.addRow([]);
    summary.addRow([
      `${bom.mockedLines} line${bom.mockedLines === 1 ? '' : 's'} could not be priced from the book`,
    ]);
    summary.getRow(summary.rowCount).font = { color: { argb: 'FF9A3412' } };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * A filename a person can recognise in a download folder.
 *
 * `SQ-2026-0007-rev2-bom.xlsx` rather than `export.xlsx`: an office with forty of
 * these open needs the number in the name, and a slash in a quote number would
 * break the path, so everything outside `[A-Za-z0-9._-]` becomes a dash.
 */
export function bomSheetFilename(quoteNumber: string, revision: number): string {
  const safe = quoteNumber.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe || 'quote'}-rev${revision}-bom.xlsx`;
}
