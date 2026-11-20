import type { Office } from '@/payload-types'

import { MapEmbed } from '@/components/ui/MapEmbed'
import { Reveal } from '@/components/ui/Reveal'
import {
  MAP_CREDIT_HREF,
  MAP_CREDIT_LABEL,
  OFFICE_CALL_CTA,
  OFFICE_DIRECTIONS_CTA,
  OFFICE_HOURS_HEADING,
  OFFICE_MAP_TITLE,
} from '@/lib/labels'

type ContactOfficesProps = {
  offices: Office[]
}

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

const hasCoords = (
  office: Office,
): office is Office & { lat: number; lng: number } =>
  typeof office.lat === 'number' && typeof office.lng === 'number'

/** An office card's address block: one line per seeded address line. */
function Address({ lines }: { lines?: string[] | null }) {
  if (!lines?.length) return null

  return (
    <address>
      {lines.map((line, index) => (
        <span key={`${line}-${index}`}>
          {line}
          {index < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </address>
  )
}

/**
 * The first hours row carries the group heading in its label ("Office Hours
 * (AEST)") and the weekday opening in its value ("Monday – Friday 8:30 am –
 * 5:30 pm"), matching the template. Split that value into the day and the times
 * so the card keeps the template's two-column list; anything that does not look
 * like "day + time" is kept whole.
 */
function splitOpening(value: string): [string, string] {
  const match = value.match(/^(.*?)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm).*)$/i)
  return match ? [match[1], match[2]] : [value, '']
}

function Hours({ office }: { office: Office }) {
  const rows = office.hours ?? []
  if (rows.length === 0) return null

  const [first, ...rest] = rows
  const [firstDay, firstTime] = splitOpening(first.value)

  return (
    <div className="hours">
      <h4>{first.label || OFFICE_HOURS_HEADING}</h4>
      <ul>
        <li>
          <span>{firstDay}</span>
          {firstTime ? <span>{firstTime}</span> : null}
        </li>
        {rest.map((row, index) => (
          <li key={`${row.label}-${index}`}>
            <span>{row.label}</span>
            <span>{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The three office cards plus the two office maps.
 *
 * Offices come from the `offices` collection, so an editor's phone or address
 * change reaches this page without a deploy. Sydney and Ho Chi Minh City have
 * coordinates and get a map; Western Australia is an enquiry line only, so its
 * card's action is the phone number instead.
 */
export function ContactOffices({ offices }: ContactOfficesProps) {
  const mappable = offices.filter(hasCoords)

  return (
    <>
      <div className="office-detail-grid">
        {offices.map((office) => (
          <Reveal as="article" className="office-card" key={office.id} testId="office-card">
            <h3>{office.name}</h3>
            {office.role ? <p className="c-role">{office.role}</p> : null}
            <Address lines={office.addressLines} />

            {office.phone ? (
              <p className="c-line">
                Phone: <a href={telHref(office.phone)}>{office.phone}</a>
              </p>
            ) : null}
            {office.email ? (
              <p className="c-line">
                Email: <a href={`mailto:${office.email}`}>{office.email}</a>
              </p>
            ) : null}

            <Hours office={office} />

            <div className="btn-wrap">
              {hasCoords(office) ? (
                <a
                  className="btn btn-dark"
                  href={`https://www.google.com/maps/dir/?api=1&destination=${office.lat},${office.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {OFFICE_DIRECTIONS_CTA}
                </a>
              ) : office.phone ? (
                <a className="btn btn-dark" href={telHref(office.phone)}>
                  {OFFICE_CALL_CTA}
                </a>
              ) : null}
            </div>
          </Reveal>
        ))}
      </div>

      {mappable.length > 0 ? (
        <div className="map-block">
          <div className="section-head">
            <p className="eyebrow">{OFFICE_MAP_TITLE.eyebrow}</p>
            <h2>{OFFICE_MAP_TITLE.title}</h2>
          </div>

          <div className="map-grid">
            {mappable.map((office) => (
              <MapEmbed
                key={office.id}
                lat={office.lat}
                lng={office.lng}
                label={[office.name, office.addressLines?.[0]].filter(Boolean).join(' — ')}
              />
            ))}
          </div>

          <p className="map-credit">
            <a href={MAP_CREDIT_HREF} target="_blank" rel="noopener noreferrer">
              {MAP_CREDIT_LABEL}
            </a>
          </p>
        </div>
      ) : null}
    </>
  )
}
