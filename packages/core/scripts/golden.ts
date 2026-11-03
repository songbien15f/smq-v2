/**
 * The golden harness: price a set of reference buildings against the **real** licensed
 * price book and print what the engine produced.
 *
 * ## Why this exists
 *
 * Every unit test in this package runs against a hand-built lookup, so a test can pass
 * while the shipping engine is wrong: the fixture encodes the same misunderstanding as
 * the code. This script is the one path that goes through the real 75-table dump, the
 * real span table, the real sheeting spans and the real margin table, so a change that
 * only works on fixtures fails here.
 *
 * ## What it does not do yet
 *
 * It does not compare against a real **issued quote**. That is the only measurement that
 * proves the quantities match what a factory ships (`docs/DECISIONS.md` §B6), and it
 * needs the operator to supply the quotes. Until then this prints what the engine
 * computed, so a human can compare it by hand against a quote the customer was sent.
 *
 * Usage:
 *   npx tsx scripts/golden.ts                     # all presets, against the real dump
 *   npx tsx scripts/golden.ts --only "Gable"      # one, by preset name substring
 *   npx tsx scripts/golden.ts --sqd <file>        # also read a legacy quote file
 */

import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { publishPriceBook, openPublishedBook, bookKind } from '../src/lib/pricing/publish';
import { createLookup } from '../src/lib/pricing/lookup';
import { evaluateQuote } from '../src/lib/estimating/evaluate';
import { PRESETS } from '../src/domain/presets';
import { readQuoteFile, summariseQuoteFile } from '../src/lib/quoteFile/sqd';

/** The workspace root: relative configuration must not depend on the caller's cwd. */
function workspaceRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const cut = dir.lastIndexOf(sep);
    if (cut <= 0) return process.cwd();
    dir = dir.slice(0, cut);
  }
}

const args = process.argv.slice(2);

/** A flag's value, or the fallback. */
function arg(name: string, fallback: string | null = null): string | null {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined ? (args[index + 1] as string) : fallback;
}

const only = arg('--only');
const sqdPath = arg('--sqd');

const root = workspaceRoot();
const dump = resolve(root, arg('--dump', 'tools/price-dump/out'));

if (!existsSync(dump)) {
  process.stderr.write(
    `No price dump at ${dump}.\n` +
      'The golden harness needs the licensed supplier book. Run tools/price-dump/run.sh first.\n' +
      'Nothing was measured; this is not a pass.\n',
  );
  process.exitCode = 1;
  process.exit();
}

const books = mkdtempSync(join(tmpdir(), 'sq-golden-'));

/** Closed in `finally`: an open handle blocks the temp directory's removal on Windows. */
let openBook: { close: () => void } | null = null;

function closePublishedBook(): void {
  try {
    openBook?.close();
  } catch {
    /* already closed, or the book was never opened */
  }
  openBook = null;
}

try {
  const published = publishPriceBook(dump, books);
  process.stdout.write(
    `\nPrice book  ${published.hash.slice(0, 16)}  kind=${bookKind(published.hash, books)}` +
      (published.skipped.length > 0 ? `  skipped: ${published.skipped.join(', ')}` : '') +
      '\n',
  );

  const db = openPublishedBook(published.hash, books);
  openBook = db as unknown as { close: () => void };
  const lookup = createLookup(db);

  // The premise the girt fallback rests on. Printed rather than assumed: if a future
  // book ships a girt table, every girt line changes and this line says so.
  const girtTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cost_girt'")
    .get();
  process.stdout.write(
    `Girt table  ${girtTable === undefined || girtTable === null ? 'absent — girts priced from the purlin row, marked as an allowance' : 'present — girts priced from their own material'}\n\n`,
  );

  const presets = only === null ? PRESETS : PRESETS.filter((p) => p.name.includes(only));

  if (presets.length === 0) {
    process.stderr.write(`No preset matches "${only}".\n`);
    process.exitCode = 1;
  }

  for (const preset of presets) {
    // A margin of 1.48 is the book's own value for a gable shed, so the total below is
    // comparable with a real quote rather than with a made-up multiple.
    const evaluation = evaluateQuote(
      preset.config,
      {
        quoteRatePct: 0,
        depositPct: 10,
        progressPct: 70,
        deliveryCents: 0,
        engineeringCents: 0,
        extraCents: 0,
        additionsCents: 0,
        margin: 1.48,
      },
      { lookup, policy: { margin: 1.48 } } as never,
    );

    const money = (cents: number): string =>
      Number.isFinite(cents) ? `$${(cents / 100).toFixed(2).padStart(11, ' ')}` : '        —  ';

    // The lines live inside the groups, which is the shape the document renders from.
    const lines = evaluation.bom.groups.flatMap((group) => group.lines);
    const assumedCount = lines.filter((line) => line.assumed === true).length;

    process.stdout.write(`${preset.name}\n`);
    process.stdout.write(
      `  span ${preset.config.span}  length ${preset.config.length}  height ${preset.config.height}  bays ${preset.config.bays}  wind ${preset.config.windRegion}/${preset.config.terrainCategory}  ${preset.config.stateCode}\n`,
    );
    process.stdout.write(`  status            ${evaluation.status}\n`);
    process.stdout.write(`  building cost     ${money(evaluation.bom.buildingCost)}\n`);
    process.stdout.write(`  total BOM cost    ${money(evaluation.bom.totalCost)}\n`);
    process.stdout.write(`  kit               ${money(evaluation.price.kitCents)}\n`);
    process.stdout.write(`  contract (incl)   ${money(evaluation.price.contractCents)}\n`);
    process.stdout.write(`  total mass        ${evaluation.bom.totalMassKg.toFixed(1)} kg\n`);
    process.stdout.write(
      `  lines             ${lines.length} (mocked ${evaluation.bom.mockedLines}, assumed ${assumedCount})\n`,
    );

    if (evaluation.issues.length > 0) {
      process.stdout.write('  issues\n');
      for (const issue of evaluation.issues) {
        process.stdout.write(`    [${issue.severity}] ${issue.code}\n`);
      }
    } else {
      process.stdout.write('  issues            none\n');
    }
    process.stdout.write('\n');
  }

  // A real quote, when one is supplied. Printed for a human to compare, because the
  // engine's numbers are *expected* to differ from the old system's in the five
  // documented ways — an automatic equality assertion would fail on every quote and
  // teach nobody anything.
  if (sqdPath !== null) {
    const path = resolve(process.cwd(), sqdPath);
    process.stdout.write(`Legacy quote  ${path}\n`);
    const result = readQuoteFile(path);
    process.stdout.write(summariseQuoteFile(result));
  }
} finally {
  // The SQLite handle must be closed before the directory is removed. On Windows an open
  // handle makes `rmSync` fail with EPERM, which is a confusing way to learn that a
  // script leaked a file descriptor.
  closePublishedBook();
  rmSync(books, { recursive: true, force: true });
}
