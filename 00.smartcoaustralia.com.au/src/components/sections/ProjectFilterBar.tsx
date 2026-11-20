'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  FILTER_SECTOR_LABEL,
  FILTER_STATE_LABEL,
  SECTOR_FILTERS,
  STATE_FILTERS,
} from '@/lib/labels'

type ProjectFilterBarProps = {
  initialSector: string
  initialState: string
}

const SECTOR_LABEL_ID = 'project-sector-label'
const STATE_SELECT_ID = 'project-state-filter'

/**
 * Sector buttons and the state select for the projects list.
 *
 * The server filters the list from `searchParams`, so this component only
 * writes the URL: a click swaps the query string with `router.replace` and the
 * filtered grid comes back from the server. Without JavaScript the first render
 * is already filtered, because the URL carries the same values.
 */
export function ProjectFilterBar({ initialSector, initialState }: ProjectFilterBarProps) {
  const router = useRouter()
  const [sector, setSector] = useState(initialSector)
  const [state, setState] = useState(initialState)

  // Navigations (including back/forward) hand back new server values; mirror them
  // so the highlighted button and the select always match the rendered list.
  useEffect(() => setSector(initialSector), [initialSector])
  useEffect(() => setState(initialState), [initialState])

  const apply = (nextSector: string, nextState: string) => {
    setSector(nextSector)
    setState(nextState)

    const params = new URLSearchParams()
    if (nextSector) params.set('sector', nextSector)
    if (nextState) params.set('state', nextState)
    const query = params.toString()

    router.replace(query ? `/projects?${query}` : '/projects', { scroll: false })
  }

  return (
    <div className="filter-bar">
      <div className="filter-group">
        <span className="filter-label" id={SECTOR_LABEL_ID}>
          {FILTER_SECTOR_LABEL}
        </span>
        <div className="filter-row" role="group" aria-labelledby={SECTOR_LABEL_ID}>
          {SECTOR_FILTERS.map((option) => {
            const active = option.value === sector
            return (
              <button
                key={option.label}
                type="button"
                className={active ? 'filter-btn active' : 'filter-btn'}
                aria-pressed={active}
                onClick={() => apply(option.value, state)}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="filter-group">
        <label htmlFor={STATE_SELECT_ID}>{FILTER_STATE_LABEL}</label>
        <select
          id={STATE_SELECT_ID}
          className="filter-select"
          value={state}
          onChange={(event) => apply(sector, event.target.value)}
        >
          {STATE_FILTERS.map((option) => (
            <option key={option.label} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
