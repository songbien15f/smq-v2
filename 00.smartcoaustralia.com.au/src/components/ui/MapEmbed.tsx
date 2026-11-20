import { GET_DIRECTIONS_LABEL } from '@/lib/labels'

import { MapFrame } from './MapFrame'

type MapEmbedProps = {
  lat: number
  lng: number
  label: string
}

/**
 * A keyless OpenStreetMap view of one office location.
 *
 * The brief rules out static image maps and API keys, so this is the plain
 * OpenStreetMap embed iframe (its marker parameter pins the office). The
 * "Get directions" link hands off to Google Maps' universal directions URL, so
 * the visitor's own maps app opens with the destination filled in.
 *
 * This stays a server component; only the iframe and its failure handling live
 * in the `MapFrame` client wrapper, which swaps in a directions panel when the
 * OpenStreetMap host is unreachable.
 */
export function MapEmbed({ lat, lng, label }: MapEmbedProps) {
  // Roughly a 5 km box around the marker: enough context to place the office
  // without pinning the map so tight that the streets are unreadable.
  const delta = 0.045
  const bbox = [lng - delta, lat - delta, lng + delta, lat + delta]
    .map((value) => value.toFixed(5))
    .join('%2C')

  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`
  const directionsHref = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`

  return (
    <figure className="map-card">
      <div className="map-frame">
        <MapFrame
          src={src}
          title={`Map of ${label}`}
          label={label}
          directionsHref={directionsHref}
          directionsLabel={GET_DIRECTIONS_LABEL}
        />
      </div>
      <figcaption className="map-card-caption">
        <span className="map-card-label">{label}</span>
        <a
          className="btn btn-dark map-card-link"
          href={directionsHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          {GET_DIRECTIONS_LABEL}
        </a>
      </figcaption>
    </figure>
  )
}
