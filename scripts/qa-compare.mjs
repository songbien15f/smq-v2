/**
 * Before | after contact sheets, one image per camera angle.
 *
 *   node scripts/qa-compare.mjs
 *
 * For every `before/<name>.png` with an `after/<name>.png`, this measures how many pixels actually
 * changed and, when the change is real, writes a single side-by-side image to `compare/`:
 *
 *     TRƯỚC — M4 · xà portal              |  SAU — M4 · xà portal
 *     <before half>                        |  <after half>
 *
 * ## Why a threshold
 *
 * A re-render is never byte-identical: shadows jitter, antialiasing differs by a subpixel. An image
 * that only differs by that is not evidence of anything, so a pair under **0.5 %** changed pixels
 * (each channel off by more than 8) is skipped and named in the README instead.
 *
 * ## Why a browser and a canvas
 *
 * `sharp` is not installed and this repo does not need another image dependency for a QA script. The
 * PNGs are handed to Chromium as data URLs, drawn on a canvas, diffed there and composited there; the
 * result comes back as one PNG. Nothing is uploaded anywhere.
 */

import { chromium } from '@playwright/test';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const BASE = join(ROOT, 'docs/qa/screens/2026-11-24-guest');
const OUT = join(BASE, 'compare');

/** The bug each shot is evidence for. The label on the image says what a person should look at. */
const CAPTIONS = {
  '3d-overview-roof': { code: 'E9', what: 'mái / tường cùng màu', slug: 'e9' },
  '3d-overview-noroof': { code: 'M4', what: 'xà portal', slug: 'm4' },
  '3d-eave-left-roof': { code: 'M4', what: 'tab xám dưới máng', slug: 'm4' },
  '3d-eave-left-noroof': { code: 'M4', what: 'đầu xà thò ra', slug: 'm4' },
  '3d-downpipe-front-left': { code: 'M3', what: 'downpipe cách tường', slug: 'm3' },
  '3d-downpipe-base': { code: 'M3', what: 'chân downpipe', slug: 'm3' },
  '3d-window-close': { code: 'Khung cửa sổ', what: 'khung nhô khỏi tường', slug: 'cua-so' },
  '3d-window-oblique': { code: 'Khung cửa sổ', what: 'độ nhô nhìn nghiêng', slug: 'cua-so' },
  '2d-plan-fit': { code: '2D', what: 'mặt bằng', slug: '2d', noChange: true },
  '2d-plan-window': { code: '2D', what: 'ký hiệu cửa sổ', slug: '2d', noChange: true },
};

/**
 * Pairs whose *before* image cannot be used as evidence.
 *
 * - The eave shots are NOT here: the pre-E6 page still toggled its label ("Hide roof"/"Show roof"), so
 *   the old script shot `before/` correctly. Only the round-3 `after/` shots were swapped, and those
 *   were re-shot in round 4.
 * - The 390 px 2D shots: the panel was 2 px tall at that width (a real CSS bug fixed in round 4), so the
 *   `before` files are 358×3 — 142 bytes of nothing. There is no valid before; only the after exists.
 */
const BAD_BEFORE = new Map([
  ['390-2d-plan-fit.png', 'ảnh before rỗng 358×3 — panel 2D cao 2 px ở 390 (bug CSS, đã sửa vòng 4)'],
  ['390-2d-plan-window.png', 'ảnh before rỗng 358×3 — panel 2D cao 2 px ở 390 (bug CSS, đã sửa vòng 4)'],
]);

const THRESHOLD_PCT = 0.5;
const CHANNEL_DELTA = 8;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();

const files = (await readdir(join(BASE, 'after'))).filter((f) => f.endsWith('.png')).sort();
await mkdir(OUT, { recursive: true });

const made = [];
const skipped = [];

