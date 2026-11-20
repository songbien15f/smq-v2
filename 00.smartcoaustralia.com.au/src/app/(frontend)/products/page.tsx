import type { Metadata } from 'next'

import type { ProductsPage } from '@/payload-types'
import { ProductGroup } from '@/components/sections/ProductGroup'
import { PageHero } from '@/components/ui/PageHero'
import { SectionHead } from '@/components/ui/SectionHead'
import { getProductGroups } from '@/lib/data'
import { getGlobal } from '@/lib/payload'
import { buildMetadata } from '@/lib/seo'
import { isSectionVisible } from '@/lib/visibility'

export async function generateMetadata(): Promise<Metadata> {
  const page = await getGlobal<ProductsPage>('products-page')

  return buildMetadata({
    title: page?.meta?.title || 'Products',
    description:
      page?.meta?.description ||
      'Any steel or aluminium product, fabricated and finished to your specification — supplied on its own, or as part of a full structural package.',
    path: '/products',
  })
}

export default async function ProductsPageView() {
  const [page, groups] = await Promise.all([
    getGlobal<ProductsPage>('products-page'),
    getProductGroups(),
  ])

  const showIntro = isSectionVisible(page.intro)
  const showPartnerNote = isSectionVisible(page.partnerNote)

  return (
    <main id="main">
      {isSectionVisible(page.hero) ? (
        <PageHero eyebrow={page.hero.eyebrow} title={page.hero.title} lede={page.hero.lede} />
      ) : null}

      <section className="products" id="products" aria-labelledby="products-h">
        <div className="wrap">
          {showIntro ? (
            <SectionHead
              eyebrow={page.intro.eyebrow}
              title={page.intro.title}
              body={page.intro.body}
              id="products-h"
              reveal
            />
          ) : null}

          <div className="product-cols">
            {groups.map((group) => (
              <ProductGroup key={group.id} group={group} />
            ))}
          </div>

          {showPartnerNote && page.partnerNote?.body ? (
            <div className="quality-note products-note">
              {page.partnerNote.title ? <strong>{page.partnerNote.title}</strong> : null}{' '}
              {page.partnerNote.body}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}
