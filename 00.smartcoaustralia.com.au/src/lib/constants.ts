export type NavKey = 'home' | 'capabilities' | 'process' | 'quality' | 'projects' | 'products' | 'team' | 'contact'

export const MAIN_NAV: readonly { key: NavKey; href: string }[] = [
  { key: 'home', href: '/' },
  { key: 'capabilities', href: '/capabilities' },
  { key: 'process', href: '/process' },
  { key: 'quality', href: '/quality' },
  { key: 'projects', href: '/projects' },
  { key: 'products', href: '/products' },
  { key: 'team', href: '/team' },
  { key: 'contact', href: '/contact' },
]
