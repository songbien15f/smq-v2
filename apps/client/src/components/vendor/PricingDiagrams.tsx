/**
 * The diagrams on the pricing page.
 *
 * ## Why hand-written SVG and not Mermaid
 *
 * The page is a server component and must render without JavaScript. Mermaid needs a client bundle
 * plus a layout pass, and a diagram that never changes does not earn either. SVG here is inline
 * markup: it prints, it scales with the page, and it can be read on a phone by pinch-zoom.
 *
 * ## Why the coordinates are literals
 *
 * Every box is placed by hand so the flow reads left-to-right at a fixed size. A graph layout
 * algorithm would re-flow on every edit, and a diagram whose shape moves is a diagram nobody
 * re-reads. The trade is that a new box needs its neighbours nudged — which is honest work, done
 * once.
 *
 * ## What is drawn from measurement, not memory
 *
 * Which module reads which table was taken from the source: `grep -oE 'lookup\.[a-zA-Z]+'` over
 * `lib/bom/**`. The counts (80 tables, 31 553 rows) and the worked figures come from the book file
 * and a real revision. Anything that changes must change here deliberately.
 */

const INK = '#0f172a';
const MUTED = '#475569';
const LINE = '#cbd5e1';
const BRAND = '#071832';
const GOLD = '#8a6a1f';
const GROUND = '#f6f7f9';
const SURFACE = '#ffffff';

/** A rounded box with a title line and an optional detail line. */
function Box({
  x,
  y,
  w = 190,
  h = 54,
  title,
  detail,
  fill = SURFACE,
  stroke = LINE,
  titleColor = INK,
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  title: string;
  detail?: string;
  fill?: string;
  stroke?: string;
  titleColor?: string;
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill={fill} stroke={stroke} strokeWidth={1} />
      <text x={x + 10} y={y + (detail === undefined ? h / 2 + 4 : 21)} fontSize={11} fontWeight={600} fill={titleColor}>
        {title}
      </text>
      {detail !== undefined && (
        <text x={x + 10} y={y + 37} fontSize={9.5} fill={MUTED}>
          {detail}
        </text>
      )}
    </g>
  );
}

