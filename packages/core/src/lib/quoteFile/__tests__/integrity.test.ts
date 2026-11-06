import { describe, expect, it } from 'vitest';
import { canonicalJson, checkIntegrity, integrityBlock, integrityDigest } from '../integrity';
import { readQuoteFileBytes, writeQuoteFile } from '../sqd';

/**
 * The `Integrity` block: a `.sqd` proving it was not edited after it was written.
 *
 * This is *not* the byte hash the template file store keeps. That proves nothing changed on disk;
 * this proves an **emailed** file — whose bytes no server ever saw — still says what its author
 * wrote. Two different questions, and the tests below are about the second one.
 */
function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    SmartQuoteVersions: [
      {
        RevisionId: 1,
        RevisionName: 'Initial',
        CompanyCode: 'ACME',
        CompanyName: 'Acme Sheds',
        QuoteNumber: 'Q-2026-0001',
        ContractPrice: 30118.63,
      },
    ],
    VersionMetadata: { CurrentRevision: 1, TotalVersions: 1 },
    ...overrides,
  };
}

describe('canonicalJson', () => {
  it('sorts keys, so two spellings of one document hash the same', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('keeps array order, because an array is a sequence', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('drops undefined, which JSON.stringify would too', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('writes no whitespace, so reformatting cannot change a digest', () => {
    expect(canonicalJson({ a: [1, { b: 2 }] })).toBe('{"a":[1,{"b":2}]}');
  });
});

describe('integrityDigest', () => {
  it('ignores the Integrity member, because a digest cannot contain itself', () => {
    const withBlock = document({ Integrity: { Digest: 'x' } });
    expect(integrityDigest(withBlock)).toBe(integrityDigest(document()));
  });

  it('changes when any field changes', () => {
    const before = integrityDigest(document());
    const after = integrityDigest({ ...document(), VersionMetadata: { CurrentRevision: 2, TotalVersions: 1 } });
    expect(after).not.toBe(before);
  });

  it('does not change when only key order changes', () => {
    const a = integrityDigest({ SmartQuoteVersions: [], VersionMetadata: { a: 1, b: 2 } });
    const b = integrityDigest({ VersionMetadata: { b: 2, a: 1 }, SmartQuoteVersions: [] });
    expect(a).toBe(b);
  });
});

describe('checkIntegrity', () => {
  const issuedAt = '2026-11-06T00:00:00.000Z';

  it('says absent when there is no block, which is not an error', () => {
    // A file from the old desktop, or one written before this existed, is still readable. Calling
    // that "invalid" would refuse every older file.
    expect(checkIntegrity(document()).verdict).toBe('absent');
  });

  it('accepts a document whose digest matches', () => {
    const doc = document();
    doc.Integrity = integrityBlock(doc, issuedAt, 'ACME');
    const result = checkIntegrity(doc);
    expect(result.verdict).toBe('valid');
  });

  it('rejects a document with one field changed, and returns both digests', () => {
    /*
     * The case the block exists for: somebody edits the contract price in an emailed file. The
     * digests come back so a person can compare against the copy they trust — "the file is corrupt"
     * with no values is a message nobody can act on.
     */
    const doc = document();
    doc.Integrity = integrityBlock(doc, issuedAt, 'ACME');
    const original = (doc.Integrity as { Digest: string }).Digest;

    const tampered = structuredClone(doc);
    (tampered.SmartQuoteVersions as { ContractPrice: number }[])[0]!.ContractPrice = 999.99;

    const result = checkIntegrity(tampered);
    expect(result.verdict).toBe('invalid');
    expect(result.expected).toBe(original);
    expect(result.actual).not.toBe(original);
  });

  it('rejects a document whose digest was updated to hide the edit is not possible without the rest', () => {
    // A forger who recomputes the digest after editing it produces a **valid** file — the block
    // proves the file is internally consistent, not that its author is honest. Stated as a test so
    // nobody later believes this is a signature.
    const doc = document();
    doc.Integrity = integrityBlock(doc, issuedAt, 'ACME');
    const forged = structuredClone(doc);
    (forged.SmartQuoteVersions as { ContractPrice: number }[])[0]!.ContractPrice = 999.99;
    forged.Integrity = integrityBlock(forged, issuedAt, 'ACME');
    expect(checkIntegrity(forged).verdict).toBe('valid');
  });

  it('says unsupported for an algorithm it cannot check, rather than invalid', () => {
    // Calling a SHA-512 claim "invalid" would report a file as corrupt because this build cannot
    // read its claim.
    const doc = document();
    doc.Integrity = { Algorithm: 'SHA-512', Canonicalisation: 'RFC8785', Digest: 'ab'.repeat(32) };
    expect(checkIntegrity(doc).verdict).toBe('unsupported');
  });

  it('says unsupported for a malformed digest', () => {
    const doc = document();
    doc.Integrity = { Algorithm: 'SHA-256', Canonicalisation: 'RFC8785', Digest: 'not-hex' };
    expect(checkIntegrity(doc).verdict).toBe('unsupported');
  });
});

describe('a written .sqd carries a block that its own reader accepts', () => {
  const bytes = () =>
    writeQuoteFile({
      revisions: [
        {
          revision: 1,
          name: 'Initial',
          description: '',
          companyCode: 'ACME',
          companyName: 'Acme Sheds',
          quoteNumber: 'Q-2026-0001',
          contractPrice: 30118.63,
          deposit: 3011.86,
          progress: 21083.04,
          balance: 6023.73,
          createdAt: '2026-11-06T00:00:00Z',
        },
      ],
      currentRevision: 1,
    });

  it('round-trips: written then read is valid', () => {
    const file = readQuoteFileBytes(bytes());
    expect(file.integrity).toBe('valid');
    expect(file.revisions).toHaveLength(1);
    expect(file.revisions[0]?.CompanyCode).toBe('ACME');
  });

  it('names the issuer from the newest revision, so a recipient knows who wrote it', () => {
    const parsed = JSON.parse(bytes().toString('utf8')) as {
      Integrity: { Issuer: string; Algorithm: string; Digest: string };
    };
    expect(parsed.Integrity.Issuer).toBe('ACME');
    expect(parsed.Integrity.Algorithm).toBe('SHA-256');
    expect(parsed.Integrity.Digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports invalid, with both digests, when the file is edited after writing', () => {
    const original = bytes().toString('utf8');
    // A plausible edit: the customer's price.
    const tampered = original.replace('30118.63', '29999.99');
    expect(tampered).not.toBe(original);

    const file = readQuoteFileBytes(Buffer.from(tampered, 'utf8'));
    expect(file.integrity).toBe('invalid');
    expect(file.integrityDetail?.expected).toMatch(/^[0-9a-f]{64}$/);
    expect(file.integrityDetail?.actual).toMatch(/^[0-9a-f]{64}$/);
    expect(file.integrityDetail?.actual).not.toBe(file.integrityDetail?.expected);
  });

  it('still reads a file that has no block at all', () => {
    // The old desktop's format. `absent` must not refuse it — that would make every legacy file
    // unreadable, which is the opposite of the point.
    const withoutBlock = JSON.stringify({
      SmartQuoteVersions: [
        {
          RevisionId: 1,
          RevisionName: 'Old',
          CompanyCode: 'OLDCO',
          CompanyName: 'Old Co',
          QuoteNumber: 'Q-OLD-1',
          ContractPrice: 100,
          QuoteDeposite: 10,
          QuotePayment: 70,
          QuoteBalance: 20,
          QuoteCreated: '2020-01-01T00:00:00Z',
          QuoteLastEdited: '2020-01-01T00:00:00Z',
        },
      ],
    });
    const file = readQuoteFileBytes(Buffer.from(withoutBlock, 'utf8'));
    expect(file.integrity).toBe('absent');
    expect(file.revisions).toHaveLength(1);
    expect(file.refusal).toBeUndefined();
  });

  it('does not change the digest when the file is only reformatted', () => {
    // A file that was pretty-printed or minified by some tool is the same quote, so it must still
    // read as valid — that is why the digest is over canonical JSON and not over the text.
    const text = bytes().toString('utf8');
    const reformatted = JSON.stringify(JSON.parse(text));
    expect(reformatted).not.toBe(text);
    expect(readQuoteFileBytes(Buffer.from(reformatted, 'utf8')).integrity).toBe('valid');
  });
});
