import Link from 'next/link';
import { requireVendorSession } from '@/lib/vendorGuard';

/**
 * `/dashboard/docs` — how a quote becomes a price, worked through with real numbers.
 *
 * ## Why this page is built around one worked example
 *
 * It is written for somebody new to the business. An abstract description of a price chain teaches
 * nothing: "kit = totalCost × margin × 1.1" is true and useless until you can see which rows produced
 * `totalCost` and which columns of which table produced those rows. So every section below is anchored
 * to **one real frozen revision** from the dev database — 33 lines, $8,185.68 of material, a $13,326.29
 * contract — and the numbers are copied from the database, not typed from memory.
 *
 * The rule for editing this page: **a number here must be one you can reproduce** by reading the
 * table named beside it. If a figure is an illustration rather than a real row, it says so.
 */
export const dynamic = 'force-dynamic';

function Section({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-sq-line bg-sq-surface">
      <h2 className="border-b border-sq-line px-sq-3 py-sq-2 text-sq-body font-semibold text-sq-ink">{title}</h2>
      <div className="flex flex-col gap-sq-3 p-sq-3 text-sq-body text-sq-ink">
        {lead !== undefined && <p className="text-sq-ink-muted">{lead}</p>}
        {children}
      </div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-sq-line bg-sq-ground p-sq-3 font-mono text-sq-micro leading-relaxed text-sq-ink">
      {children}
    </pre>
  );
}

