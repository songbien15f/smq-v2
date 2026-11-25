/**
 * Before/after screenshots for the Guest page's 3D and 2D geometry (plan 2026-11-24, Phase 0).
 *
 * Not a test. It drives a real browser at a fixed design, a fixed camera and fixed viewports, so the
 * "before" and "after" of a 5 mm change can be compared side by side. Run by hand:
 *
 *   node scripts/qa-guest-shots.mjs --label before
 *   node scripts/qa-guest-shots.mjs --label after
 *
 * ## Why a fixed camera exists at all
 *
 * The camera hook is `window.__sqQaCamera`, installed by `packages/viewer3d/src/ShedViewer.tsx` in
 * development builds only. Dragging to the same angle twice is not repeatable; coordinates are.
 *
 * ## The design is written, not clicked
 *
 * `localStorage['sq.guest.v1']` is the page's own save format (`apps/site/src/app/quote/store.ts`), so
 * seeding it with `addInitScript` reaches the same design a person would build, without a single click
 * that might land differently after a UI change. The design lives in `scripts/qa-guest-design.json`.
 *
 * Places is stubbed for the same reason `e2e/guestQuote.spec.ts` stubs it: a screenshot run must not
 * spend Google money or need a network.
 */

import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DESIGN_FILE = join(HERE, 'qa-guest-design.json');
const BASE = process.env.QA_BASE ?? 'http://localhost:3063';

/** `--label before|after`, `--out <dir>`. */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const label = arg('label', 'before');
if (label !== 'before' && label !== 'after') {
  console.error('usage: node scripts/qa-guest-shots.mjs --label before|after [--out <dir>]');
  process.exit(2);
}
const outRoot = resolve(arg('out', join(ROOT, 'docs/qa/screens/2026-11-24-guest')));

const VIEWPORTS = [
  { name: '1919', width: 1919, height: 998 },
  { name: '390', width: 390, height: 844 },
];

const PLACES_OFF = {
  ok: false,
  code: 'unavailable',
  message: 'Address suggestions are not available.',
};

/** The shed design this run photographs, in mm — Garage 6 × 6 × 3 m, gable 10°, a window on the left. */
const design = JSON.parse(await readFile(DESIGN_FILE, 'utf8'));

/** S = 6, L = 6, H = 3 (metres). The window sits at u 2400, sill 0, 900 × 900 (mm). */
const W = { u: 2.4, sill: 0, w: 0.9, h: 0.9 };

