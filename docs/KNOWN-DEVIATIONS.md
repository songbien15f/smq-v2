# KNOWN DEVIATIONS — deliberate differences from the desktop app

The desktop is a **reference, not a spec**. It is itself incomplete, so "matches the
desktop" is not a correctness claim. Every place this build deliberately computes a
different number is listed here, with the effect on price, so a quotation can always
be explained.

Decisions that are *not yet made* live in `DECISIONS.md` §B. Rows marked **OPEN**
change a number and need the operator's signature before a customer sees a quote.

| # | Desktop behaviour | This build | Why | Price effect |
|---|---|---|---|---|
| 1 | **Girt is priced from the purlin table.** The girt optimisation loop reads `dlookup.PurlinMaterial.Price` and assigns `girtMaterial = dlookup.PurlinMaterial`, so a wall girt costs whatever the roof purlin costs, and the quote says nothing about it. | **Fixed** — a girt is priced from its own material when the book sells one. When the book does not — which is the reference book, whose span table names no girt material — the line is priced from the purlin row and **marked as an allowance**, and the quote reports `GIRT_PRICE_FROM_PURLIN` and reads as *indicative* rather than firm. | A girt is a wall member and a purlin is a roof member: different sections, different loads. When the book cannot tell them apart the amount is still an approximation, and presenting an approximation as a firm figure claims a precision that does not exist. A line marked *mocked* means no price was found and blocks a send; *assumed* means a real price for a different member and does not — so the two are deliberately different flags. | **Neutral on the reference book**, because both materials are one. Moves as soon as a book prices girts apart, and that move is a correction rather than a discrepancy. |
| 2 | **Wall sheeting count is missing a ×1000.** `(int)(WallSheeting.SheetCover)` truncates the metre-based cover to 0 before use, so wall sheet counts come out wrong. | **Fixed** — cover is converted to millimetres before the count | A truncated cover divides by zero or by one; either way the wall is wrong. Highest-risk item in the original list. | Wall cladding cost **rises** to the correct quantity. |
| 3 | **Screws are rounded three times**: +10 % allowance → round up to a multiple of 10 → ceil to a pack. | **Fixed** — allowance applied once, then one ceil to a pack | Three roundings compound; the last one is correct on its own. | Small reduction in screw cost. |
| 4 | **Bolt and screw mass is computed per pack**, so `TotalMass` is inflated by the pack size. | **Fixed** — mass is `massPerPiece × needed` | Mass is a shipping figure; per-pack mass answers a question nobody asked. | `TotalMass` falls. Does not move price. |
| 5 | **Gutter bracket count uses integer division** (`num3/1000 + 1`), which can be one bracket short. | **Fixed** — `ceil(metres × 1000 / spacing)` | Rounding a bracket count down leaves a gutter unsupported. | Negligible increase. |
| 6 | **Carry-beam surcharge is a fixed bracket set**, not the 10 % a reader might expect. | **Carried as-is** | It is a real catalogue item, not a formula. | None. |
| 7 | **Mezzanine matches exactly four load levels** (1.5 / 3.0 / 5.0 / 7.5 kPa); any other load returns **price 0**. | **Fixed** — the nearest defined level is used and an assumption issue is raised | A silent zero is the worst possible answer for a priced option. | Mezzanine never free. |
| 8 | **Two BOM sections are labelled the wrong way round** (gutter items in `FlashingItems` and vice versa). Totals are right, labels are not. | **Fixed** — sections labelled correctly | Affects the workshop sheet's headings. | None — totals unchanged. |
| 9 | **Main-house option material is disabled** (`computeTotalOptionMaterial` commented out at `ExportUtil.cs:783`), so option material may be empty in the desktop's BOM. | **Included** | Doors and windows are material; pricing them as labour-only understates the kit. | Option lines appear where the desktop shows none. |
| 10 | **The desktop embeds the logo image in every saved quote file**, so a quote always carries its own mark whatever the installation is showing. | **The revision records the logo's sha256 instead**, and the renderer uses the image only when the platform's current file matches that hash. A revision whose logo file is gone prints the company's text logo (`logoText`) rather than a newer image. | Copying ~100 KB of base64 into every row of an append-only table is a cost paid on every revision for a file that rarely changes. The hash keeps the property that matters — *a quote shows what it was sent with* — and degrades to text, which is honest, rather than to a different mark, which is not. | None. Visual only, and only for a quote older than the logo change. |

