/**
 * The platform's logo, read from a file.
 *
 * ## What this is
 *
 * One image for the whole product, not one per company: the documents and the app both carry the
 * vendor's mark, and a company's own identity is its name in the header block. That keeps this to a
 * pure function over a path — no table, no upload route, no tenant.
 *
 * ## Why the format is decided by bytes and not by the extension
 *
 * A file called `logo.png` is a claim. The check that matters is the first few bytes, and the reason
 * it matters here is concrete: this image is embedded in a document that a **customer** opens, and
 * `image/svg+xml` can carry a `<script>`. SVG is therefore refused by omission — it is not in the
 * list of magic numbers — rather than by a rule somebody has to remember to apply.
 *
 * ## Every failure is `null`
 *
 * A missing file, an unreadable one, an oversized one, one whose bytes are not an image: all of
 * them mean "no logo", and every caller answers that the same way — print the company's text logo.
 * A document must not fail to render because of an image.
 */

import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** What a caller can render. */
export interface LogoImage {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  base64: string;
  /** Pixels, or `0` when the header could not be parsed. The document sizes it with CSS anyway. */
  width: number;
  height: number;
  /** The bytes' sha256, which is what a revision freezes to keep its own logo. */
  sha256: string;
}

/** One megabyte. A logo bigger than this is a mistake, and a document is not the place to find out. */
export const MAX_LOGO_BYTES = 1024 * 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Decide what an image is from its contents.
 *
 * The three formats are the ones a browser renders from a data URI without a plugin and that cannot
 * carry script. Anything else — SVG included — returns `null`.
 */
export function sniffImageMime(
  bytes: Buffer,
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Read pixel dimensions where the format states them early.
 *
 * PNG puts them in `IHDR`, fixed at bytes 16-24. JPEG and WebP need a scan, and a scan that fails is
 * not a refusal: the dimension is only ever used to reserve space, and CSS decides the rendered
 * size. `0, 0` is an honest "not known" where a wrong number would be a wrong number.
 */
function readDimensions(bytes: Buffer, mime: LogoImage['mime']): { width: number; height: number } {
  if (mime === 'image/png' && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mime === 'image/jpeg') {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1] ?? 0;
      // SOF0..SOF15, excluding the two that are not frame headers.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      const length = bytes.readUInt16BE(offset + 2);
      if (length <= 0) break;
      offset += 2 + length;
    }
    return { width: 0, height: 0 };
  }
  if (mime === 'image/webp' && bytes.length >= 30) {
    // VP8X carries 24-bit little-endian canvas dimensions at bytes 24-30.
    const tag = bytes.subarray(12, 16).toString('ascii');
    if (tag === 'VP8X') {
      const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
      return { width, height };
    }
  }
  return { width: 0, height: 0 };
}

/**
 * Read the logo, or `null`.
 *
 * The size is checked **before** the read: loading a 5 MB file in order to reject it is the work the
 * limit exists to avoid.
 */
export async function loadLogo(path: string | undefined): Promise<LogoImage | null> {
  if (path === undefined || path.trim() === '') return null;

  try {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0 || info.size > MAX_LOGO_BYTES) return null;

    const bytes = await readFile(path);
    const mime = sniffImageMime(bytes);
    if (mime === null) return null;

    const { width, height } = readDimensions(bytes, mime);
    return {
      mime,
      base64: bytes.toString('base64'),
      width,
      height,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch {
    // A missing file, a permission error, a path that is a directory: all of them are "no logo".
    return null;
  }
}

/** The `src` a document embeds. Self-contained, so a PDF has no external reference. */
export function logoDataUri(logo: LogoImage): string {
  return `data:${logo.mime};base64,${logo.base64}`;
}
