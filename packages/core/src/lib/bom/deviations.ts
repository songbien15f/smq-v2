/**
 * Every place this build differs from the previous engine, and what the difference costs.
 *
 * The list exists for one reason: a number that differs from the old system has to be
 * explainable in a glance rather than argued about. Each entry states what the
 * previous engine does, what this does, why, and the direction of the price effect, so a
 * customer's question — "why is this quote dearer than the one your old system
 * gave me?" — has an answer that does not require reading code.
 *
 * `priceEffect` states a **direction**, not a number: a deviation that moves a
 * total by an amount depending on the building cannot honestly quote one figure
 * here.
 *
 * The plan named five. Execution against the real price book found the rest, and
 * an omissions-only list is worse than none: it implies the other numbers are
 * known to agree.
 */

export interface Deviation {
  id: number;
  /** The part of the quote the difference lands in. */
  area: string;
  /** What the previous engine does. */
  prior: string;
  /** What this build does instead. */
  here: string;
  /** Why this build chose differently. */
  why: string;
  /** Which way the total moves, and roughly how much. */
  priceEffect: string;
}

export const DEVIATIONS: Deviation[] = [
  {
    id: 1,
    area: 'Purlin and girt',
    prior:
      'Prices every girt from the purlin row, so a girt and a purlin always cost the same per metre, and the quote says nothing about it.',
    here:
      'Prices a girt from the girt material when the book has one. When it does not — which is the reference book, whose span table names no girt material — the line is priced from the purlin row and marked as an allowance, and the quote is reported as indicative.',
    why: 'A girt is not a purlin. They are different sections carrying different loads, and a book that lists them separately is saying so. When the book cannot tell them apart the amount is still an approximation, and presenting an approximation as a firm figure claims a precision that does not exist.',
    priceEffect:
      'Neutral when both materials are one, which is the reference book today. It moves either way as soon as a book prices girts apart — and that move is a correction, not a discrepancy.',
  },
  {
    id: 2,
    area: 'Sheeting',
    prior:
      'Casts the sheet cover to an integer before dividing, which turns a 762 mm cover into 0 mm and makes the sheet count undefined.',
    here: 'Uses the cover in millimetres, as the book states it.',
    why: 'The cast silently divided by a thousand. A cover of 0 cannot be divided by, so the count was never right for a real profile.',
    priceEffect: 'Material: the previous engine undercounts sheets, so this build quotes more.',
  },
  {
    id: 3,
    area: 'Gutter, flashing',
    prior:
      'Writes gutter and downpipe rows into the flashing section of the exported materials list, because two section arrays are index-swapped.',
    here: 'Each line carries its group from the moment it is created, so a gutter line can never appear under Flashing.',
    why: 'The totals were unaffected but the document was wrong, which is worse: a reader ordering from it buys the wrong items.',
    priceEffect: 'None on the total; the sections are now correct.',
  },
  {
    id: 4,
    area: 'Screws',
    prior:
      'Rounds a screw count three times: add 10%, round up to a multiple of ten, then round up to a pack.',
    here: 'Adds the allowance to the true count and rounds up to packs once.',
    why: 'Three roundings compound. A run needing 101 screws was billed as 110, then as three packs of 50 instead of three of the same.',
    priceEffect: 'Material: the previous engine overcounts packs, so this build quotes fewer.',
  },
  {
    id: 5,
    area: 'Delivery weight',
    prior:
      'Multiplies a fixing line\u2019s mass by its pack count, so a box of twenty bolts weighs twenty times one bolt.',
    here: 'Multiplies the per-piece mass by the true number of pieces the building uses.',
    why: 'A carton is not steel in the building. An overstated weight books the wrong truck and, on a long haul, changes the delivery price.',
    priceEffect: 'Material: the previous engine overstates total mass, so this build reports less.',
  },
  {
    id: 6,
    area: 'Sheeting',
    prior:
      'Multiplies a sheeting row\u2019s mass by the sheet count, treating the book\u2019s figure as kilograms per sheet.',
    here:
      'Reads the figure as kilograms per square metre \u2014 which is what it is: a 0.42 BMT row says 3.26, and 0.42 mm of steel is 3.30 kg/m\u00b2 \u2014 and multiplies by the sheet area.',
    why: 'Per sheet, the previous engine understates the delivery weight of the sheeting about 4.7 times on a 6 m roof sheet.',
    priceEffect: 'Material: this build reports a much higher total mass, so a delivery price based on weight is higher.',
  },
  {
    id: 7,
    area: 'Carport',
    prior:
      'A carport is a structure type like any other, and the wall groups run for it as they do for a shed.',
    here: 'A carport is a roof on columns: no wall sheeting, no end sheeting and no wall girts.',
    why: 'An open carport priced identically to an enclosed garage of the same footprint \u2014 a quote for a building the customer did not ask for.',
    priceEffect: 'Material: this build quotes a carport lower, by the whole wall package.',
  },
  {
    id: 8,
    area: 'Downpipe',
    prior:
      'Matches a downpipe on kind and size alone, and the book carries an adaptor, a pop, an elbow, a shoe and a trap under the same size.',
    here: 'Filters to the pipe run itself, and falls back to any pipe of that kind when the exact size is absent.',
    why: 'A four-downpipe shed was priced as four elbows: the dearest row of that size won the lookup.',
    priceEffect: 'Material: either way, but the line now matches what a plumber installs.',
  },
  {
    id: 9,
    area: 'Flashing and screws',
    prior:
      'Orders a flashing or screw lookup by price, so the dearest row of a profile or type wins.',
    here:
      'Matches the colour, because the book prices the same profile painted and galvanised; an unknown colour falls back to the painted price.',
    why: 'Ordering by price quoted galvanised flashing and screws on a Colorbond shed. An unpainted screw on a Colorbond roof is a callback.',
    priceEffect: 'Material: the previous engine quotes the dearer galvanised row, so this build is lower on a painted shed and exact on a galvanised one.',
  },
  {
    id: 10,
    area: 'Brackets',
    prior:
      'Builds a bracket\u2019s name by concatenating the prefix with the column\u2019s web depth, and gives up when the book has no exact match.',
    here:
      'Resolves a bracket in three steps: the exact name, then a row named for the purlin, then the smallest rung of a size ladder that will take the web.',
    why: 'The book\u2019s names are irregular \u2014 BP65A, ABP65, EPHB15-TH64 \u2014 so concatenation misses rows that exist, and a missing row is a missing line.',
    priceEffect: 'Material: the previous engine emits no line where this build prices one, so this build is higher.',
  },
  {
    id: 11,
    area: 'Flat fly',
    prior:
      'Sizes a flat fly from the frame section\u2019s web and emits nothing when the ladder has no matching rung.',
    here:
      'Uses the same three-step resolution as a bracket, and returns the largest rung when nothing fits.',
    why: 'This build\u2019s frame is a fixed 100 \u00d7 100 SHS and the book\u2019s flat-fly ladder stops at 40, so no rung fits. The line is priced at the largest standard fitting and marked for the operator to confirm.',
    priceEffect: 'Material: this build prices a line the previous engine omits.',
  },
  {
    id: 12,
    area: 'Wind bracing',
    prior:
      'Normalises a bracing line by dividing its length by the roll length, then by a further thousand.',
    here: 'Divides once: the quantity is the number of rolls the geometry needs.',
    why: 'The second division is a unit error that makes a bracing line nearly free. An earlier version of this build carried the same division and was fixed after a reference-building calculation showed a 30 m roll billed as 0.03 of one.',
    priceEffect: 'Material: this build prices bracing in whole rolls.',
  },
  {
    id: 13,
    area: 'Doors',
    prior: 'Defaults a personal-access door to 900 \u00d7 2100 mm.',
    here: 'Defaults to 820 \u00d7 2040 mm, the smallest size the price book carries.',
    why: 'The personal-access catalogue tops out at 2040 mm high, so a 2100 mm default finds no door at all and every default door came out unpriced.',
    priceEffect: 'Material: the previous engine found no price; this build prices a real catalogue door.',
  },
  {
    id: 14,
    area: 'Colours',
    prior: 'Stores colours as the book\u2019s names and matches on them.',
    here:
      'Stores colours as hex for the renderers and maps the hex back to the book\u2019s name at the price lookup.',
    why: 'The two vocabularies have to meet somewhere; doing it in the lookup keeps one source of truth for each.',
    priceEffect: 'None on its own; it is what makes the colour-matched lookups (deviation 9) possible.',
  },
  {
    id: 15,
    area: 'Mezzanine',
    prior:
      'Prices a mezzanine from a floor-load class (1.5, 3.0, 5.0 or 7.5 kPa) at 40, 45, 60 or 80 dollars a square metre, and applies a Queensland multiplier of 1.4.',
    here:
      'Uses the lightest class \u2014 the storage rate \u2014 and keeps the Queensland multiplier.',
    why: 'This build\u2019s mezzanine has no floor-load field. A storage platform is what a shed mezzanine almost always is; a customer wanting a 7.5 kPa floor needs the field and the heavier rate.',
    priceEffect: 'Material: this build quotes a lighter mezzanine than a heavy-duty one would cost.',
  },
  {
    id: 16,
    area: 'Materials list',
    prior: 'Merges two lines of the same product code into one, whatever their cut length.',
    here: 'Merges on product code, unit and description, so a cut length and a member\u2019s role stay separate.',
    why: 'A roof sheet cut to 6173 mm is not the same product as a wall sheet cut to 4235 mm, and a column is not a rafter. Merging on code alone ordered one length and billed it at the other\u2019s price.',
    priceEffect: 'None on the total; the lines now describe what is actually cut.',
  },
  {
    id: 17,
    area: 'Price chain',
    prior:
      'The spec text says the delivery and engineering charges are loaded with GST before they join the kit, and a reconstruction from that text gives a different total.',
    here:
      'Adds the charges as given, with no second GST loading. Checked against a real quote file: KitOnly 24.42 + delivery 275 + engineering 110 = TotalPrice 409.42 exactly.',
    why: 'The charges are already GST-inclusive as the previous engine stores them. Loading them again would overstate every quote by the tax on its delivery and engineering, and the quote file is stronger evidence than the prose.',
    priceEffect: 'Material: loading again would be higher by 10% of the charges.',
  },
  {
    id: 18,
    area: 'Miscellaneous',
    prior:
      'Carries a fixed "shed safe fee" as the only miscellaneous line, read from the misc-option table.',
    here: 'The ShedSafe fee is a priced line read from the book, and any other fee the operator wants is a charge line on the quote.',
    why: 'The fee is real and every shed quote in the market carries it, so omitting it does not save the customer anything \u2014 it hides the fee and recovers it out of the margin. A fee the operator invents is still a visible, editable charge.',
    priceEffect: 'Material: the book\u2019s fee, once, on the materials list where it can be read.',
  },
  {
    id: 19,
    area: 'Frame',
    prior:
      'Sizes each frame member from the structure type and span, and adds a footing allowance only to a column cast in the ground.',
    here:
      'Sizes each member from the book\u2019s own structure-to-section table, which names the section per member for this span, bay, height and wind code. The column depth below the floor comes from that design\u2019s embedment. A book without the table still prices from one fixed section, and says so.',
    why: 'The table is 2 752 rows of engineering: a 6 m portal is framed in C15019 at $12.18/m, a 15 m one in C35030 at $38.61/m. One fixed section overstates the narrow shed and understates the wide one by more than half.',
    priceEffect: 'Material: exact where the table has a row; a fixed section where it does not.',
  },
  {
    id: 20,
    area: 'Rafters',
    prior:
      'Adds the apex and haunch offsets to the slope run — 70 mm at a 10-degree pitch — and carries the knee brace as its own member.',
    here:
      'Adds the same offsets, after an earlier version added two 2.5 m knee braces to every rafter instead.',
    why: 'Folding the brace into the rafter made a 6.1 m slope order 11.1 m of steel, an 82% overcount on every portal frame. Recorded because the first version of this build shipped it.',
    priceEffect: 'Material: the earlier version overcounted rafters by more than half.',
  },
  {
    id: 21,
    area: 'Roof sheeting',
    prior:
      'Counts the roof once for the whole building, with the second-pass rule already covering both slopes.',
    here:
      'Counts the roof once, after an earlier version multiplied the count by the number of slopes a second time.',
    why: 'That doubled every roof order: 128 sheets for a shed that needs 64. Recorded because the first version of this build shipped it.',
    priceEffect: 'Material: the earlier version doubled the roof.',
  },
  {
    id: 22,
    area: 'Doors and windows',
    prior:
      'Brings each door with its own flashing, screws and brackets, priced per door type.',
    here:
      'Prices the door or window leaf and frame from the catalogue, and leaves the surrounding flashing to the door package.',
    why: 'The catalogue price for a door already includes its frame and hardware; pricing the flashing again charges twice for the same aluminium.',
    priceEffect: 'Material: this build quotes a door lower, by the flashing it does not double-count.',
  },
  {
    id: 23,
    area: 'Charges',
    prior: 'Carries installation, equipment and fee lines in its own addition layer above the BOM.',
    here:
      'Every charge on the Charges tab becomes a miscellaneous line inside the BOM, so `totalCost` carries it and the margin recovers it.',
    why: 'A charge that sits outside the BOM is a charge the margin does not cover.',
    priceEffect: 'Material: this build recovers the margin on a charge; the previous engine does not.',
  },
  {
    id: 24,
    area: 'Span table',
    prior:
      'Accepts every span-table row whose standard span is at least the bay size and lets the cost loop choose.',
    here:
      'Accepts every row at or above the bay size, after an earlier version required an exact match.',
    why: 'A 3.4 m bay matched no 3400 row and the whole frame fell back to the mocked minimum. Recorded because the first version of this build shipped it.',
    priceEffect: 'Material: the earlier version priced a mocked frame for any bay the table does not list exactly.',
  },
  {
    id: 25,
    area: 'Purlin spacing',
    prior:
      'Caps the purlin and girt spacing at what the sheeting above them can span, as well as what the span table allows.',
    here: 'Caps the spacing the same way, at what the sheet above it can span.',
    why: 'An earlier version used the span table alone, so a 1490 mm purlin spacing could sit under a sheet rated for 900 mm. Recorded because the first version of this build shipped it.',
    priceEffect: 'Material: the earlier version under-ordered purlins on every shed whose sheet span was the binding limit.',
  },
  {
    id: 26,
    area: 'Site conditions',
    prior: 'Keeps the wind region, terrain, shielding, importance, topography and state with the quote.',
    here:
      'Keeps all six with the quote, after an earlier version of the config schema silently dropped them on every edit.',
    why: 'The span table is indexed by the wind code, so a dropped terrain category re-prices the shed for a different site on the next keystroke. Recorded because the first version of this build shipped it.',
    priceEffect: 'Material: the earlier version re-priced the frame against region A on every edit.',
  },
];
