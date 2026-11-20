'use client'

import { useEffect, useState } from 'react'

type MapFrameProps = {
  src: string
  title: string
  label: string
  directionsHref: string
  directionsLabel: string
}

/**
 * The only client-side part of the map embed: it watches the OpenStreetMap
 * iframe and falls back to a directions panel when the host cannot be reached.
 *
 * The iframe's own `load` and `error` events are not enough — Chromium fires
 * `load` even for a network failure (it renders its own error page inside the
 * frame) and the cross-origin document is unreadable. A `no-cors` probe to the
 * same URL is the reliable signal instead: it resolves (opaquely) when the host
 * is reachable and rejects when DNS/TLS/connection fails, which is exactly the
 * failure the fallback exists for.
 *
 * The server still renders the iframe, so no-JS readers get the map; the
 * fallback only replaces the frame after a failed probe.
 */
export function MapFrame({ src, title, label, directionsHref, directionsLabel }: MapFrameProps) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (failed || !src) return

    let cancelled = false
    const controller = new AbortController()
    // A hanging connection (rather than an outright refusal) must not leave an
    // empty frame forever, so the probe gives up after ten seconds.
    const timer = window.setTimeout(() => controller.abort(), 10_000)

    fetch(src, { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
      .catch(() => {
        // The abort in the cleanup (including StrictMode's remount) is not a
        // network failure, so only a live probe may show the fallback.
        if (!cancelled) setFailed(true)
      })
      .finally(() => window.clearTimeout(timer))

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [failed, src])

  return (
    <>
      <iframe
        className="map-iframe"
        src={src}
        title={title}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        hidden={failed}
        onError={() => setFailed(true)}
      />
      {failed ? (
        <div className="map-fallback-card" data-testid="map-fallback">
          <p className="map-fallback-label">{label}</p>
          <p className="map-fallback-note">
            The interactive map could not load. Open the location in your maps app instead.
          </p>
          <a
            className="btn btn-dark map-card-link"
            href={directionsHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            {directionsLabel}
          </a>
        </div>
      ) : null}
    </>
  )
}