/** A left-to-right arrow with an optional label above it. */
function Arrow({ from, to, y, label }: { from: number; to: number; y: number; label?: string }) {
  const mid = (from + to) / 2;
  return (
    <g>
      <line x1={from} y1={y} x2={to - 6} y2={y} stroke={LINE} strokeWidth={1.2} />
      <path d={`M${to - 6} ${y - 4} L${to} ${y} L${to - 6} ${y + 4} Z`} fill={MUTED} />
      {label !== undefined && (
        <text x={mid} y={y - 5} fontSize={8.5} fill={MUTED} textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  );
}

/** A vertical connector with an arrowhead pointing down. */
function Down({ x, from, to, label }: { x: number; from: number; to: number; label?: string }) {
  return (
    <g>
      <line x1={x} y1={from} x2={x} y2={to - 6} stroke={LINE} strokeWidth={1.2} />
      <path d={`M${x - 4} ${to - 6} L${x} ${to} L${x + 4} ${to - 6} Z`} fill={MUTED} />
      {label !== undefined && (
        <text x={x + 6} y={(from + to) / 2 + 3} fontSize={8.5} fill={MUTED}>
          {label}
        </text>
      )}
    </g>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sq-micro text-sq-ink-muted" style={{ marginTop: 6 }}>
      {children}
    </p>
  );
}

function Frame({ width, height, label, children }: { width: number; height: number; label: string; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-sq-line bg-sq-ground p-sq-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={label}
        style={{ minWidth: Math.min(width, 720), display: 'block' }}
      >
        {children}
      </svg>
    </div>
  );
}

/**
 * Diagram 1 — the whole pipeline, five stages left to right.
 *
 * The shape is the answer to "what happens to my keystrokes": the building and the money go in at the
 * left, the book is consulted in the middle, and a frozen revision with a price comes out at the
 * right. Everything the rest of the page explains is one box in this picture.
 */
export function PipelineDiagram() {
  const y = 60;
  return (
    <>
      {/*
        Geometry, written down because it is what broke first: every box in the top row ends at
        `y + 136 = 196`, so the banner underneath must start at 208 or the two overlap. The first
        version put it at 188 and the freeze box sat on top of it for 8 px — invisible in a screenshot,
        obvious once measured.
      */}
      <Frame
        width={1000}
        height={268}
        label="Five stages: the browser sends the building and the money, the engine counts materials from the price book, prices them, and freezes a revision"
      >
        {/* stage 1 */}
        <text x={0} y={16} fontSize={9} fontWeight={700} fill={GOLD} letterSpacing={0.6}>
          1 · INPUT
        </text>
        <Box x={0} y={y} w={180} h={62} title="The building" detail="span · bays · pitch · doors" fill={SURFACE} />
        <Box x={0} y={y + 74} w={180} h={62} title="The money" detail="delivery · rate · deposit %" fill={SURFACE} />

        {/* stage 2 */}
        <text x={230} y={16} fontSize={9} fontWeight={700} fill={GOLD} letterSpacing={0.6}>
          2 · LOOK UP
        </text>
        <Box x={230} y={y - 10} w={200} h={86} title="The price book" detail="80 tables · 31 553 rows" fill="#eef2f7" stroke="#94a3b8" />
        <Box x={230} y={y + 88} w={200} h={48} title="Company overrides" detail="this company's own prices" />
        <Arrow from={180} to={230} y={y + 31} label="config" />
        <Arrow from={180} to={230} y={y + 105} label="pricing" />

        {/* stage 3 */}
        <text x={470} y={16} fontSize={9} fontWeight={700} fill={GOLD} letterSpacing={0.6}>
          3 · COUNT MATERIALS
        </text>
        <Box x={470} y={y - 10} w={200} h={86} title="Twelve BOM groups" detail="frame · purlin · sheeting · …" fill="#eef2f7" stroke="#94a3b8" />
        <Box x={470} y={y + 88} w={200} h={48} title="Cut list + punchings" detail="same members, different view" />
        <Arrow from={430} to={470} y={y + 33} label="unit cost" />

        {/* stage 4 and 5, stacked: price, then the frozen revision it becomes */}
        <text x={710} y={16} fontSize={9} fontWeight={700} fill={GOLD} letterSpacing={0.6}>
          4 · PRICE
        </text>
        <Box x={710} y={y - 10} w={180} h={86} title="The price chain" detail="kit → total → contract" fill="#eef2f7" stroke="#94a3b8" />
        <Arrow from={670} to={710} y={y + 33} label="material cost" />

        <text x={710} y={y + 100} fontSize={9} fontWeight={700} fill={GOLD} letterSpacing={0.6}>
          5 · FREEZE
        </text>
        <Box x={710} y={y + 108} w={180} h={40} title="A frozen revision" detail="immutable" fill="#fdf6e7" stroke={GOLD} />
        <Down x={800} from={y + 76} to={y + 108} />

        {/* the outputs, below everything */}
        <Box
          x={0}
          y={218}
          w={890}
          h={38}
          title="BOM file · customer document · share link — all read the frozen snapshot, never re-run the engine"
          fill={GROUND}
          stroke={LINE}
          titleColor={MUTED}
        />
        <Arrow from={800} to={890} y={237} />
      </Frame>
      <Caption>
        The one arrow worth following twice: <strong>nothing on the right re-calculates</strong>. The BOM
        file and the document are built from the frozen snapshot, which is why a March quote still prints
        March&apos;s price after a new book is published.
      </Caption>
    </>
  );
}

/**
 * Diagram 2 — which module reads which table.
 *
 * Taken from the source by grepping `lookup.*` calls in `lib/bom/**`, so it can be regenerated rather
 * than remembered. Two crossings matter: `devided` decides the purlin row count (a site input), and
 * `frameSchedule` decides every steel section (or falls back to one assumed section).
 */
export function DataMapDiagram() {
  return (
    <>
      <Frame width={980} height={330} label="Which BOM group reads which price book table">
        {/* left: the building */}
        <text x={0} y={14} fontSize={9} fontWeight={700} fill={GOLD} letterSpacing={0.6}>THE BUILDING</text>
        <Box x={0} y={24} w={170} h={48} title="span · bays · height" detail="how many members" />
        <Box x={0} y={84} w={170} h={48} title="wind region · terrain" detail="the wind code, e.g. A2" />
        <Box x={0} y={144} w={170} h={48} title="openings · options" detail="doors, windows, awning" />

        {/* middle: the engine's decision points */}
        <text x={250} y={14} fontSize={9} fontWeight={700} fill={GOLD} letterSpacing={0.6}>THE ENGINE DECIDES</text>
        <Box x={250} y={24} w={190} h={48} title="structureId()" detail="which family → margin row" fill="#eef2f7" stroke="#94a3b8" />
        <Box x={250} y={84} w={190} h={48} title="devided()" detail="purlin / girt span limits" fill="#eef2f7" stroke="#94a3b8" />
        <Box x={250} y={144} w={190} h={48} title="frameSchedule()" detail="a section per member" fill="#eef2f7" stroke="#94a3b8" />

        {/* right: the tables */}
        <text x={520} y={14} fontSize={9} fontWeight={700} fill={GOLD} letterSpacing={0.6}>THE BOOK</text>
        <Box x={520} y={24} w={200} h={40} title="structure_type" detail="13 families · margin 1.48" />
        <Box x={520} y={72} w={200} h={40} title="devided" detail="1 012 rows" />
        <Box x={520} y={120} w={200} h={40} title="view_system_lookup_data" detail="2 752 rows: C1, R1, M1, DM, DH" />
        <Box x={520} y={168} w={200} h={40} title="cost_frame · cost_purlin" detail="111 / 23 sections, $ per metre" />
        <Box x={520} y={216} w={200} h={40} title="gutter · flashing · downpipe" detail="824 / 612 / 280 rows" />
        <Box x={520} y={264} w={200} h={40} title="screws · cost_bolt · cost_bracket" detail="107 / 42 / 426 rows" />

        {/* the BOM groups on the far right */}
        <text x={780} y={14} fontSize={9} fontWeight={700} fill={GOLD} letterSpacing={0.6}>BOM GROUP</text>
        {['frame (5 lines)', 'purlin (3)', 'sheeting (3)', 'gutter (3)', 'flashing (4)', 'fixings (4)'].map((label, index) => (
          <Box key={label} x={780} y={24 + index * 48} w={180} h={38} title={label} fill={GROUND} stroke={LINE} titleColor={MUTED} />
        ))}

        {/* connections */}
        <Arrow from={170} to={250} y={48} />
        <Arrow from={170} to={250} y={108} label="wind code" />
        <Arrow from={440} to={520} y={48} />
        <Arrow from={440} to={520} y={108} />
        <Arrow from={440} to={520} y={168} label="a section" />
        <Arrow from={720} to={780} y={48} />
        <Arrow from={720} to={780} y={92} />
        <Arrow from={720} to={780} y={140} />
        <Arrow from={720} to={780} y={188} label="$ per m" />
        <Arrow from={720} to={780} y={236} />
        <Arrow from={720} to={780} y={284} />
      </Frame>
      <Caption>
        Read the two long arrows: <strong>wind region + terrain → wind code → purlin spacing → how many
        purlin rows</strong>. The same building outline with a different site is a different quantity of
        steel, which is why site conditions are part of the price and not a note on the drawing.
      </Caption>
    </>
  );
}

/**
 * Diagram 3 — the price chain, as a waterfall.
 *
 * A waterfall because the question a newcomer asks is "where did the extra money come from": each step
 * adds to the previous one, and the bars show that the margin and the GST step are both multipliers,
 * while delivery and engineering are flat additions.
 */
export function PriceChainDiagram() {
  const base = 195;
  const steps = [
    { label: 'Material cost', value: 8185.68, top: 195 - 8185.68 / 90, h: 8185.68 / 90, fill: '#94a3b8', note: 'Σ of 33 lines' },
    { label: '+ 48% margin', value: 3929.13, top: 195 - 12114.81 / 90, h: 3929.13 / 90, fill: '#7c9ab8', note: 'book row 1.48' },
    { label: '+ 10% GST', value: 1211.48, top: 195 - 13326.29 / 90, h: 1211.48 / 90, fill: GOLD, note: 'inside the contract' },
  ];
  return (
    <>
      <Frame width={880} height={260} label="Waterfall: material 8185.68, plus a 48 percent margin, plus 10 percent GST, equals the 13326.29 contract">
        <line x1={0} y1={base} x2={860} y2={base} stroke={LINE} strokeWidth={1} />
        {steps.map((step, index) => {
          const x = 40 + index * 210;
          return (
            <g key={step.label}>
              <rect x={x} y={step.top} width={120} height={Math.max(step.h, 2)} fill={step.fill} opacity={0.85} rx={2} />
              <text x={x + 60} y={step.top - 6} fontSize={10} fontWeight={700} fill={INK} textAnchor="middle">
                ${step.value.toLocaleString('en-AU', { minimumFractionDigits: 2 })}
              </text>
              <text x={x + 60} y={base + 14} fontSize={9.5} fill={MUTED} textAnchor="middle">
                {step.label}
              </text>
              <text x={x + 60} y={base + 26} fontSize={8.5} fill={MUTED} textAnchor="middle">
                {step.note}
              </text>
            </g>
          );
        })}
        {/* the delivered result */}
        <Box x={690} y={base - 40} w={170} h={40} title="Contract $13,326.29" detail="what the customer pays" fill="#fdf6e7" stroke={GOLD} />
        <Arrow from={660} to={690} y={base - 20} />
      </Frame>
      <Caption>
        Two multipliers and no additions, in this revision: <code>round(8 185.68 × 1.48 × 1.1) = 13 326.29</code>.
        Delivery, engineering and extra charges are <strong>flat</strong> additions and they sit between
        the margin and the GST — which is why a $500 freight figure moves the contract by $500, not by $550.
      </Caption>
    </>
  );
}

/**
 * Diagram 4 — the three gates before a revision is written.
 *
 * Drawn as gates rather than steps because each one can **refuse** the save, and a newcomer needs to
 * know that a refusal is the system working: it stops a figure being frozen that the database could
 * never reproduce.
 */
export function SaveGateDiagram() {
  return (
    <>
      <Frame width={900} height={190} label="Three refusals before a revision is written: the building changed, the price set changed, or the freight is under the minimum">
        <Box x={0} y={60} w={150} h={48} title="Press Save" detail="evaluationId sent back" />
        <Arrow from={150} to={190} y={84} />
        <Box x={190} y={60} w={150} h={48} title="Building hash" detail="same as when priced?" />
        <Arrow from={340} to={380} y={84} />
        <Box x={380} y={60} w={150} h={48} title="Price-set version" detail="overrides unchanged?" />
        <Arrow from={530} to={570} y={84} />
        <Box x={570} y={60} w={150} h={48} title="Freight minimum" detail="not below the scope floor?" />
        <Arrow from={720} to={760} y={84} />
        <Box x={760} y={60} w={140} h={48} title="Revision written" detail="frozen, immutable" fill="#fdf6e7" stroke={GOLD} />

        {/* the refusal path */}
        <Box x={190} y={132} w={340} h={38} title="409 — the building moved: price it again" fill="#fdf2f2" stroke="#b91c1c" titleColor="#b91c1c" />
        <Box x={570} y={132} w={330} h={38} title="422 — freight is under the minimum" fill="#fdf2f2" stroke="#b91c1c" titleColor="#b91c1c" />
        <Down x={265} from={108} to={132} />
        <Down x={645} from={108} to={132} />
      </Frame>
      <Caption>
        A refusal is not a failure. It means the figure on screen is no longer what this engine would
        produce, and writing it would freeze a price nobody can reproduce — the exact thing a frozen
        revision exists to prevent.
      </Caption>
    </>
  );
}