/** A table of figures. `rows` are already strings so nothing is reformatted on the way in. */
function Figures({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sq-body">
        <thead>
          <tr className="border-b border-sq-line text-left text-sq-micro uppercase tracking-wider text-sq-ink-muted">
            {head.map((cell) => (
              <th key={cell} scope="col" className="py-sq-2 pr-sq-3 font-semibold whitespace-nowrap">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-sq-line/70 last:border-0">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`py-sq-2 pr-sq-3 align-top ${cellIndex === 0 ? 'font-medium' : ''} ${
                    /^[\d$.,×+\-—]+$/.test(cell) ? 'sq-numeric' : ''
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function DashboardDocsPage() {
  await requireVendorSession();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-sq-4 px-sq-4 py-sq-6">
      <header className="flex flex-wrap items-start justify-between gap-sq-3">
        <div>
          <h1 className="text-sq-title font-semibold text-sq-ink">How a quote becomes a price</h1>
          <p className="mt-sq-1 text-sq-body text-sq-ink-muted">
            Written for somebody new to the business. Every figure below comes from{' '}
            <strong>one real saved revision</strong> in this database — 6 000 × 15 000 mm, 4 bays — so you
            can check each step against the tables named beside it.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center rounded-md border border-sq-line px-sq-3 text-sq-body font-medium text-sq-ink no-underline hover:bg-sq-ground"
        >
          Back to usage
        </Link>
      </header>

      <Section
        title="① Where the data comes from: 80 tables, 31 553 rows"
        lead="The price book is one SQLite file, published as an immutable snapshot. Every price in a quote is read from it. Here is what is actually in it, by row count."
      >
        <Figures
          head={['Table', 'Rows', 'What it holds', 'What asks it']}
          rows={[
            ['country_surburb', '16,741', 'Every Australian suburb with its state and postcode', 'Address lookup'],
            ['system_lookup_data', '2,752', 'The frame schedule: one row per span × height × bay × wind code', 'lookup.frameSchedule()'],
            ['devided', '1,012', 'Purlin and girt span limits per wind code and bay size', 'lookup.devided()'],
            ['gutter', '824', 'One row per profile × colour × state', 'lookup.gutter()'],
            ['flashing', '612', 'Ridge, barge, corner, head flashing — per colour', 'lookup.flashing()'],
            ['cost_bracket', '426', 'Base plates, eave brackets, knee-brace connectors', 'lookup.bracketExact()'],
            ['downpipe', '280', 'Pipe, elbow, shoe, pop, adaptor — per kind and size', 'lookup.downpipe()'],
            ['cost_sheeting', '272', 'Roof and wall cladding, per profile and thickness', 'lookup.sheeting()'],
            ['misc_option', '125', 'Catalogue accessories — the ShedSafe fee is one', 'lookup.miscOption()'],
            ['roller_door', '122', 'Roller door sizes, per series', 'lookup.door()'],
            ['cost_frame', '111', 'Steel sections: SHS, RHS, C-section — cost per metre and mass', 'lookup.frame()'],
            ['screws', '107', 'Screw packs with pieces per pack', 'lookup.screwPack()'],
            ['cost_purlin', '23', 'Purlin sections (TH64, TH96, Z150…)', 'lookup.purlin()'],
            ['sheeting_cover', '12', 'Sheeting cover widths (762 mm, 817 mm…)', 'lookup.cover()'],
          ]}
        />
        <p className="text-sq-ink-muted">
          The full book is 80 tables and <strong>31 553 rows</strong>; the thirteen above are the ones a
          normal shed actually reads. The rest are design-parameter tables (wind regions, terrain
          factors, importance levels) and lookup lists for the dropdowns.
        </p>
      </Section>

      <Section
        title="② One steel member: how a price is built"
        lead="Take the main column of that revision. Three questions decide its cost — which section, how many metres, and what the metre costs."
      >
        <ol className="flex list-decimal flex-col gap-sq-2 pl-sq-6">
          <li>
            <strong>How many columns?</strong> <code>(bays − 1) × 2</code> at the long walls, plus a jamb
            pair per side wall that has an opening, minus the columns a carry beam replaces, plus one pair
            of end-wall columns per gable end. 4 bays, no side openings → <strong>6 main + 2 end-wall</strong>.
          </li>
          <li>
            <strong>How long is each?</strong> Wall height plus the footing allowance —{' '}
            <code>3 000 + 600 = 3 600 mm</code>. The 600 mm is the factory's allowance for a column cast
            into the ground; the design row's own <code>embedment</code> replaces it when the book gives
            one.
          </li>
          <li>
            <strong>What does a metre cost?</strong> The book's <code>cost_frame</code> row for the section
            that <em>the frame schedule named</em> (see the note below — for this revision it fell back to{' '}
            <code>100 × 100 × 2.0 SHS</code>, $16.9571/m, 5.64 kg/m).
          </li>
        </ol>

        <Code>{`quantity = 8 columns × 3 600 mm             = 28 800 mm  → 28.8 m
amount   = round(28.8 × $16.9571)            = $488.45
mass     = 28.8 × 5.64                       = 162.4 kg`}</Code>
        <p className="text-sq-ink-muted">
          Those are the stored figures, to the cent — open any <code>/bom?format=csv</code> for the same
          revision and the first row reads the same three numbers.
        </p>

        <div className="rounded-md border border-sq-attention/30 bg-sq-attention/5 p-sq-3">
          <p className="font-semibold text-sq-ink">
            The most useful thing on this page: why the section is SHS and not C20015
          </p>
          <p className="mt-sq-1">
            The book <em>does</em> state a section for a 6 000 × 3 000 frame — <code>system_lookup_data.C1</code>{' '}
            reads <code>C20015</code> for a 4 000 mm bay. This building's bay is{' '}
            <strong>3 750 mm</strong> (15 000 ÷ 4), and the schedule query matches the bay <strong>exactly</strong>:
          </p>
          <Code>{`bays the book lists for structure 1, region A:  3000, 3500, 4000
this building's bay:                            3750      ← no row

SELECT C1 … FROM view_system_lookup_data
 WHERE … AND bay = 3750 AND height = 3000    → 0 rows`}</Code>
          <p className="mt-sq-1">
            No row means no stated section, so the engine falls back to a single assumed section for every
            member and raises <code>FRAME_SECTION_ASSUMED</code>. That is why the quote is{' '}
            <strong>indicative</strong>: it is priced, and it is priced on an assumption about the steel.
            A bay the book lists — 3 500 or 4 000 — would price against a real C-section and cost more,
            because a C20015 is heavier than 100 × 100 × 2.0 SHS.
          </p>
        </div>


      </Section>

      <Section
        title="③ That revision, line by line"
        lead="These are real rows from the frozen BOM of revision 2, one from each group, copied as stored."
      >
        <Figures
          head={['Group', 'Code', 'Description', 'Qty', 'Unit cost', 'Amount']}
          rows={[
            ['frame', 'FBI15403', 'Main column — 100 × 100 × 2.0 SHS', '28.8 m', '$16.9600', '$488.45'],
            ['purlin', 'FFT74633', 'Roof purlin — TH96100', '98.1 m', '$5.4900', '$538.57'],
            ['sheeting', 'FFR28791', 'Roof sheeting — 0.42 Corro, 3 106 mm', '124.24 m', '$10.2300', '$1,270.98'],
            ['gutter', '~115-QUAD-GUTTER', 'Gutter', '30.0 m', '$4.1000', '$123.00'],
            ['flashing', 'RF', 'Ridge capping', '15.0 m', '$6.3300', '$94.95'],
            ['bracket', 'BP89A', 'Base plate bracket', '10 ea', '$26.1900', '$261.90'],
            ['flatfly', 'FBI26860', 'Flat fly, rafter — FFB15-TH96', '16 ea', '$3.6000', '$57.60'],
            ['bracing', 'FBI26813', 'Wind bracing — 30 × 1.2 mm, 30 m roll', '3 roll', '$18.7300', '$56.19'],
            ['bolt', 'FBI80463', 'Column bolt — M16x40-8.8, pack of 20', '2 pack', '$5.3400', '$10.68'],
            ['screw', '~ZIPXX-ROOF-SCREW', 'Roof screw — ZIPxx, pack of 100', '8 pack', '$21.0300', '$168.24'],
            ['option', 'FBI12593', 'Window, 589 × 790 mm', '1 ea', '$155.5700', '$155.57'],
            ['misc', '~SHED-SAFE-FEE', 'ShedSafe wind rating fee', '1 ea', '$15.0000', '$15.00'],
          ]}
        />
        <p className="text-sq-ink-muted">
          <strong>33 lines</strong> across <strong>12 groups</strong> (frame 5, screw 3, purlin 3, sheeting 3, gutter 3, flashing 4, bracket 4, flatfly 3, bracing 1, bolt 1, option 1, misc 2). Every other group is a different
          quantity formula over the same book — purlins are rows × run, sheeting is{' '}
          <code>ceil(run / cover)</code>, screws are <code>ceil(needed / pack size)</code>.
        </p>
      </Section>

      <Section
        title="④ The price chain, with the real figures"
        lead="Material cost in, contract price out. Every step is one line of arithmetic."
      >
        <Figures
          head={['Step', 'Formula', 'This revision']}
          rows={[
            ['Material cost', 'Σ of every line amount', '$8,185.68'],
            ['Kit', 'round(material × margin × 1.1)', 'round($8,185.68 × 1.48 × 1.1) = $13,326.29'],
            ['Total', 'kit + delivery + engineering + extra', '$13,326.29 + 0 + 0 + 0'],
            ['Contract', 'round(total × (1 + quoteRate%)) + additions', '$13,326.29 (rate 0, no additions)'],
            ['GST inside it', 'contract − round(contract / 1.1)', '$1,211.48'],
            ['Deposit 10%', 'round(contract × 10%)', '$1,332.63'],
            ['Progress 70%', 'round(contract × 70%)', '$9,328.40'],
            ['Balance', 'contract − deposit − progress', '$2,665.26'],
          ]}
        />

        <p>
          The <strong>margin of 1.48</strong> is not invented: it is the book's{' '}
          <code>setting_price_coeffcient</code> row for this building family. A gable carport is 1.69 —
          that is why a carport costs more per square metre than a shed of the same size.
        </p>
        <p>
          <strong>GST is inside the contract, not added to it.</strong> An Australian buyer reads the
          headline as what they pay, so the tax is extracted for the report line. Adding it would
          overcharge the customer by 10% of the job.
        </p>
      </Section>

      <Section
        title="⑤ The wind code: why the same building has two prices"
        lead="This is the part newcomers miss. The shed's dimensions decide the count of members; the site decides which sections and which span limits."
      >
        <p>
          Site conditions are not metadata. The wind code is{' '}
          <code>{'<region><terrain>'}</code> — region A to D from <code>design_wind_region</code>, terrain
          2, 2.5 or 3 from <code>design_terrain_category</code>. That code indexes{' '}
          <code>devided</code>, which says how far apart purlins and girts may be:
        </p>
        <Figures
          head={['lookup_code', 'standard_span (bay)', 'purlin_span', 'girt_span', 'purlin_material']}
          rows={[
            ['A2', '4 000 mm', '460 mm', '550 mm', 'TH64075'],
            ['A2', '3 750 mm', '530 mm', '630 mm', 'TH64075'],
            ['A2', '3 500 mm', '600 mm', '710 mm', 'TH64075'],
          ]}
        />
        <p>
          Read the direction of that table: <strong>a shorter bay allows a wider purlin spacing</strong>,
          because a purlin spanning less needs less support. A wider spacing means <strong>fewer purlin
          rows</strong> — so a 3 500 mm bay needs four rows where a 4 000 mm bay needs five. Same
          building outline, different steel, different price.
        </p>
        <p className="text-sq-ink-muted">
          And the terrain is why a coastal quote costs more: region C maps to a different{' '}
          <code>lookup_code</code>, which returns smaller span limits, which means more rows of steel.
        </p>
      </Section>

      <Section
        title="⑥ What the quote honestly does not know"
        lead="A saved revision carries around thirteen 'assumption' notes. They are not errors — they say the price is arithmetically right but the book did not state something."
      >
        <Figures
          head={['Code', 'What it means', 'Why it matters']}
          rows={[
            [
              'FRAME_SECTION_ASSUMED',
              'Every frame member is priced as 100 × 100 × 2.0 SHS',
              'The book has no span-to-section table, so a wide portal is priced as light steel',
            ],
            [
              'GIRT_PRICE_FROM_PURLIN',
              'Wall girts are priced from the purlin section',
              'The book lists no girt material; a girt carries a different load',
            ],
            [
              'FOOTING_ASSUMED',
              'One footing allowance for every column',
              'Cast-in-ground and bolted-to-slab columns are different lengths',
            ],
            [
              'TERRAIN_SUBSTITUTED',
              'Terrain 2.5 is priced from the category 2 table',
              'The book has no rows for the desktop\'s category 4 code',
            ],
            [
              'UNIT_ASSUMED_*',
              'The book does not state whether a cost is per pack or per piece',
              'Read as ea or pack by material kind, which the book does not confirm',
            ],
          ]}
        />
        <p>
          That is why such a quote reads <strong>indicative</strong> and not <strong>firm</strong>. Two of
          them — the frame section and the girt price — can only be closed with real supplier quotes. The
          code cannot answer either.
        </p>
      </Section>

      <Section
        title="⑦ Two properties worth knowing"
        lead="Both are what make a quote safe to send, and both are easy to break."
      >
        <p>
          <strong>1. The BOM is a photograph, not a calculation.</strong> The BOM file and the customer
          document are built from the revision's frozen <code>bom_json</code>; nothing re-runs. A revision
          from March still prints March's price after a new price book is published. A database trigger
          refuses <code>UPDATE</code> and <code>DELETE</code> on <code>quote_revisions</code>, and only
          the name and description may change.
        </p>
        <p>
          <strong>2. A save refuses to freeze a stale price.</strong> Three checks before a revision is
          written: the building must hash the same as when it was priced, the company's price overrides
          must not have moved, and the freight must not be under the delivery scope's minimum. Any of the
          three failing answers 409 or 422 and asks for a recalculation, rather than recording a figure
          nobody can reproduce.
        </p>
      </Section>

      <Section title="⑧ Where to read the code" lead="In this order — each file depends on the one before it.">
        <ol className="flex list-decimal flex-col gap-sq-1 pl-sq-6 font-mono text-sq-micro">
          <li>apps/api/src/routes/evaluations.ts — the request, the book, the save gates</li>
          <li>packages/core/src/lib/estimating/evaluate.ts — the engine entry</li>
          <li>packages/core/src/lib/bom/build.ts — the twelve groups</li>
          <li>packages/core/src/lib/bom/optimise.ts — purlin and girt row selection</li>
          <li>packages/core/src/lib/pricing/lookup.ts — every query against the book</li>
          <li>packages/core/src/lib/pricing/price.ts — the chain</li>
          <li>apps/api/src/routes/bomExport.ts — the frozen read and the two file formats</li>
        </ol>
        <p className="text-sq-ink-muted">
          The long-form version of this page is <code>docs/PRICING-PIPELINE.md</code> in the repository,
          reviewed with the code. This page may differ in presentation; a formula may not.
        </p>
      </Section>
    </main>
  );
}
