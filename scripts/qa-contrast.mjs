/**
 * Mean colour of horizontal bands in a screenshot, for measuring roof-vs-wall contrast without eyes.
 *
 *   node scripts/qa-contrast.mjs <image.png> [rows]
 *
 * Loads the PNG in Chromium, draws it on a canvas and reports the mean RGB and luminance of `rows`
 * equal bands down the middle 30 % of the image. Bands, not points: a single pixel can be an edge.
 *
 * This is the measuring instrument for E9 — the roof and the wall share one paint colour, so "does the
 * roof read as a different surface" is a question about luminance and hue in the render, not about the
 * palette.
 */
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const file = process.argv[2];
const rows = Number(process.argv[3] ?? 12);
if (file === undefined) {
  console.error('usage: node scripts/qa-contrast.mjs <image.png> [rows]');
  process.exit(2);
}

const base64 = (await readFile(file)).toString('base64');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();

const result = await page.evaluate(
  async ([dataUrl, bandCount]) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const x0 = Math.round(img.width * 0.35);
    const w = Math.round(img.width * 0.3);
    const lum = ([r, g, b]) => {
      const f = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };

    const bands = [];
    const bandH = Math.floor(img.height / bandCount);
    for (let i = 0; i < bandCount; i += 1) {
      const y0 = i * bandH;
      const data = ctx.getImageData(x0, y0, w, bandH).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let dark = 0;
      const n = data.length / 4;
      for (let p = 0; p < data.length; p += 4) {
        r += data[p];
        g += data[p + 1];
        b += data[p + 2];
        if (lum([data[p], data[p + 1], data[p + 2]]) < 0.55) dark += 1;
      }
      const mean = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
      bands.push({
        band: i,
        yPct: Math.round((y0 / img.height) * 100),
        rgb: mean,
        L: Math.round(lum(mean) * 1000) / 1000,
        darkPct: Math.round((dark / n) * 10000) / 100,
      });
    }
    return { width: img.width, height: img.height, xPct: 35, wPct: 30, bands };
  },
  [`data:image/png;base64,${base64}`, rows],
);

console.log(JSON.stringify(result, null, 2));
await browser.close();
