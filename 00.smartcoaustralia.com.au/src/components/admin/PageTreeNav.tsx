'use client'

import React from 'react'
import { usePathname } from 'next/navigation'

/**
 * Page tree for the admin sidebar.
 *
 * The five page globals registered so far are a flat list in Payload's own
 * navigation, which stops being usable once every page of the site has its own
 * form. This renders the site as a tree instead: each node is one page, with
 * its related collection nested underneath, so an editor can reach any piece of
 * copy for a page from one place.
 *
 * `ready: false` marks a page whose form does not exist yet; those links are
 * rendered muted and disabled rather than pointing at a 404.
 */
type PageNode = {
  label: string
  href: string
  ready?: boolean
  children?: PageNode[]
}

const PAGES: PageNode[] = [
  { label: 'Home', href: '/admin/globals/home-page' },
  { label: 'Capabilities', href: '/admin/globals/capabilities-page' },
  { label: 'Process', href: '/admin/globals/process-page' },
  { label: 'Quality', href: '/admin/globals/quality-page' },
  {
    label: 'Projects',
    href: '/admin/globals/projects-page',
    children: [
      { label: 'Project entries', href: '/admin/collections/projects' },
      { label: 'Detail template', href: '/admin/globals/project-detail-settings' },
    ],
  },
  {
    label: 'Products',
    href: '/admin/globals/products-page',
    children: [{ label: 'Product groups', href: '/admin/collections/product-groups' }],
  },
  {
    label: 'Team',
    href: '/admin/globals/team-page',
    children: [{ label: 'Team members', href: '/admin/collections/team-members' }],
  },
  {
    label: 'Contact',
    href: '/admin/globals/contact-page',
    children: [
      { label: 'Offices', href: '/admin/collections/offices' },
      { label: 'Inquiries', href: '/admin/collections/inquiries' },
    ],
  },
  { label: 'Privacy', href: '/admin/globals/privacy-page' },
]

const CHROME: PageNode[] = [
  { label: 'Site Settings', href: '/admin/globals/site-settings' },
  { label: 'Header', href: '/admin/globals/header' },
  { label: 'Footer', href: '/admin/globals/footer' },
  { label: 'Media library', href: '/admin/collections/media' },
  { label: 'Users', href: '/admin/collections/users' },
]

function Node({ node, pathname, depth }: { node: PageNode; pathname: string; depth: number }) {
  const active = pathname === node.href || pathname.startsWith(`${node.href}/`)

  return (
    <li>
      {node.ready === false ? (
        <span className="page-tree__link page-tree__link--pending" title="Form not built yet">
          {node.label}
          <span className="page-tree__hint">soon</span>
        </span>
      ) : (
        <a
          className={`page-tree__link${active ? ' page-tree__link--active' : ''}`}
          href={node.href}
          aria-current={active ? 'page' : undefined}
          style={{ paddingInlineStart: `${0.6 + depth * 0.85}rem` }}
        >
          {node.label}
        </a>
      )}
      {node.children?.length ? (
        <ul className="page-tree__list">
          {node.children.map((child) => (
            <Node key={child.href} node={child} pathname={pathname} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export default function PageTreeNav() {
  const pathname = usePathname() ?? ''

  return (
    <nav className="page-tree" aria-label="Website pages">
      <p className="page-tree__title">Website pages</p>
      <ul className="page-tree__list">
        {PAGES.map((page) => (
          <Node key={page.href} node={page} pathname={pathname} depth={0} />
        ))}
      </ul>
      <p className="page-tree__title">Site chrome</p>
      <ul className="page-tree__list">
        {CHROME.map((node) => (
          <Node key={node.href} node={node} pathname={pathname} depth={0} />
        ))}
      </ul>
    </nav>
  )
}
