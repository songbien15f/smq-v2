// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPriceDb } from '@/lib/pricing/db';
import { importPriceBook, readBookKind } from '@/lib/pricing/import';
import { publishPriceBook, readActiveBookKind, readActiveBookHash } from '@/lib/pricing/publish';

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A dump with one table, optionally marked as a sample. */
function dump(marker: unknown): string {
  const dir = temp('sq-kind-dump-');
  writeFileSync(
    join(dir, 'cost_frame.json'),
    JSON.stringify([{ id: 1, description: 'C15024', code: 'FP52139', cost: 15.2084, mass: 5.7 }]),
  );
  if (marker !== undefined) {
    writeFileSync(join(dir, 'BOOK_KIND.json'), JSON.stringify(marker));
  }
  return dir;
}

describe('readBookKind', () => {
  it('reads a dump that declares itself a sample', () => {
    expect(readBookKind(dump({ kind: 'sample' }))).toBe('sample');
  });

  it('defaults to licensed when the dump says nothing', () => {
    // The default decides whether a stranger may see a price list, so an unmarked
    // dump must be treated as the real thing. Guessing `sample` is how a licensed
    // book would end up on a public demo.
    expect(readBookKind(dump(undefined))).toBe('licensed');
  });

  it('defaults to licensed when the marker is nonsense', () => {
    expect(readBookKind(dump({ kind: 'mock' }))).toBe('licensed');
    expect(readBookKind(dump({ nothing: true }))).toBe('licensed');
  });

  it('defaults to licensed when the marker cannot be parsed', () => {
    const dir = temp('sq-kind-bad-');
    writeFileSync(join(dir, 'cost_frame.json'), JSON.stringify([{ id: 1 }]));
    writeFileSync(join(dir, 'BOOK_KIND.json'), 'not json at all');
    expect(readBookKind(dir)).toBe('licensed');
  });
});

describe('the flag the published book carries', () => {
  it('records sample for a sample dump', () => {
    const root = temp('sq-kind-books-');
    const published = publishPriceBook(dump({ kind: 'sample' }), root);
    expect(readActiveBookKind(root)).toBe('sample');
    expect(readActiveBookHash(root)).toBe(published.hash);
  });

  it('records licensed for an unmarked dump', () => {
    const root = temp('sq-kind-books-');
    publishPriceBook(dump(undefined), root);
    expect(readActiveBookKind(root)).toBe('licensed');
  });

  it('answers licensed when nothing is published at all', () => {
    // No book is not a sample: reading a missing book must not open a screen.
    expect(readActiveBookKind(temp('sq-kind-empty-'))).toBe('licensed');
  });

  it('answers licensed when the active book file is missing', () => {
    const root = temp('sq-kind-books-');
    publishPriceBook(dump({ kind: 'sample' }), root);
    // Point the pointer at a hash with no file, as a half-copied directory would.
    writeFileSync(join(root, 'active.json'), JSON.stringify({ hash: 'f'.repeat(64) }));
    expect(readActiveBookKind(root)).toBe('licensed');
  });

  it('writes the flag into the book’s own metadata, so it travels with the file', () => {
    const root = temp('sq-kind-books-');
    const published = publishPriceBook(dump({ kind: 'sample' }), root);
    const db = openPriceDb(join(root, `${published.hash}.db`));
    const row = db
      .prepare("SELECT value FROM price_book_meta WHERE key = 'book_kind'")
      .get() as { value: string } | undefined;
    db.close();
    expect(row?.value).toBe('sample');
  });

  it('carries the flag through the importer, not the path', () => {
    // The marking lives inside the dump, so it survives being copied to a machine
    // whose directories are named anything at all.
    const db = openPriceDb(':memory:');
    importPriceBook(db, dump({ kind: 'sample' }));
    const row = db
      .prepare("SELECT value FROM price_book_meta WHERE key = 'book_kind'")
      .get() as { value: string } | undefined;
    db.close();
    expect(row?.value).toBe('sample');
  });
});