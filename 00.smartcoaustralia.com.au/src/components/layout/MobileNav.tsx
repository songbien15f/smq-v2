'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

import { CLOSE_MENU_LABEL, MOBILE_MENU_LABEL } from '@/lib/labels'

type MobileNavProps = {
  navId: string
  itemCount: number
}

export function MobileNav({ navId, itemCount }: MobileNavProps) {
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const pathname = usePathname()

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Progressive enhancement: without this attribute the nav is a static, visible
  // list (and the toggle is hidden). Once hydrated, the header opts into the
  // collapsed drawer controlled by data-open.
  useEffect(() => {
    const header = toggleRef.current?.closest('header')
    if (!header) return

    header.setAttribute('data-js', 'true')

    return () => {
      header.removeAttribute('data-js')
      header.removeAttribute('data-open')
    }
  }, [])

  // Drive the single server-rendered nav from the header attribute. The nav keeps
  // its eight links at every viewport; only its visibility changes.
  useEffect(() => {
    const header = toggleRef.current?.closest('header')
    if (!header) return

    header.setAttribute('data-open', open ? 'true' : 'false')
  }, [open])

  // Move focus into the drawer when it opens.
  useEffect(() => {
    if (!open) return
    const nav = document.getElementById(navId)
    const firstLink = nav?.querySelector<HTMLElement>('a[href]')
    firstLink?.focus()
  }, [open, navId])

  // Escape closes the drawer; Tab is trapped between the toggle and its links.
  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        toggleRef.current?.focus()
        return
      }

      if (event.key !== 'Tab') return

      const nav = document.getElementById(navId)
      const toggle = toggleRef.current
      if (!nav || !toggle) return

      const focusable = [toggle, ...Array.from(nav.querySelectorAll<HTMLElement>('a[href]'))].filter(
        (element) => element.offsetParent !== null,
      )

      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, navId])

  const hasItems = itemCount > 0

  return (
    <button
      ref={toggleRef}
      type="button"
      className="nav-toggle"
      aria-expanded={open}
      aria-controls={navId}
      aria-label={open ? CLOSE_MENU_LABEL : MOBILE_MENU_LABEL}
      aria-disabled={hasItems ? undefined : true}
      onClick={() => setOpen((value) => !value)}
    >
      <span />
      <span />
      <span />
    </button>
  )
}
