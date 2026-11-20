import { Fragment } from 'react'

type BreadcrumbItem = {
  label: string
  href?: string
}

type BreadcrumbsProps = {
  /** Trail below "Home", in reading order. The last item is the current page. */
  items: BreadcrumbItem[]
}

/**
 * The template's `.breadcrumb` nav from the page hero. "Home" is always the
 * first crumb, every crumb after it is separated by a `/` glyph, and the final
 * crumb is the current page (`aria-current="page"`). Server-rendered, so it
 * works without client JavaScript.
 */
export function Breadcrumbs({ items }: BreadcrumbsProps) {
  const trail: BreadcrumbItem[] = [{ label: 'Home', href: '/' }, ...items]
  const lastIndex = trail.length - 1

  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      {trail.map((item, index) => (
        <Fragment key={`${item.label}-${index}`}>
          {index > 0 ? (
            <span className="sep" aria-hidden="true">
              /
            </span>
          ) : null}
          {index === lastIndex ? (
            <span aria-current="page">{item.label}</span>
          ) : item.href ? (
            <a href={item.href}>{item.label}</a>
          ) : (
            <span>{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
