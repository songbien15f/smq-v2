export const MOBILE_MENU_LABEL = 'Open menu'
export const CLOSE_MENU_LABEL = 'Close menu'
export const VIEW_PROJECT_LABEL = 'View project details'
export const ALL_PROJECTS_LABEL = 'All Projects'
export const FEATURED_PROJECT_LABEL = 'Featured Project'
export const FEATURED_PROJECT_CTA = 'View Project Details'
export const PROJECTS_PAGE_LABEL = 'Projects'
export const PRICE_SIMILAR_PROJECT_LABEL = 'Price a Similar Project'

/** Filter labels and option values are constants, never editable copy. */
export const FILTER_SECTOR_LABEL = 'Filter by sector'
export const FILTER_STATE_LABEL = 'Filter by state'

export type FilterOption = { value: string; label: string }

/** Sector filter buttons, in template order. The empty value means "all". */
export const SECTOR_FILTERS: readonly FilterOption[] = [
  { value: '', label: 'All Projects' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'agricultural', label: 'Agricultural' },
  { value: 'community', label: 'Community' },
]

/** State select options, in template order. The empty value means "all". */
export const STATE_FILTERS: readonly FilterOption[] = [
  { value: '', label: 'All states' },
  { value: 'NSW', label: 'New South Wales' },
  { value: 'QLD', label: 'Queensland' },
  { value: 'SA', label: 'South Australia' },
  { value: 'WA', label: 'Western Australia' },
]

/** Human label for a stored sector value (`industrial` -> `Industrial`). */
export function sectorLabel(value?: string | null): string {
  if (!value) return ''
  return SECTOR_FILTERS.find((option) => option.value === value)?.label ?? value
}

/** The projects results line under the filter bar. */
export function resultsNote(visible: number, total: number): string {
  if (visible === total) return `Showing all ${total} projects.`
  return `Showing ${visible} of ${total} projects.`
}

/**
 * The three contact-form offices. Values are the stored enum in the inquiries
 * collection, so they are constants rather than CMS copy; labels match the
 * template's select options verbatim.
 */
export const CONTACT_OFFICES = [
  { value: 'sydney', label: 'Sydney — Head Office' },
  { value: 'wa', label: 'Western Australia — Enquiries' },
  { value: 'hcmc', label: 'Ho Chi Minh City — Vietnam Office' },
] as const

export type ContactOfficeValue = (typeof CONTACT_OFFICES)[number]['value']

/** Human label for a chosen office value, used in the form's "sending to" note. */
export function contactOfficeLabel(value: string): string {
  return CONTACT_OFFICES.find((office) => office.value === value)?.label ?? ''
}

/** Map chrome on the contact page. */
export const GET_DIRECTIONS_LABEL = 'Get directions'
export const MAP_CREDIT_LABEL = '© OpenStreetMap contributors'
export const MAP_CREDIT_HREF = 'https://www.openstreetmap.org/copyright'

/** The phrase inside the consent copy that links to the privacy page. */
export const PRIVACY_LINK_LABEL = 'Privacy Policy'

/** Office card chrome. */
export const OFFICE_DIRECTIONS_CTA = 'Get Directions'
export const OFFICE_HOURS_HEADING = 'Opening hours'

/** The line under the contact form's Office select. */
export const CONTACT_OFFICE_HINT = 'Your message goes to:'

/**
 * The map block's heading. The template puts "Find Us" / "Office locations"
 * directly above the map, which is what these strings render.
 */
export const OFFICE_MAP_TITLE = {
  eyebrow: 'Find Us',
  title: 'Office locations',
}

/**
 * The template's enquiry line (Western Australia) has no map, so its card's
 * action is a phone call. Named after the office the template names.
 */
export const OFFICE_CALL_CTA = 'Call the WA Line'
