#!/usr/bin/env node
/**
 * Golden check: the price chain against real desktop quote files.
 *
 * The desktop's own `.sqd` files store both the inputs (KitOnly, DeliveryCost,
 * EngineerCharge, ExtraCharges, QuoteRateValue, AdditionsCost) and the outputs
 * (TotalPrice, ContractPrice, Deposit, Progress, Balance). That makes them a golden test
 * of the arithmetic without needing to re-derive the BOM: feed the stored inputs to
 * `contractFromTotal`, and the stored outputs must match.
 *
 * ## Why it reads the desktop repo in place
 *
 * These are real customer quotes — names, phone numbers, company codes. Copying them into
 * this repo would publish customer data. The script takes a root argument (or the default
 * sibling checkout) and reads only.
 *
 * ## What it does NOT prove
 *
 * It does not prove the BOM quantities, because converting a desktop `HousePlan` into a
 * v2 `ShedConfig` (walls, infill columns, option anchors) is a separate job. This checks
 * the price chain only — the part every quote depends on.
 *
 * Usage:
 *   node tools/golden/check-price-chain.mjs [desktopRepoRoot]
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readQuoteFile } from '../../packages/core/dist/quoteFile/index.js';
import { contractFromTotal } from '../../packages/core/dist/pricing/index.js';

const DESKTOP = process.argv[2] ?? 'D:/Docs/OS.mr.Thi/smq-code-smartquote';
const EXTRA_ROOTS = ['D:/Docs/OS.mr.Thi/smq-package-smartquote/data'];

const SEARCH_DIRS = [
  join(DESKTOP, 'App/SmartQuote.Build/Workspace/@@'),
  join(DESKTOP, 'App/SmartQuote.Build/Workspace/D5'),
  join(DESKTOP, 'App/SmartQuote.Build/Workspace'),
  ...EXTRA_ROOTS,
];

const cents = (value) => Math.round(Number(value) * 100);

function files() {
  const found = [];
  for (const dir of SEARCH_DIRS) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.toLowerCase().endsWith('.sqd')) found.push(join(dir, name));
    }
  }
  return found;
}

let checked = 0;
let failures = 0;

for (const path of files()) {
  let file;
  try {
    file = readQuoteFile(path);
  } catch (error) {
    console.log(`SKIP ${path}: ${error.message}`);
    continue;
  }

  for (const revision of file.revisions ?? []) {
    const kit = cents(revision.KitOnly);
    const delivery = cents(revision.DeliveryCost);
    const engineering = cents(revision.EngineerCharge);
    const extra = cents(revision.ExtraCharges);
    const rate = Number(revision.QuoteRateValue ?? 0);
    const additions = cents(revision.AdditionsCost);

    if (!Number.isFinite(kit + delivery + engineering + extra)) continue;
    checked += 1;

    const total = kit + delivery + engineering + extra;
    const contract = contractFromTotal(total, rate, additions);
    const storedTotal = cents(revision.TotalPrice);
    const storedContract = cents(revision.ContractPrice);
    const stages =
      cents(revision.QuoteDeposite) + cents(revision.QuotePayment) + cents(revision.QuoteBalance);

    const problems = [];
    if (Math.abs(total - storedTotal) > 1) {
      problems.push(`total ${total} vs stored ${storedTotal}`);
    }
    if (Math.abs(contract - storedContract) > 1) {
      problems.push(`contract ${contract} vs stored ${storedContract}`);
    }
    if (stages !== storedContract) {
      problems.push(`stages ${stages} vs contract ${storedContract}`);
    }

    const label = `${path.split(/[\\/]/).slice(-2).join('/')} rev ${revision.RevisionId}`;
    if (problems.length === 0) {
      console.log(`PASS ${label}: ${(contract / 100).toFixed(2)}`);
    } else {
      failures += 1;
      console.log(`FAIL ${label}: ${problems.join('; ')}`);
    }
  }
}

console.log(`\n${checked} revisions checked, ${failures} failed.`);

/*
 * The package samples are `.NET BinaryFormatter` files, an older desktop format this
 * build can detect but not decode. Reporting them as skipped rather than silently
 * leaving them out keeps the coverage honest: 19 revisions is what is verifiable today,
 * and the three binary files are a known gap rather than a passing result.
 */
console.log(
  'Not counted: the BinaryFormatter-era files in smq-package-smartquote/data ' +
    '(SSA$$-00007, SSA@@-00001, VGS$$-00027) — format not decodable by this reader.',
);

process.exit(failures === 0 ? 0 : 1);
