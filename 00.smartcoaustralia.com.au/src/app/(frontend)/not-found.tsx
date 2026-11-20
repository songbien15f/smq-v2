import Link from 'next/link'

import { PageHero } from '@/components/ui/PageHero'

/** 404 page for the public site; `notFound()` renders this with a 404 status. */
export default function FrontendNotFound() {
  return (
    <main id="main">
      <PageHero
        eyebrow="Error 404"
        title="Page not found"
        lede="The page you are looking for has moved or no longer exists. Head back to the projects list or the home page."
      >
        <Link className="btn btn-accent" href="/projects">
          All Projects
        </Link>
        <Link className="btn btn-ghost" href="/">
          Back to Home
        </Link>
      </PageHero>
    </main>
  )
}
