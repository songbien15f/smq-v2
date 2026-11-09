import Link from 'next/link';
import { requireVendorSession } from '@/lib/vendorGuard';

/**
 * `/dashboard/docs` — how a quote becomes a price, on one page.
 *
 * ## Why it is rendered here and not linked to the Markdown file
 *
 * The source of truth is `docs/PRICING-PIPELINE.md`, in the repository, where it is reviewed with the
 * code. This page is the same content in a shape a person can read in a browser without a checkout —
 * and the two are allowed to differ in *presentation*, never in a formula. Anything that disagrees is
 * a bug in this page.
 *
 * ## Why ASCII diagrams and not Mermaid
 *
 * The repository's Markdown uses Mermaid because GitHub renders it. This page is server-rendered
 * HTML: a Mermaid diagram would need a client bundle and a render step for a diagram that never
 * changes. A `<pre>` block costs nothing, works without JavaScript, and is selectable text.
 */
export const dynamic = 'force-dynamic';

/** A monospaced diagram. Horizontal scroll rather than wrapping: wrapped arrows stop reading as a flow. */
function Diagram({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-sq-line bg-sq-ground p-sq-3 text-sq-micro leading-relaxed text-sq-ink">
      {children}
    </pre>
  );
}

function Formula({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-sq-line bg-sq-surface p-sq-3 font-mono text-sq-body leading-relaxed text-sq-ink">
      {children}
    </pre>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-sq-line bg-sq-surface">
      <h2 className="border-b border-sq-line px-sq-3 py-sq-2 text-sq-body font-semibold text-sq-ink">{title}</h2>
      <div className="flex flex-col gap-sq-3 p-sq-3 text-sq-body text-sq-ink">{children}</div>
    </section>
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
            One save, from the first keystroke to the BOM file. The source of truth is{' '}
            <code>docs/PRICING-PIPELINE.md</code>; this page renders the same content.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center rounded-md border border-sq-line px-sq-3 text-sq-body font-medium text-sq-ink no-underline hover:bg-sq-ground"
        >
          Back to usage
        </Link>
      </header>

      <Section title="① The ten steps">
        <Diagram>{`① DRAFT — browser, nothing sent yet
   /quotes/new  →  applyConfig(building from the fragment)  →  two stores
                                                                  config   draft

② POST /evaluate            routes/evaluations.ts:240
   permission → book published? → openBook(hash) → company overrides
              → company settings (margin, factory method) → evaluateQuote()

③ ENGINE                   packages/core
   normaliseShedConfig  →  margin  →  buildBomWithEvidence()
        →  optimise()  →  lookup.devided(wind, bay)   ← purlin/girt rows
                       →  lookup.frameSchedule(...)   ← a section per member

④ ELEVEN GROUPS            one module each
   frame · purlin · sheeting · gutter · flashing · bracket · flatfly
   · bracing · bolt · screw · option

⑤ ADD UP                   bomLine()
   amount = round(quantity × unitCost)
   buildingCost = Σ amount        totalCost = buildingCost + miscCost

⑥ PRICE CHAIN              lib/pricing/price.ts
   kit → total → contract → gst → deposit / progress / balance

⑦ ANSWER + PREVIEW
   storeEvaluation() → evaluations table (hashes, book hash, override version)
                     → EvaluationView to the browser

⑧ SAVE                     POST /quotes
   idempotency → pricedInputsHash → overrideVersion → freight minimum
        → ONE TRANSACTION: customer · revision · quote header

⑨ FREEZE                   quote_revisions
   config · bom · price · customer · company · issues  — IMMUTABLE
   a trigger REFUSES update and delete (name/description excepted)

⑩ THE BOM FILE             GET /quotes/:id/revisions/:rev/bom
   cost:read → loadFrozenRevision() → reads the FROZEN bom_json
                                    → does NOT recompute
              ?format=csv  →  CSV    else  →  .xlsx`}</Diagram>
        <p className="text-sq-ink-muted">
          Step ⑩ is the one that matters most: the file is built from the frozen snapshot, not from a
          fresh calculation. A revision from March still prints March&rsquo;s price after a new price book
          is published.
        </p>
      </Section>

      <Section title="② The formulas">
        <p className="font-medium">One line of the bill of materials</p>
        <Formula>{`amount       = round(quantity × unitCost)
buildingCost = Σ amount            (every group except misc)
totalCost    = buildingCost + miscCost`}</Formula>

        <p className="font-medium">The price chain</p>
        <Formula>{`kit      = round(totalCost × margin × 1.1)
total    = kit + delivery + engineering + extra
contract = round(total × (1 + quoteRate%)) + additions
gst      = contract − round(contract / 1.1)     ← extracted, never added
deposit  = round(contract × depositPct%)
progress = round(contract × progressPct%)
balance  = contract − deposit − progress         ← always the remainder`}</Formula>
        <p>
          <strong>GST is inside the contract, not on top of it.</strong> An Australian buyer reads the
          headline as what they pay, so the tax is extracted. Delivery, engineering and extra charges are
          added as given — they are already GST-inclusive, which was proven from a real quote file
          (<code>24.42 + 275 + 110 = 409.42</code>).
        </p>
        <p>
          <strong>The balance is a remainder</strong>, never a fourth rounding, so the three payment
          stages add up to the contract to the cent.
        </p>

        <p className="font-medium">Quantities, three representative groups</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sq-body">
            <thead>
              <tr className="border-b border-sq-line text-left text-sq-micro uppercase tracking-wider text-sq-ink-muted">
                <th scope="col" className="py-sq-2 pr-sq-3 font-semibold">Group</th>
                <th scope="col" className="py-sq-2 font-semibold">Formula</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-sq-line/70">
                <td className="py-sq-2 pr-sq-3 align-top">frame</td>
                <td className="py-sq-2">
                  <code>(bays − 1) × 2</code> columns; a jamb column at each side of an opening; a carry
                  beam replaces the wall it spans; one column pair per gable end. Rafters follow the
                  columns, because a portal frame is one pair.
                </td>
              </tr>
              <tr className="border-b border-sq-line/70">
                <td className="py-sq-2 pr-sq-3 align-top">sheeting</td>
                <td className="py-sq-2">
                  <code>ceil(runMm / coverMm)</code> — the cover is <strong>millimetres</strong> (762), not
                  metres.
                </td>
              </tr>
              <tr>
                <td className="py-sq-2 pr-sq-3 align-top">bolt / screw</td>
                <td className="py-sq-2">
                  <code>ceil(needed / packSize)</code> — one rounding, not three.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="③ Where the data comes from">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sq-body">
            <thead>
              <tr className="border-b border-sq-line text-left text-sq-micro uppercase tracking-wider text-sq-ink-muted">
                <th scope="col" className="py-sq-2 pr-sq-3 font-semibold">Source</th>
                <th scope="col" className="py-sq-2 font-semibold">Holds</th>
              </tr>
            </thead>
            <tbody>
              {[
                [
                  'The price book (SQLite, content-addressed by hash)',
                  '~80 tables: cost_frame, cost_purlin, material_sheeting, structure_type, setting_price_coeffcient, delivery_data, misc_option, and the view_* tables',
                ],
                [
                  'price_row_overrides · company_catalogue_rows',
                  "This company's own prices, laid over the book",
                ],
                [
                  'company_settings (versioned JSON)',
                  'margin · bomProfileId · labour rates · freight minimums · deposit percentage',
                ],
                [
                  'config — from the browser',
                  'The building (span, length, height, pitch, bays, openings, options, colours) and the SITE CONDITIONS (wind region, terrain, importance, shielding)',
                ],
                ['pricing — from the browser', 'delivery, engineering, extra, quote rate, deposit and progress %, additions'],
              ].map(([source, holds]) => (
                <tr key={source} className="border-b border-sq-line/70 last:border-0">
                  <td className="py-sq-2 pr-sq-3 align-top font-medium">{source}</td>
                  <td className="py-sq-2">{holds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="font-medium">The book is reached only through these functions</p>
        <Formula>{`frame(size) · purlin(code) · sheeting(profile, bmt) · door(...) · window(w, h)
colour(name) · gutter(size, colour?) · gutterBracket(size) · downpipe(kind, size)
miscOption(name) · flashing(type, colour?) · purlinDepth(code) · bracketExact(name)
margin(structureId, state) · structureId(subCode) · frameSchedule(query)
devided(code, standardSpan, openDesign?) · windSpeed(region) · delivery(state, band)`}</Formula>
        <p>
          <strong>The site conditions are inputs to the price, not decoration.</strong>{' '}
          <code>devided(windCode, …)</code> chooses the purlin and girt rows, and{' '}
          <code>margin(structureId, state)</code> chooses the multiplier. Change the wind region or the
          state and both the steel and the margin change.
        </p>
      </Section>

      <Section title="④ An assumption is not an error">
        <p>
          A real quote carries around thirteen <code>assumption</code> issues. They say the price is
          correct but the price book did not state something. The two heaviest:
        </p>
        <ul className="flex list-disc flex-col gap-sq-2 pl-sq-6">
          <li>
            <code>FRAME_SECTION_ASSUMED</code> — the book has no span-to-section table, so{' '}
            <strong>every frame member is priced as 100 × 100 × 2.0 SHS</strong>.
          </li>
          <li>
            <code>GIRT_PRICE_FROM_PURLIN</code> — the book lists no girt material, so{' '}
            <strong>wall girts are priced from the purlin section</strong>.
          </li>
        </ul>
        <p>
          That is why such a quote reads <em>indicative</em> and not <em>firm</em>. Confirming those two
          against real supplier quotes is the only thing that can close them; the code cannot answer it.
        </p>
      </Section>
    </main>
  );
}
