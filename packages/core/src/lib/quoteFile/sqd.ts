/**
 * The `.sqd` quote file: three formats, and why the reader has to know all three.
 *
 * ## What was found in the wild
 *
 * Verification item C1 in `docs/DECISIONS.md` asked whether `.sqd` is AES or plaintext,
 * because the call to `ApplyAESSecurityProvider()` is commented out on some open and save
 * paths. Inspecting real files answered it, and the answer is **all three**:
 *
 * | File | First bytes | Format |
 * |---|---|---|
 * | `smq-code-smartquote/App/SmartQuote/mock-test.sqd` | `7b 22 53 6d …` (`{"Sm…`) | **plaintext JSON** |
 * | `smq-code-license/…/template-files/2/1.sqd` | `0a f5 4a 43 …` | **AES-256-CBC** |
 * | `smq-package-smartquote/data/SSA$$-00007.sqd` | `00 01 00 00 00 ff ff ff ff 01 00 00 00` | **.NET BinaryFormatter** |
 *
 * The third is the one that matters for planning. `00 01 00 00 00 FF FF FF FF 01` is the
 * .NET `SerializationHeaderRecord`, so those files are not encrypted at all — they are
 * `BinaryFormatter` output, written by a path the analysis had recorded as dead
 * (`SaveLoadFileCombo.cs`). It is not dead: it produced the shipped sample data.
 *
 * Reading `BinaryFormatter` from Node means reimplementing a .NET-specific object graph
 * with type metadata. That is not a reasonable dependency for reading a quote, so this
 * reader **detects it and refuses with an explanation** rather than returning a partial
 * result. Converting one is a .NET job — a small C# tool that loads the file through the
 * app's own reader and writes JSON — and belongs with the importer, not here.
 *
 * A partial read would be worse than a refusal: a quote that half-parses produces a
 * plausible wrong price, which is the failure this whole product exists to avoid.
 */

import { createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * The AES key and IV, verbatim from `XSaveQuotationFileService.cs`.
 *
 * Hardcoded in the application, so they are obfuscation rather than encryption. They are
 * reproduced here to read existing files, and **nothing new should ever be written with
 * them** — see `writeQuoteFile` for what this build does instead.
 */
const LEGACY_AES_KEY = Buffer.from('zbbsjpweemscjjsfyiccwpdfzyemlccx', 'utf8');
const LEGACY_AES_IV = Buffer.from('mzkcaxeisaiyljwh', 'utf8');

/** The .NET `BinaryFormatter` header: 00 01 00 00 00 FF FF FF FF 01 00 00 00. */
const BINARY_FORMATTER_HEADER = Buffer.from([
  0x00, 0x01, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0x01, 0x00, 0x00, 0x00,
]);

export type QuoteFileFormat = 'json' | 'aes' | 'binaryformatter' | 'empty' | 'unknown';

/** One revision, as the file stores it — a loose shape, because the file is not ours. */
export interface RawRevision {
  RevisionId?: number;
  RevisionName?: string;
  RevisionDescription?: string;
  CompanyCode?: string;
  CompanyName?: string;
  QuoteNumber?: string;
  ContractPrice?: number;
  QuoteDeposite?: number;
  QuotePayment?: number;
  QuoteBalance?: number;
  QuoteTotalCostOld?: number;
  QuoteCreated?: string;
  QuoteLastEdited?: string;
  [key: string]: unknown;
}

/** A parsed quote file. */
export interface QuoteFile {
  format: QuoteFileFormat;
  /** Revisions, oldest first. Empty when the file could not be read. */
  revisions: RawRevision[];
  /** Set when `format` is not `json` or `aes`, explaining why there is no data. */
  refusal?: string;
}

/** Detect the format from the leading bytes, without decrypting. */
export function detectFormat(bytes: Buffer): QuoteFileFormat {
  if (bytes.length === 0) return 'empty';

  // A JSON file may start with a BOM or whitespace before the brace.
  const firstNonWhitespace = bytes.findIndex((byte) => byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d);
  if (firstNonWhitespace >= 0 && bytes[firstNonWhitespace] === 0x7b) return 'json';

  if (bytes.length >= BINARY_FORMATTER_HEADER.length && bytes.subarray(0, BINARY_FORMATTER_HEADER.length).equals(BINARY_FORMATTER_HEADER)) {
    return 'binaryformatter';
  }

  // AES-CBC with a fixed IV produces a whole number of blocks and no prefix, so there is
  // nothing in the bytes to identify it positively. A length that is a multiple of 16 and
  // at least one block is the signature; anything else is genuinely unknown.
  if (bytes.length % 16 === 0 && bytes.length >= 16) return 'aes';

  return 'unknown';
}

/** Decrypt a legacy AES-CBC payload. Throws when the padding is invalid. */
function decryptLegacy(bytes: Buffer): string {
  const decipher = createDecipheriv('aes-256-cbc', LEGACY_AES_KEY, LEGACY_AES_IV);
  // Node strips PKCS#7 padding and throws when it is malformed, which is exactly the
  // signal that these bytes were not encrypted with this key.
  return Buffer.concat([decipher.update(bytes), decipher.final()]).toString('utf8');
}

/**
 * Read a `.sqd` file.
 *
 * Never throws for a file it cannot read: it returns a `refusal` explaining why, because
 * the caller is a screen that has to say something to a person, and "unexpected token <"
 * is not that something.
 */
export function readQuoteFile(path: string): QuoteFile {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    return {
      format: 'unknown',
      revisions: [],
      refusal: `The file could not be opened: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const format = detectFormat(bytes);

  if (format === 'empty') {
    return { format, revisions: [], refusal: 'The file is empty.' };
  }

  if (format === 'binaryformatter') {
    return {
      format,
      revisions: [],
      refusal:
        'This quote was written by the old app\u2019s .NET BinaryFormatter path, not as JSON or AES-' +
        'encrypted JSON. It predates the format this build reads. Converting it needs a small .NET ' +
        'tool that loads the file through the old reader and writes JSON; nothing was read, so no ' +
        'price from this file should be quoted.',
    };
  }

  if (format === 'unknown') {
    return {
      format,
      revisions: [],
      refusal:
        `The file is neither JSON, nor AES-encrypted JSON, nor a .NET binary quote (${bytes.length} bytes). ` +
        'It was not read.',
    };
  }

  let text: string;
  if (format === 'json') {
    text = bytes.toString('utf8');
  } else {
    try {
      text = decryptLegacy(bytes);
    } catch {
      return {
        format: 'aes',
        revisions: [],
        refusal:
          'The file looks AES-encrypted but did not decrypt with the application\u2019s embedded key. ' +
          'It may have been written with a different key, or it may not be a quote file at all.',
      };
    }
  }

  try {
    const parsed = JSON.parse(text) as { SmartQuoteVersions?: unknown };
    const revisions = Array.isArray(parsed.SmartQuoteVersions)
      ? (parsed.SmartQuoteVersions as RawRevision[])
      : [];
    return { format, revisions };
  } catch {
    return {
      format,
      revisions: [],
      refusal:
        'The file decrypted but is not the quote JSON this build expects. It was not read, so it must not be treated as a source of prices.',
    };
  }
}

/**
 * A human-readable summary of what was in a quote file.
 *
 * Deliberately a text report rather than an object: the only consumer today is the golden
 * harness, where the job is to put the old numbers next to the new ones so a person can
 * compare them. The engine's figures are *expected* to differ from the old system's in the
 * documented ways, so an automatic equality check would fail on every quote.
 */
export function summariseQuoteFile(file: QuoteFile): string {  if (file.refusal !== undefined) {
    return `  refused (${file.format}): ${file.refusal}\n\n`;
  }

  if (file.revisions.length === 0) {
    return '  read, but it carries no revisions.\n\n';
  }

  const lines: string[] = [];
  lines.push(`  format ${file.format}, ${file.revisions.length} revision(s)\n`);

  for (const revision of file.revisions) {
    const money = (value: unknown): string =>
      typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(2)}` : '—';

    lines.push(`  revision ${revision.RevisionId ?? '?'}  "${revision.RevisionName ?? ''}"\n`);
    lines.push(`    quote number   ${revision.QuoteNumber ?? '—'}\n`);
    lines.push(`    company        ${revision.CompanyName ?? '—'} (${revision.CompanyCode ?? '—'})\n`);
    // The old file stores dollars as a real, not cents. They are printed as they are:
    // converting here would invite a comparison between two different units.
    lines.push(`    contract price ${money(revision.ContractPrice)}   (old file, dollars)\n`);
    lines.push(`    deposit        ${money(revision.QuoteDeposite)}\n`);
    lines.push(`    progress       ${money(revision.QuotePayment)}\n`);
    lines.push(`    balance        ${money(revision.QuoteBalance)}\n`);
    lines.push(`    last edited    ${revision.QuoteLastEdited ?? '—'}\n`);
  }

  return `${lines.join('')}\n`;
}

/**
 * What a caller supplies to write a `.sqd` file.
 *
 * The fields are the ones the old app's reader actually uses: `RevisionId` to order and select,
 * `RevisionName`/`RevisionDescription` for the manage-revisions screen, and the money and identity
 * a person reads. Everything else in the old 125-property `MQuotation` is either reproduced by this
 * build elsewhere or was never read by the desktop's own loader.
 */
export interface WritableRevision {
  /** 1-based and monotonic; `CurrentRevision` in the metadata names one of these. */
  revision: number;
  name: string;
  description?: string;
  companyName: string;
  companyCode?: string;
  quoteNumber: string;
  /** **Dollars**, not cents — the old file stores dollars as a real, and the reader prints them. */
  contractPrice: number;
  deposit: number;
  progress: number;
  balance: number;
  createdAt: string;
  lastEdited?: string;
}

/** What a caller supplies to write a whole file. */
export interface WritableQuoteFile {
  revisions: WritableRevision[];
  /** The revision the app should open on. Defaults to the last one. */
  currentRevision?: number;
}

/**
 * Write a `.sqd` file the old app can open.
 *
 * ## Why plain JSON and not the legacy AES
 *
 * The desktop's own reader **auto-detects**: if the first non-whitespace byte is `{` it parses the
 * text as JSON, and only otherwise tries AES. So a plaintext file is the format that both this
 * build and the old app read without sharing a hardcoded key — and the key in `LEGACY_AES_KEY` is
 * obfuscation, not encryption, so writing with it would add ceremony and no secrecy.
 *
 * ## Why the property names are the old spellings
 *
 * `QuoteDeposite` (sic), `Coeffcient`, `LastOrderForManufater` are the desktop's own names, and
 * Newtonsoft's deserialiser and this reader are both case-sensitive. "Fixing" the spelling here
 * produces a file the old app silently reads as zero.
 *
 * ## Why `VersionMetadata` is written even though this reader ignores it
 *
 * The desktop's `LoadQuotationFromFile` reads `CurrentRevision` to decide which revision to open.
 * A file without it opens on nothing, which looks like a corrupt file to the person holding it.
 */
export function writeQuoteFile(file: WritableQuoteFile): Buffer {
  if (file.revisions.length === 0) {
    throw new Error('A quote file needs at least one revision.');
  }

  const revisions = [...file.revisions].sort((a, b) => a.revision - b.revision);
  const current = file.currentRevision ?? (revisions[revisions.length - 1] as WritableRevision).revision;

  const versions = revisions.map((revision) => ({
    RevisionId: revision.revision,
    RevisionName: revision.name,
    RevisionDescription: revision.description ?? '',
    CompanyCode: revision.companyCode ?? '',
    CompanyName: revision.companyName,
    QuoteNumber: revision.quoteNumber,
    // Dollars, as a JSON number. The reader tests `typeof === 'number'` before printing.
    ContractPrice: revision.contractPrice,
    QuoteDeposite: revision.deposit,
    QuotePayment: revision.progress,
    QuoteBalance: revision.balance,
    QuoteCreated: revision.createdAt,
    QuoteLastEdited: revision.lastEdited ?? revision.createdAt,
  }));

  const now = new Date().toISOString();
  const document = {
    SmartQuoteVersions: versions,
    VersionMetadata: {
      CurrentRevision: current,
      TotalVersions: versions.length,
      CreatedAt: revisions[0]?.createdAt ?? now,
      LastUpdated: now,
    },
  };

  // No BOM: `detectFormat` skips whitespace but not a BOM, so a BOM-prefixed file would fall
  // through to the AES branch and be refused.
  return Buffer.from(JSON.stringify(document, null, 2), 'utf8');
}

/**
 * Read a `.sqd` file from bytes, so a route can accept an upload without touching the disk.
 *
 * Shares every branch with `readQuoteFile` except the file read; kept as one implementation so the
 * two cannot disagree about what a format means.
 */
export function readQuoteFileBytes(bytes: Buffer): QuoteFile {
  const format = detectFormat(bytes);

  if (format === 'empty') return { format, revisions: [], refusal: 'The file is empty.' };

  if (format === 'binaryformatter') {
    return {
      format,
      revisions: [],
      refusal:
        'This quote was written by the old app\u2019s .NET BinaryFormatter path, not as JSON or AES-' +
        'encrypted JSON. It predates the format this build reads, so nothing was read.',
    };
  }

  if (format === 'unknown') {
    return {
      format,
      revisions: [],
      refusal: `The file is neither JSON, nor AES-encrypted JSON, nor a .NET binary quote (${bytes.length} bytes).`,
    };
  }

  let text: string;
  if (format === 'json') {
    text = bytes.toString('utf8');
  } else {
    try {
      text = decryptLegacy(bytes);
    } catch {
      return {
        format: 'aes',
        revisions: [],
        refusal:
          'The file looks AES-encrypted but did not decrypt with the application\u2019s embedded key.',
      };
    }
  }

  try {
    const parsed = JSON.parse(text) as { SmartQuoteVersions?: unknown };
    const revisions = Array.isArray(parsed.SmartQuoteVersions)
      ? (parsed.SmartQuoteVersions as RawRevision[])
      : [];
    return { format, revisions };
  } catch {
    return {
      format,
      revisions: [],
      refusal: 'The file decrypted but is not the quote JSON this build expects.',
    };
  }
}
