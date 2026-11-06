import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readVerified, sha256Hex, storeFile, templateFilesDir } from '../lib/templateFiles.js';

/**
 * The template file store: hashing, verification, and the path guard.
 *
 * Each test gets its own directory through `TEMPLATE_FILES`, so a test can corrupt a file on disk
 * without touching anything a developer is looking at. The environment variable is the same one a
 * deployment would set, so the test exercises the real resolution path rather than a special case.
 */
const roots: string[] = [];

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'sq-tpl-'));
  roots.push(root);
  process.env.TEMPLATE_FILES = root;
});

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  delete process.env.TEMPLATE_FILES;
});

const bytes = Buffer.from('{"SmartQuoteVersions":[]}', 'utf8');

describe('sha256Hex', () => {
  it('gives the lowercase hex digest of the bytes', () => {
    // A fixed vector, so a change to the algorithm or the encoding fails loudly. This is a
    // standard `sha256("abc")`, which is the shortest thing that can be checked by hand.
    expect(sha256Hex(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('storeFile', () => {
  it('writes the bytes and reports the hash of exactly those bytes', async () => {
    const stored = await storeFile({ templateId: 'tpl-1', fileId: 'file-1', bytes });
    expect(stored.sha256).toBe(sha256Hex(bytes));
    expect(stored.sizeBytes).toBe(bytes.length);
    expect(stored.relPath).toBe('tpl-1/file-1.sqd');
    // The path is portable: forward slashes even on Windows.
    expect(stored.relPath).not.toContain('\\');
    // And the bytes on disk are the bytes handed in.
    expect(readFileSync(join(templateFilesDir(), stored.relPath))).toEqual(bytes);
  });

  it('never overwrites: a second upload is a second row and a second file', async () => {
    const first = await storeFile({ templateId: 'tpl-1', fileId: 'file-1', bytes });
    const second = await storeFile({
      templateId: 'tpl-1',
      fileId: 'file-2',
      bytes: Buffer.from('{"SmartQuoteVersions":[1]}'),
    });
    expect(first.relPath).not.toBe(second.relPath);
    // The first file is still there, unchanged — which is what makes a template's history real.
    const readBack = await readVerified(first.relPath, first.sha256);
    expect(readBack.ok).toBe(true);
    if (readBack.ok) expect(readBack.bytes).toEqual(bytes);
  });

  it('creates the template directory on first write', async () => {
    await storeFile({ templateId: 'new-template', fileId: 'f', bytes });
    expect(() => readFileSync(join(templateFilesDir(), 'new-template', 'f.sqd'))).not.toThrow();
  });
});

describe('readVerified', () => {
  it('returns the bytes when the hash matches', async () => {
    const stored = await storeFile({ templateId: 'tpl-1', fileId: 'file-1', bytes });
    const result = await readVerified(stored.relPath, stored.sha256);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bytes).toEqual(bytes);
      expect(result.sha256).toBe(stored.sha256);
    }
  });

  it('refuses a file whose bytes changed by one, and says both hashes', async () => {
    /*
     * The reason this module exists. A `.sqd` that was corrupted in transit or by a bad restore
     * opens as a plausible quote with the wrong numbers — so the read is refused, not returned.
     */
    const stored = await storeFile({ templateId: 'tpl-1', fileId: 'file-1', bytes });
    const absolute = join(templateFilesDir(), stored.relPath);
    const corrupted = Buffer.from(bytes);
    corrupted[corrupted.length - 2] = 0x21; // one byte, inside the JSON
    writeFileSync(absolute, corrupted);

    const result = await readVerified(stored.relPath, stored.sha256);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('mismatch');
      expect(result.message).toContain(stored.sha256.slice(0, 12));
      expect(result.message).toContain(sha256Hex(corrupted).slice(0, 12));
    }
  });

  it('reports a recorded file that is no longer on disk', async () => {
    const stored = await storeFile({ templateId: 'tpl-1', fileId: 'gone', bytes });
    rmSync(join(templateFilesDir(), stored.relPath));
    const result = await readVerified(stored.relPath, stored.sha256);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing');
  });

  it('refuses a path that climbs out of the store', async () => {
    /*
     * `rel_path` comes from the database, and a database is something people edit by hand. A row
     * carrying `../../.env` must not read the application's secrets — the containment check is the
     * only thing standing between a hand-edited row and a file disclosure.
     */
    const root = templateFilesDir();
    const outside = join(root, '..', 'secret.txt');
    mkdirSync(join(root, '..'), { recursive: true });
    writeFileSync(outside, 'SECRET');

    for (const evil of ['../secret.txt', '../../secret.txt', 'tpl/../../secret.txt']) {
      const result = await readVerified(evil, sha256Hex(Buffer.from('SECRET')));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('unreadable');
    }
    rmSync(outside, { force: true });
  });

  it('refuses an absolute path, which would bypass the root entirely', async () => {
    const root = templateFilesDir();
    const absolute = join(root, '..', 'absolute-secret.txt');
    writeFileSync(absolute, 'SECRET');
    const result = await readVerified(absolute, sha256Hex(Buffer.from('SECRET')));
    expect(result.ok).toBe(false);
    rmSync(absolute, { force: true });
  });

  it('does not mistake a sibling directory for a child', async () => {
    /*
     * `${root}-old` starts with `${root}`, so a naive `startsWith(root)` would accept it. The
     * separator in the comparison is what makes this test pass, and without it a sibling backup
     * directory would be readable.
     */
    const root = templateFilesDir();
    const sibling = `${root}-old`;
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'x.sqd'), 'SECRET');
    const result = await readVerified(`../${'x'}.sqd`, sha256Hex(Buffer.from('SECRET')));
    expect(result.ok).toBe(false);
    rmSync(sibling, { recursive: true, force: true });
  });
});
