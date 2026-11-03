import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createCipheriv } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { detectFormat, readQuoteFile, readQuoteFileBytes, summariseQuoteFile, writeQuoteFile } from '../sqd';

/**
 * The three formats `.sqd` is found in, and the one it must refuse.
 *
 * The format question was verification item C1: `ApplyAESSecurityProvider()` is commented
 * out on some open and save paths, so the analysis could not say whether a real file is
 * encrypted. Inspecting real files answered it — **all three shapes exist** — and these
 * tests pin each one so a future reader cannot quietly narrow to a single format and stop
 * reading a third of the quotes in the field.
 */

/** The key and IV the old application embeds, repeated here to build a real fixture. */
const LEGACY_KEY = Buffer.from('zbbsjpweemscjjsfyiccwpdfzyemlccx', 'utf8');
const LEGACY_IV = Buffer.from('mzkcaxeisaiyljwh', 'utf8');

/** A minimal but realistic quote payload. */
function payload(): string {
  return JSON.stringify({
    SmartQuoteVersions: [
      {
        RevisionId: 1,
        RevisionName: 'Initial Version',
        CompanyCode: 'SSA',
        CompanyName: 'Smart Solutions Australia',
        QuoteNumber: 'SSA@@-00001',
        ContractPrice: 454.46,
        QuoteDeposite: 90.89,
        QuotePayment: 181.78,
        QuoteBalance: 181.79,
      },
    ],
  });
}

/** Encrypt with the legacy key, the way the application does. */
function aes(bytes: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-cbc', LEGACY_KEY, LEGACY_IV);
  return Buffer.concat([cipher.update(bytes), cipher.final()]);
}

describe('detectFormat', () => {
  it('recognises plaintext JSON, including with leading whitespace', () => {
    expect(detectFormat(Buffer.from(payload(), 'utf8'))).toBe('json');
    expect(detectFormat(Buffer.from(`\n  ${payload()}`, 'utf8'))).toBe('json');
  });

  it('recognises the .NET BinaryFormatter header', () => {
    const bytes = Buffer.concat([
      Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0x01, 0x00, 0x00, 0x00]),
      Buffer.alloc(32, 0x41),
    ]);
    expect(detectFormat(bytes)).toBe('binaryformatter');
  });

  it('recognises a whole number of AES blocks', () => {
    expect(detectFormat(aes(Buffer.from(payload(), 'utf8')))).toBe('aes');
  });

  it('calls an empty file empty and a stray byte unknown', () => {
    expect(detectFormat(Buffer.alloc(0))).toBe('empty');
    expect(detectFormat(Buffer.from([0x01, 0x02, 0x03]))).toBe('unknown');
  });
});

describe('readQuoteFile', () => {
  let dir: string;

  // Created in `beforeAll`, not in the describe body: a describe body runs at collection
  // time, so a directory made and removed there is gone before the first test executes and
  // every case fails on a missing file.
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sq-sqd-test-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, bytes: Buffer): string => {
    const path = join(dir, name);
    writeFileSync(path, bytes);
    return path;
  };

  it('reads plaintext JSON', () => {
    const result = readQuoteFile(write('plain.sqd', Buffer.from(payload(), 'utf8')));
    expect(result.format).toBe('json');
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]?.QuoteNumber).toBe('SSA@@-00001');
    expect(result.revisions[0]?.ContractPrice).toBe(454.46);
  });

  it('decrypts AES and reads the same payload', () => {
    const result = readQuoteFile(write('aes.sqd', aes(Buffer.from(payload(), 'utf8'))));
    expect(result.format).toBe('aes');
    expect(result.revisions[0]?.QuoteNumber).toBe('SSA@@-00001');
  });

  /**
   * The refusal, and why it is a refusal rather than a best effort.
   *
   * Reading `BinaryFormatter` from Node means reimplementing a .NET object graph with type
   * metadata. A half-parsed quote yields a plausible wrong price, which is the exact
   * failure this product exists to prevent, so the reader says nothing rather than
   * something unreliable.
   */
  it('refuses a .NET binary quote, and says what to do instead', () => {
    const bytes = Buffer.concat([
      Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0x01, 0x00, 0x00, 0x00]),
      Buffer.alloc(64, 0x41),
    ]);
    const result = readQuoteFile(write('binary.sqd', bytes));

    expect(result.format).toBe('binaryformatter');
    expect(result.revisions).toEqual([]);
    expect(result.refusal).toMatch(/BinaryFormatter/);
    expect(result.refusal).toMatch(/\.NET/);
  });

  it('refuses AES bytes that do not decrypt with this key', () => {
    const wrongKey = Buffer.alloc(32, 0x7a);
    const cipher = createCipheriv('aes-256-cbc', wrongKey, LEGACY_IV);
    const bytes = Buffer.concat([cipher.update(Buffer.from(payload(), 'utf8')), cipher.final()]);

    const result = readQuoteFile(write('wrongkey.sqd', bytes));
    expect(result.format).toBe('aes');
    expect(result.revisions).toEqual([]);
    expect(result.refusal).toMatch(/did not decrypt/);
  });

  it('refuses a file that decrypts to something other than quote JSON', () => {
    const result = readQuoteFile(write('notjson.sqd', aes(Buffer.from('not a quote at all', 'utf8'))));
    expect(result.format).toBe('aes');
    expect(result.revisions).toEqual([]);
    expect(result.refusal).toMatch(/not the quote JSON/);
  });

  it('reports a missing file rather than throwing', () => {
    // The caller is a screen that has to say something to a person; an exception here
    // would be a 500 with no explanation.
    const result = readQuoteFile(join(dir, 'does-not-exist.sqd'));
    expect(result.revisions).toEqual([]);
    expect(result.refusal).toMatch(/could not be opened/);
  });

  it('summarises a refusal for a person to read', () => {
    const result = readQuoteFile(join(dir, 'does-not-exist.sqd'));
    const text = summariseQuoteFile(result);
    expect(text).toMatch(/refused/);
  });

  it('summarises the money from a readable file', () => {
    const result = readQuoteFile(write('summary.sqd', Buffer.from(payload(), 'utf8')));
    const text = summariseQuoteFile(result);
    expect(text).toMatch(/SSA@@-00001/);
    expect(text).toMatch(/\$454\.46/);
    // The old file stores dollars, not cents, and the summary says so rather than
    // converting: a comparison between two different units is worse than no comparison.
    expect(text).toMatch(/dollars/);
  });
});

