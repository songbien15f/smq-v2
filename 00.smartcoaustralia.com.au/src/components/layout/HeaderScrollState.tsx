'use client'

import { useEffect } from 'react'

const HEADER_ID = 'site-header'
const SCROLLED_ATTRIBUTE = 'data-scrolled'

/**
 * Adds `data-scrolled="true"` to the header once the page has scrolled, which
 * is what the page CSS uses to draw the template's shadow. Renders nothing.
 *
 * SSR-safe: the attribute is only ever set from a `scroll` listener installed
 * in an effect. Without JavaScript the header simply never shows the shadow,
 * which is the correct no-JS degradation. The listener is passive and removed
 * on unmount. Reduced motion does not disable it — a shadow is not motion.
 */
export function HeaderScrollState() {
  useEffect(() => {
    const header = document.getElementById(HEADER_ID)
    if (!header) return

    const apply = () => {
      if (window.scrollY > 8) {
        header.setAttribute(SCROLLED_ATTRIBUTE, 'true')
      } else {
        header.removeAttribute(SCROLLED_ATTRIBUTE)
      }
    }

    apply()
    window.addEventListener('scroll', apply, { passive: true })

    return () => {
      window.removeEventListener('scroll', apply)
      header.removeAttribute(SCROLLED_ATTRIBUTE)
    }
  }, [])

  return null
}
