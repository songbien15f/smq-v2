import type { Project } from '../payload-types'

export type ProjectFilters = {
  sector?: string | null
  state?: string | null
}

/** Pure client/server filter used by the projects list. */
export function filterProjects(projects: Project[], filters: ProjectFilters = {}): Project[] {
  const sector = filters.sector?.trim()
  const state = filters.state?.trim()

  return projects.filter(
    (project) =>
      (!sector || project.sector === sector) && (!state || project.state === state),
  )
}

/** The single project flagged as featured, if any. */
export function pickFeatured(projects: Project[]): Project | null {
  return projects.find((project) => project.featured === true) ?? null
}