for (const file of files) {
  if (BAD_BEFORE.has(file)) {
    skipped.push({ file, why: BAD_BEFORE.get(file) });
    continue;
  }
  const beforePath = join(BASE, 'before', file);
  const afterPath = join(BASE, 'after', file);
  let beforeBytes;
  let afterBytes;
  try {
    beforeBytes = await readFile(beforePath);
    afterBytes = await readFile(afterPath);
  } catch {
    skipped.push({ file, why: 'no matching before/after' });
    continue;
  }

  const key = file.replace(/^(1919|390)-/, '').replace(/\.png$/, '');
  const viewport = file.startsWith('1919') ? '1919' : '390';

  const result = await page.evaluate(
    async ([b64a, b64b, caption, vp, threshold, delta]) => {
      const load = async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        return img;
      };
      const a = await load(b64a);
      const b = await load(b64b);

      const px = (img) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height);
      };
      const da = px(a);
      const db = px(b);
      if (da.width !== db.width || da.height !== db.height) return { error: 'size differs' };

      let changed = 0;
      for (let i = 0; i < da.data.length; i += 4) {
        if (
          Math.abs(da.data[i] - db.data[i]) > delta ||
          Math.abs(da.data[i + 1] - db.data[i + 1]) > delta ||
          Math.abs(da.data[i + 2] - db.data[i + 2]) > delta
        ) {
          changed += 1;
        }
      }
      const pct = (changed / (da.data.length / 4)) * 100;
      if (pct < threshold) return { pct, skip: true };

      /*
       * Compose: header strip + two halves + divider.
       *
       * The header is two lines, always: the pair labels on the first, the viewport and the diff on the
       * second, right-aligned. One line put "…% điểm ảnh đổi" on top of the SAU label as soon as the
       * halves were 390 px wide (round 3).
       */
      const header = 54;
      const gap = 6;
      const width = a.width + gap + b.width;
      const height = header + a.height;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = '#0b1d4d';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`TRƯỚC — ${caption}`, 10, 18);
      ctx.fillText(`SAU — ${caption}`, a.width + gap + 10, 18);
      ctx.font = '13px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${vp} px · ${pct.toFixed(2)} % điểm ảnh đổi`, width - 10, 40);
      ctx.textAlign = 'left';

      ctx.drawImage(a, 0, header);
      ctx.drawImage(b, a.width + gap, header);

      // The divider, drawn last so it covers both edges.
      ctx.fillStyle = '#0b1d4d';
      ctx.fillRect(a.width, 0, gap, height);

      return { pct, dataUrl: canvas.toDataURL('image/png') };
    },
    [
      beforeBytes.toString('base64'),
      afterBytes.toString('base64'),
      `${CAPTIONS[key]?.code ?? ''} · ${CAPTIONS[key]?.what ?? key}`.trim(),
      viewport,
      THRESHOLD_PCT,
      CHANNEL_DELTA,
    ],
  );

  if (result.error !== undefined) {
    skipped.push({ file, why: result.error });
    continue;
  }
  if (result.skip === true) {
    skipped.push({ file, why: `${result.pct.toFixed(2)} % — dưới ngưỡng` });
    continue;
  }
  if (CAPTIONS[key]?.noChange === true) {
    // A view this plan must not change. Whatever the diff, it is antialiasing, not evidence.
    skipped.push({ file, why: `${result.pct.toFixed(2)} % — không có thay đổi có chủ đích (2D)` });
    continue;
  }

  const name = `${CAPTIONS[key]?.slug ?? 'x'}-${viewport}-${key}.png`;
  await writeFile(join(OUT, name), Buffer.from(result.dataUrl.split(',')[1], 'base64'));
  made.push({ name, file, pct: Math.round(result.pct * 100) / 100 });
  console.log(`${name}  ${result.pct.toFixed(2)} %`);
}

await browser.close();

console.log(`\n${made.length} contact sheets · ${skipped.length} pairs skipped`);
for (const s of skipped) console.log(`  skip ${s.file}: ${s.why}`);
await writeFile(join(OUT, 'index.json'), JSON.stringify({ made, skipped }, null, 2));
