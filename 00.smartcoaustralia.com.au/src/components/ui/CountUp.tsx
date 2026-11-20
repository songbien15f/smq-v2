'use client'

import { useEffect, useRef, useState } from 'react'

type CountUpProps = {
  /** Final display value, e.g. "2,000". Rendered as-is on the server. */
  value: string
  className?: string
}

const PLAIN_NUMBER = /^\d[\d,]*$/

/**
 * Animates a numeric stat from zero to its final value once, when it scrolls
 * into view. The final value is what the server renders, so no-JS readers (and
 * crawlers) always see the real number; reduced-motion users keep it too.
 */
export function CountUp({ value, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [display, setDisplay] = useState(value)
  const started = useRef(false)

  useEffect(() => {
    if (!PLAIN_NUMBER.test(value.trim())) return

    const target = Number(value.replace(/,/g, ''))
    if (!Number.isFinite(target)) return

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const element = ref.current
    const format = (n: number) => new Intl.NumberFormat('en-AU').format(n)

    const animate = () => {
      if (started.current) return
      started.current = true

      const duration = 1200
      const start = performance.now()
      setDisplay(format(0))

      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / duration)
        const eased = 1 - Math.pow(1 - progress, 3)
        if (progress < 1) {
          setDisplay(format(Math.round(target * eased)))
          requestAnimationFrame(step)
        } else {
          setDisplay(format(target))
        }
      }

      requestAnimationFrame(step)
    }

    if (!element || typeof IntersectionObserver === 'undefined') {
      animate()
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          animate()
          observer.disconnect()
        }
      },
      { threshold: 0.4 },
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [value])

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  )
}