/**
 * The real files, when the reference repositories are checked out beside this one.
 *
 * Skipped rather than failed when they are absent, because a fresh clone of this
 * repository does not contain them — but run when they are, because a synthetic fixture
 * proves the parser and these prove the *format detection* against bytes the old
 * application actually wrote.
 */
describe('the real sample quotes', () => {
  function workspaceRoot(): string {
    let dir = process.cwd();
    for (;;) {
      if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
      const cut = dir.lastIndexOf(sep);
      if (cut <= 0) return process.cwd();
      dir = dir.slice(0, cut);
    }
  }

  const reference = resolve(dirname(workspaceRoot()), 'smq-code-smartquote', 'App', 'SmartQuote', 'mock-test.sqd');

  it.skipIf(!existsSync(reference))('reads a quote the old application wrote', () => {
    const result = readQuoteFile(reference);
    expect(result.refusal).toBeUndefined();
    expect(result.revisions.length).toBeGreaterThan(0);
    // A real contract price, so the test fails if the reader starts returning empty
    // objects that happen to satisfy a length check.
    expect(typeof result.revisions[0]?.ContractPrice).toBe('number');
  });
});

/**
 * Writing a file the old app can open.
 *
 * The point of the writer is portability: a company that leaves this product, or a quote that has
 * to go to somebody on the desktop, must arrive as a file the old reader accepts. So the assertions
 * are about the **legacy contract** — the property spellings, dollars rather than cents, and the
 * metadata the desktop's loader reads to pick a revision — not about this build's own convenience.
 */
describe('writeQuoteFile', () => {
  const base = {
    companyName: 'Demo Sheds Pty Ltd',
    companyCode: 'DEMO',
    quoteNumber: 'Q-2026-0006',
    createdAt: '2026-11-02T04:38:13.673Z',
  };

  const file = {
    revisions: [
      {
        ...base,
        revision: 1,
        name: 'Initial version',
        contractPrice: 30920.9,
        deposit: 3092.09,
        progress: 21644.63,
        balance: 6184.18,
      },
      {
        ...base,
        revision: 2,
        name: 'Revision 2',
        description: 'Added a stable',
        contractPrice: 31170.71,
        deposit: 3117.07,
        progress: 21819.5,
        balance: 6234.14,
      },
    ],
  };

  it('round-trips through the reader', () => {
    const bytes = writeQuoteFile(file);
    const read = readQuoteFileBytes(bytes);

    expect(read.format).toBe('json');
    expect(read.refusal).toBeUndefined();
    expect(read.revisions).toHaveLength(2);
    expect(read.revisions[0]?.QuoteNumber).toBe('Q-2026-0006');
    expect(read.revisions[1]?.RevisionName).toBe('Revision 2');
  });

  it('writes dollars as numbers, never cents', () => {
    const bytes = writeQuoteFile(file);
    const parsed = JSON.parse(bytes.toString('utf8'));
    const first = parsed.SmartQuoteVersions[0];

    // The old file stores dollars as a real, and the desktop's reader does not multiply. Writing
    // cents here would make a $30,920.90 quote read as $3,092,090.
    expect(first.ContractPrice).toBe(30920.9);
    expect(typeof first.ContractPrice).toBe('number');
  });

  it('keeps the legacy property spellings', () => {
    const bytes = writeQuoteFile(file);
    const parsed = JSON.parse(bytes.toString('utf8'));
    const first = parsed.SmartQuoteVersions[0];

    // `QuoteDeposite` is misspelled in the desktop's own model, and Newtonsoft is case-sensitive.
    // "Correcting" it produces a file the old app reads as zero.
    expect(first).toHaveProperty('QuoteDeposite');
    expect(first).toHaveProperty('QuotePayment');
    expect(first).toHaveProperty('QuoteBalance');
    // No $type metadata: the desktop writes with TypeNameHandling.None and would reject it.
    expect(JSON.stringify(parsed)).not.toContain('$type');
  });

  it('names the revision the desktop should open on', () => {
    const bytes = writeQuoteFile(file);
    const parsed = JSON.parse(bytes.toString('utf8'));

    expect(parsed.VersionMetadata.CurrentRevision).toBe(2);
    expect(parsed.VersionMetadata.TotalVersions).toBe(2);
    // A file without this opens on nothing, which reads as corrupt to whoever holds it.
    expect(parsed.VersionMetadata.CreatedAt).toBeDefined();
  });

  it('starts with a brace and no BOM, so the old reader takes the JSON branch', () => {
    const bytes = writeQuoteFile(file);
    // `detectFormat` skips whitespace but not a BOM, and the desktop's own reader is the same.
    expect(bytes[0]).toBe(0x7b);
    expect(detectFormat(bytes)).toBe('json');
  });

  it('refuses to write a file with no revisions', () => {
    expect(() => writeQuoteFile({ revisions: [] })).toThrow(/at least one revision/i);
  });
});