| 11 | **A skillion's principal rafter is cut over the full width divided by `cos(pitch)`** (`SkillionBuildingQuote.cs:242`), while every gable family cuts half the width. | **Fixed** — `rafterLength` asks `fallsToBothSides(structureType)` instead of halving everything | This was **our** defect, not the desktop's: the formula halved the span for every structure, so a skillion rafter was about half its required length and could not span the building. `zed_shed` is `GB_Z150` = *Crossover Gable*, so it stays on half the width — treating it as a skillion would have doubled an 11 m rafter into 22 m. | Skillion rafters **roughly double** in metres of steel. Gables and everything else unchanged. `ENGINE_VERSION` `1` → `2`. |

| 12 | **The punching sheet is printed even when a connector is unknown.** `PunchingDetailForm` reads one `haunch` from `InternalColumn` and one `apex` per rafter, and if a local table has no row, `BOMQuoteUtil` constructs an all-zero spec and prints the sheet anyway — holes at 0 mm, or a group silently missing. | **Fixed** — `buildPunchingPages` returns **no sheet** unless the knee edge, every apex and every haunch row is present | A sheet showing the knee hole and omitting the haunch is one a workshop reads as complete, and the members come back undrilled at the connection carrying the most load. Refusing to print sends somebody to the price book, which is where the missing row belongs. | None — a sheet either prints whole or not at all. |

| 13 | **The BOM prices no infill columns at all.** The desktop stands extra columns in a wide gable to carry the wall sheeting (`no_M/EW`, `M1`), and this build priced only `End wall column` from `endMemberCount()`. | **Fixed** — `buildingInfillColumns()` reads the count and section from the structure row, and both the frame lines and the cut list use it | A 12 m gable with two infill columns per end was quoted **four columns short** and ~21.7 m of steel light, and the gable sheeting the quote charges for had nothing to hang on. This is the largest single omission found in the conversion. | Frame cost **rises** on every gable wide enough for infill. Quotations issued before this change understated it. |

| 14 | **A roller door over an infill column is refused on a wide gable and re-spaced around on a narrow one** (`AddingRuleDoor.AllowOverrideInfill` / `computeInfillPosition`). | **Both ported** — `infillOverrideRefusal` (blocker above 4 000 mm) and `respaceAroundDoors` (move/split/remove at or below it) | They are mutually exclusive answers for one door. Doing both, which a first version did, reports a blocker *and* an assumption for the same wall — the operator cannot tell whether to move the door or accept a moved column. | None directly; a wide gable with a door over a column is now **blocked** where it previously priced silently. |

**Operational consequence of row 10:** changing the platform logo means adding a **new file** and
pointing `LOGO_FILE` at it, not overwriting the old one. Overwriting does not corrupt anything — the
revisions that referenced the old bytes simply print the text logo from then on. See
`docs/TEST-ACCESS.md`.

## How to add a row

1. Reproduce both numbers. "It looks wrong" is not a row; `1,148 vs 1,152 wall sheets, +34 AUD` is.
2. State whether it is **fixed** or **carried**. Carrying a bug deliberately is a legitimate
   answer when the fix needs data nobody has.
3. Record the price direction, not just the fact.
4. If it changes a stored number, bump `ENGINE_VERSION`. A saved revision carries the engine
   that priced it, so "this quote was priced by engine 2" stays a fact.
