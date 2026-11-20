'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

type RevealTag = 'div' | 'figure' | 'section' | 'article' | 'a' | 'li'

type RevealProps = {
  children: ReactNode
  className?: string
  id?: string
  as?: RevealTag
  testId?: string
  href?: string
}

/**
 * Scroll-reveal wrapper with a no-JS/no-motion safe default.
 *
 * The server renders the element fully visible. Only after mount does the
 * wrapper mark itself with data-js and, while off-screen, data-reveal="pending"
 * (the CSS that hides content keys off both attributes). When the element
 * intersects the viewport the `reveal` class is added and the element fades in.
 * Without JavaScript, or with prefers-reduced-motion: reduce, nothing is hidden.
 */
export function Reveal({ children, className, id, as = 'div', testId, href }: RevealProps) {
  const ref = useRef<HTMLElement>(null)
  const [mounted, setMounted] = useState(false)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    setMounted(true)

    const element = ref.current
    if (!element) return

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion || typeof IntersectionObserver === 'undefined') {
      setRevealed(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const classes = [className, revealed ? 'reveal' : null].filter(Boolean).join(' ')
  const state = {
    'data-testid': testId,
    'data-js': mounted ? 'true' : undefined,
    'data-reveal': mounted ? (revealed ? 'done' : 'pending') : undefined,
  }
  const shared = { id, className: classes || undefined, ...state }

  const assignRef = (node: HTMLElement | null) => {
    ref.current = node
  }

  switch (as) {
    case 'figure':
      return (
        <figure ref={assignRef} {...shared}>
          {children}
        </figure>
      )
    case 'section':
      return (
        <section ref={assignRef} {...shared}>
          {children}
        </section>
      )
    case 'article':
      return (
        <article ref={assignRef} {...shared}>
          {children}
        </article>
      )
    case 'a':
      return (
        <a ref={assignRef} href={href} {...shared}>
          {children}
        </a>
      )
    case 'li':
      return (
        <li ref={assignRef} {...shared}>
          {children}
        </li>
      )
    default:
      return (
        <div ref={assignRef} {...shared}>
          {children}
        </div>
      )
  }
}
