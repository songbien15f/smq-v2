import type { HomePage } from '@/payload-types'
import { CountUp } from '@/components/ui/CountUp'

type StatStripProps = {
  stats: HomePage['stats']
}

const ARROW = '→'

/**
 * A trailing unit ("20–10,000 t") is rendered smaller and accent-coloured, as
 * the template does with an inline span on its third stat.
 */
const UNIT_SUFFIX = /^(.*\d)\s+(t|kg|tonnes?|ha|mm|m)$/

function unitParts(value: string): [string, string | null] {
  const match = value.match(UNIT_SUFFIX)
  return match ? [match[1], ` ${match[2]}`] : [value, null]
}

/**
 * Renders one stat value.
 *
 * Numeric values keep the CountUp behaviour. A value containing the delivery
 * arrow ("Door → Door") is non-numeric copy: it renders as text with the arrow
 * in the accent styling and never animates. A value with a trailing unit keeps
 * the number in the CountUp and wraps the unit in `.stat-unit`.
 */
function StatValue({ value }: { value: string }) {
  if (value.includes(ARROW)) {
    const [before, after = ''] = value.split(ARROW)

    return (
      <>
        {before}
        <span className="stat-accent" aria-hidden="true">
          {ARROW}
        </span>
        {after}
      </>
    )
  }

  const [number, unit] = unitParts(value)

  return (
    <>
      <CountUp value={number} />
      {unit ? <span className="stat-unit">{unit}</span> : null}
    </>
  )
}

export function StatStrip({ stats }: StatStripProps) {
  if (!stats?.length) return null

  return (
    <ul className="hero-stats">
      {stats.map((stat, index) => (
        <li key={`${stat.value}-${index}`} data-testid="stat">
          <div className="stat-num">
            <StatValue value={stat.value} />
            {stat.suffix ? <sup>{stat.suffix}</sup> : null}
          </div>
          <p className="stat-label">{stat.label}</p>
        </li>
      ))}
    </ul>
  )
}