async function main() {
  const dir = join(outRoot, label);
  await mkdir(dir, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome' });
  const meta = { label, at: new Date().toISOString(), design, shots: [] };

  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });

      // The page's save format, written before any script on the page runs.
      await context.addInitScript(
        ([saved]) => {
          window.localStorage.setItem('sq.guest.v1', JSON.stringify(saved));
        },
        [
          {
            v: 2,
            design,
            step: 'design',
            source: {},
            revisionOf: null,
            designSeen: true,
            draftId: null,
          },
        ],
      );

      const page = await context.newPage();
      await page.route('**/api/sq/public/guest/places/**', (route) =>
        route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify(PLACES_OFF) }),
      );

      await page.goto(`${BASE}/quote?step=design`);
      await page.waitForTimeout(2500);

      /*
       * The design is seeded, but the page still gates step ② on contact details, which are memory-only
       * on purpose (Q2). So the run fills them the way a person would and presses Continue. The values
       * are the test ones the rest of the repo uses; nothing is sent anywhere.
       */
      if (!page.url().includes('step=design')) {
        await page.fill('#g-first-name', 'Test');
        await page.fill('#g-last-name', 'Guest');
        await page.fill('#g-email', 'test.guest+qa@example.com');
        await page.fill('#g-mobile', '0412 345 678');
        await page.waitForTimeout(400);
        await page.evaluate(() => {
          [...document.querySelectorAll('button')].find((b) => /^Continue to Build/.test((b.textContent ?? '').trim()))?.click();
        });
        await page.waitForTimeout(4000);
      }
      if (!page.url().includes('step=design')) {
        throw new Error(`could not reach step=design (at ${page.url()})`);
      }

      const shot = async (name, locator) => {
        const target = locator ?? page.locator('.g-stage-3d');
        await target.screenshot({ path: join(dir, `${vp.name}-${name}.png`) });
        meta.shots.push(`${vp.name}-${name}.png`);
      };

      const setCamera = async (position, target) => {
        await page.evaluate(([p, t]) => window.__sqQaCamera?.(p, t), [position, target]);
        await page.waitForTimeout(800);
      };
      const click = async (selector) => {
        await page.evaluate((sel) => document.querySelector(sel)?.click(), selector);
        await page.waitForTimeout(700);
      };
      /*
       * The roof toggle. Its label is fixed ("Hide roof") since E6; the state is `aria-pressed`, and
       * `true` means the roof is **hidden**. Reading the attribute rather than the label is what keeps
       * this honest: the label stopped changing, so a label-based search silently did nothing and the
       * "roof" and "no roof" shots came out swapped.
       */
      const showRoof = async (on) => {
        const wantHidden = !on;
        const before = await page.evaluate(() => {
          const button = [...document.querySelectorAll('.g-stage-tools button')].find((b) =>
            /^Hide roof$/.test((b.textContent ?? '').trim()),
          );
          return button === undefined ? null : button.getAttribute('aria-pressed') === 'true';
        });
        if (before === null) throw new Error('roof toggle not found');
        if (before !== wantHidden) {
          await page.evaluate(() => {
            const button = [...document.querySelectorAll('.g-stage-tools button')].find((b) =>
              /^Hide roof$/.test((b.textContent ?? '').trim()),
            );
            button?.click();
          });
          await page.waitForTimeout(700);
        }
        const after = await page.evaluate(() => {
          const button = [...document.querySelectorAll('.g-stage-tools button')].find((b) =>
            /^Hide roof$/.test((b.textContent ?? '').trim()),
          );
          return button === undefined ? null : button.getAttribute('aria-pressed') === 'true';
        });
        if (after !== wantHidden) {
          throw new Error(`roof toggle ended in the wrong state: wanted hidden=${wantHidden}, got ${after}`);
        }
      };

      // 3D is the default tab; make sure of it.
      await click('#g-view-3d');
      await page.waitForTimeout(900);

      // 1–2. Overview, roof on then off, at the viewer's own framing.
      await showRoof(true);
      await shot('3d-overview-roof');
      await showRoof(false);
      await shot('3d-overview-noroof');

      // 3–4. The left eave, looking along the wall, roof on and off: the rafter end and the gray tab.
      await setCamera([-2.5, 2.6, 1.5], [0, 2.8, 1.5]);
      await showRoof(true);
      await shot('3d-eave-left-roof');
      await showRoof(false);
      await shot('3d-eave-left-noroof');

      // 5–6. The front-left downpipe: the gap to the wall, then its foot.
      await showRoof(true);
      await setCamera([-1.5, 1.2, -1.5], [0, 1.0, 0.5]);
      await shot('3d-downpipe-front-left');
      await setCamera([-1.0, 0.4, -0.2], [0, 0, 0.5]);
      await shot('3d-downpipe-base');

      // 7–8. The window on the left wall: square on, then 45° off to read the frame's depth.
      const wy = W.sill + W.h / 2;
      const wz = W.u + W.w / 2;
      await setCamera([-2.0, wy, wz], [0, wy, wz]);
      await shot('3d-window-close');
      await setCamera([-1.6, wy + 0.5, wz - 1.6], [0, wy, wz]);
      await shot('3d-window-oblique');

      // 9–10. The 2D plan, which this plan must not change.
      await click('#g-view-2d');
      await page.waitForTimeout(900);
      await shot('2d-plan-fit', page.locator('.g-stage-view'));
      // Zoom in twice about the window's side, using the page's own zoom buttons.
      await page.evaluate(() => {
        const zoomIn = [...document.querySelectorAll('button')].find((b) =>
          /zoom in/i.test(b.getAttribute('aria-label') ?? b.getAttribute('title') ?? ''),
        );
        zoomIn?.click();
        zoomIn?.click();
      });
      await page.waitForTimeout(900);
      await shot('2d-plan-window', page.locator('.g-stage-view'));

      await context.close();
      console.log(`${vp.name}: ${meta.shots.length} shots so far`);
    }

    meta.commit = process.env.QA_COMMIT ?? '';
    await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    console.log(`\nwrote ${meta.shots.length} screenshots to ${dir}`);
  } finally {
    await browser.close();
  }
}

await main();
