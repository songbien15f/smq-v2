import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLogo, sniffImageMime, MAX_LOGO_BYTES } from '@/lib/branding/logo';

/** A 1x1 PNG, byte for byte. */
const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082',
  'hex',
);

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sq-logo-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('sniffImageMime', () => {
  it('recognises PNG by its magic bytes', () => {
    expect(sniffImageMime(PNG_1PX)).toBe('image/png');
  });

  it('refuses SVG', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImageMime(svg)).toBeNull();
  });

  it('refuses a file that only claims to be a PNG', () => {
    const text = Buffer.from('this is not an image, whatever the extension says');
    expect(sniffImageMime(text)).toBeNull();
  });
});

describe('loadLogo', () => {
  it('returns base64, dimensions and a hash for a real PNG', async () => {
    const file = join(dir, 'ok.png');
    writeFileSync(file, PNG_1PX);

    const logo = await loadLogo(file);
    expect(logo?.mime).toBe('image/png');
    expect(logo?.base64).toBe(PNG_1PX.toString('base64'));
    expect(logo?.width).toBe(1);
    expect(logo?.height).toBe(1);
    expect(logo?.sha256).toHaveLength(64);
  });

  it('returns null for a missing file rather than throwing', async () => {
    expect(await loadLogo(join(dir, 'nope.png'))).toBeNull();
    expect(await loadLogo(undefined)).toBeNull();
  });

  it('returns null for a file over the size limit', async () => {
    const file = join(dir, 'big.png');
    writeFileSync(file, Buffer.concat([PNG_1PX, Buffer.alloc(MAX_LOGO_BYTES + 1)]));
    expect(await loadLogo(file)).toBeNull();
  });
});
