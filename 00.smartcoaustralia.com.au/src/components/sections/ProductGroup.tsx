import type { ProductGroup as ProductGroupData } from '@/payload-types'

import { Reveal } from '@/components/ui/Reveal'

type ProductGroupProps = {
  group: ProductGroupData
}

/**
 * One product group panel (template `.product-panel`): the group title with its
 * accent dot, an optional description and the dotted two-column item list
 * (`.product-list`).
 *
 * `role="list"` restates list semantics: the items are flex boxes, so the
 * browser renders no list markers of its own.
 */
export function ProductGroup({ group }: ProductGroupProps) {
  const items = group.items ?? []

  return (
    <Reveal className="product-panel" testId="product-group">
      <h3>
        <span className="p-dot" aria-hidden="true" />
        {group.title}
      </h3>
      {group.description ? <p>{group.description}</p> : null}
      {items.length > 0 ? (
        <ul className="product-list" role="list">
          {items.map((item, index) => (
            <li key={`${item.name}-${index}`} data-testid="product-item">
              {item.name}
            </li>
          ))}
        </ul>
      ) : null}
    </Reveal>
  )
}
