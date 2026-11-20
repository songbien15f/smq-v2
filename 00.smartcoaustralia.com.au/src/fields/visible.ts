import type { Field, GroupField } from 'payload'

/**
 * Per-section "show on the website" switches for the page globals.
 *
 * Editors need to hide a whole section without deleting its copy — a section
 * waiting on photography, or one the client has not approved yet. Deleting and
 * retyping loses the work.
 *
 * Two shapes, because Payload stores them differently:
 *
 * - **Group** sections (hero, intro, office split) carry the checkbox *inside*
 *   the group, so it renders at the top of the section's own panel.
 * - **Array** sections (certifications, QA items, steps) cannot do that: a field
 *   listed under `fields` belongs to every row, so the checkbox would hide one
 *   item instead of the section. Those get a sibling checkbox named
 *   `<arrayName>Visible` that renders immediately above the list.
 *
 * Both default to `true`, so a global seeded before the switch existed keeps
 * rendering. Only an explicit `false` hides anything — see
 * `isSectionVisible` in `src/lib/visibility.ts`.
 */
export const visibleField: Field = {
  name: 'visible',
  type: 'checkbox',
  label: 'Show this section',
  defaultValue: true,
  admin: {
    description: 'Turn off to hide this entire section on the public website. The copy is kept.',
  },
}

/** The sibling switch for an array-backed section. */
function arrayVisibilityField(name: string): Field {
  return {
    name: `${name}Visible`,
    type: 'checkbox',
    label: 'Show this section',
    defaultValue: true,
    admin: {
      description: `Turn off to hide the whole list below on the public website. The entries are kept.`,
    },
  }
}

/**
 * Wrap a top-level section with its switch.
 *
 * Groups get one extra field; arrays expand to two fields (the switch followed
 * by the array). Scalars and uploads carry no switch of their own — they belong
 * to a section and are hidden with it.
 */
export function withVisibility(field: Field): Field[] {
  if (field.type === 'group') {
    const group = field as GroupField
    return [{ ...group, fields: [visibleField, ...group.fields] }]
  }

  if (field.type === 'array') {
    return [arrayVisibilityField(field.name), field]
  }

  return [field]
}

/**
 * Apply switches to every top-level section of a global.
 *
 * Used as `fields: withSectionVisibility([...])` so all of a global's sections
 * are covered in one line, and a section added later is covered just by existing
 * there — nobody has to remember the wrapper.
 *
 * Not recursive on purpose: a group nested inside a section (office cards inside
 * the office split, bullets inside one capability) is part of that section, not
 * a section of its own.
 *
 * `skip` names fields that must stay unswitched — SEO metadata and form option
 * lists are not page sections.
 */
export function withSectionVisibility(
  fields: Field[],
  skip: string[] = ['meta', 'projectTypes', 'tonnageOptions', 'enquiryTypes'],
): Field[] {
  return fields.flatMap((field) => {
    if (field.type !== 'group' && field.type !== 'array') return [field]
    const name = 'name' in field ? field.name : undefined
    if (name && skip.includes(name)) return [field]
    return withVisibility(field)
  })
}
