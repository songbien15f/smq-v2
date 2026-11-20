import 'dotenv/config'
import path from 'node:path'
import { getPayload, type Payload } from 'payload'

import config from '../payload.config'
import {
  CAPABILITIES_CONTENT,
  CONTACT_PAGE_CONTENT,
  FOOTER_CONTENT,
  HEADER_CONTENT,
  HOME_CONTENT,
  OFFICES_CONTENT,
  PROCESS_CONTENT,
  PRODUCT_GROUPS_CONTENT,
  PRODUCTS_PAGE_CONTENT,
  PRIVACY_PAGE_CONTENT,
  PROJECTS_CONTENT,
  PROJECTS_PAGE_CONTENT,
  PROJECT_DETAIL_CONTENT,
  QUALITY_CONTENT,
  QUOTE_PAGE_CONTENT,
  SITE_SETTINGS_CONTENT,
  TEAM_CONTENT,
  TEAM_PAGE_CONTENT,
  lexicalParagraphs,
  lexicalPrivacyBody,
} from './content'

const containsEqual = (existing: unknown, desired: unknown): boolean => {
  if (desired === null || typeof desired !== 'object') {
    return existing === desired
  }

  if (Array.isArray(desired)) {
    if (!Array.isArray(existing) || existing.length !== desired.length) return false
    return desired.every((value, index) => containsEqual(existing[index], value))
  }

  if (!existing || typeof existing !== 'object') return false

  const record = existing as Record<string, unknown>
  return Object.entries(desired as Record<string, unknown>).every(([key, value]) =>
    containsEqual(record[key], value),
  )
}

const seedAdminUser = async (payload: Payload) => {
  const existing = await payload.find({ collection: 'users', limit: 1, depth: 0 })

  if (existing.totalDocs > 0) {
    payload.logger.info('Seed skipped: a user already exists')
    return
  }

  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD

  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set to seed the first admin user')
  }

  const user = await payload.create({
    collection: 'users',
    data: {
      email,
      password,
      name: 'Admin',
      role: 'admin',
    },
  })

  payload.logger.info(`Created admin user: ${user.email}`)
}

const ensureMedia = async (payload: Payload, filename: string, alt: string) => {
  const existing = await payload.find({
    collection: 'media',
    where: { filename: { equals: filename } },
    limit: 1,
    depth: 0,
  })

  if (existing.docs[0]) return existing.docs[0]

  const media = await payload.create({
    collection: 'media',
    data: { alt },
    filePath: path.resolve(process.cwd(), 'public', 'images', 'seed', filename),
  })

  payload.logger.info(`Uploaded seed image: ${filename}`)
  return media
}

const ensureLogo = async (payload: Payload) => {
  const logo = await ensureMedia(
    payload,
    SITE_SETTINGS_CONTENT.logoFilename,
    SITE_SETTINGS_CONTENT.logoAlt,
  )
  payload.logger.info(`Seed logo ready: ${SITE_SETTINGS_CONTENT.logoFilename}`)
  return logo
}

const normaliseSiteSettings = (doc: unknown) => {
  const brand = (doc as { brand?: Record<string, unknown> } | null)?.brand
  const contact = (doc as { contact?: Record<string, unknown> } | null)?.contact
  const logo = brand?.logo

  return {
    brand: {
      ...brand,
      logo: logo && typeof logo === 'object' ? (logo as { id?: number }).id : (logo ?? null),
    },
    contact,
    updatedAt: (doc as { updatedAt?: string | null } | null)?.updatedAt ?? null,
  }
}

const isUpToDate = (doc: unknown, desired: unknown) => {
  // findGlobal returns field defaults when the singleton has never been saved, so
  // updatedAt is the signal that a real row exists in the database.
  const updatedAt = (doc as { updatedAt?: string | null } | null)?.updatedAt
  return Boolean(updatedAt) && containsEqual(doc, desired)
}

const seedGlobals = async (payload: Payload) => {
  const [header, footer, settings, logo] = await Promise.all([
    payload.findGlobal({ slug: 'header', depth: 0 }),
    payload.findGlobal({ slug: 'footer', depth: 0 }),
    payload.findGlobal({ slug: 'site-settings', depth: 0 }),
    ensureLogo(payload),
  ])

  if (isUpToDate(header, HEADER_CONTENT)) {
    payload.logger.info('Header global unchanged')
  } else {
    await payload.updateGlobal({ slug: 'header', data: HEADER_CONTENT })
    payload.logger.info('Updated header global')
  }

  if (isUpToDate(footer, FOOTER_CONTENT)) {
    payload.logger.info('Footer global unchanged')
  } else {
    await payload.updateGlobal({ slug: 'footer', data: FOOTER_CONTENT })
    payload.logger.info('Updated footer global')
  }

  const desiredSettings = {
    brand: { ...SITE_SETTINGS_CONTENT.brand, logo: logo.id },
    contact: SITE_SETTINGS_CONTENT.contact,
  }

  if (isUpToDate(normaliseSiteSettings(settings), desiredSettings)) {
    payload.logger.info('Site settings global unchanged')
  } else {
    await payload.updateGlobal({ slug: 'site-settings', data: desiredSettings })
    payload.logger.info('Updated site settings global')
  }
}

const seedProjects = async (payload: Payload) => {
  let created = 0
  let updated = 0

  for (const [index, [slug, project]] of Object.entries(PROJECTS_CONTENT).entries()) {
    const heroImage = await ensureMedia(payload, project.img, project.alt)

    const data = {
      title: project.title,
      slug,
      location: project.loc,
      state: project.state,
      sector: project.sector.toLowerCase() as 'industrial' | 'agricultural' | 'community',
      structure: project.structure,
      intro: project.intro,
      cardSummary: project.cardSummary,
      cardTag: project.cardTag,
      overview: lexicalParagraphs(project.overview),
      scope: project.scope,
      facts: [
        { label: 'Sector', value: project.sector },
        { label: 'Structure', value: project.structure },
      ],
      heroImage: heroImage.id,
      gallery: [],
      featured: slug === 'warehouse-newcastle',
      order: index,
      meta: { title: project.title, description: project.intro },
      _status: 'published' as const,
    }

    const existing = await payload.find({
      collection: 'projects',
      where: { slug: { equals: slug } },
      limit: 1,
      depth: 0,
      draft: true,
    })

    if (existing.docs[0]) {
      await payload.update({ collection: 'projects', id: existing.docs[0].id, data })
      updated += 1
    } else {
      await payload.create({ collection: 'projects', data })
      created += 1
    }
  }

  payload.logger.info(`Projects seeded: ${created} created, ${updated} updated`)
}

const seedTeamMembers = async (payload: Payload) => {
  let created = 0
  let updated = 0

  for (const member of TEAM_CONTENT) {
    const photo = await ensureMedia(payload, member.photoFilename, member.photoAlt)

    const data = {
      name: member.name,
      role: member.role,
      bio: lexicalParagraphs([member.bio]),
      photo: photo.id,
      initials: member.initials,
      order: member.order,
      _status: 'published' as const,
    }

    const existing = await payload.find({
      collection: 'team-members',
      where: { name: { equals: member.name } },
      limit: 1,
      depth: 0,
      draft: true,
    })

    if (existing.docs[0]) {
      await payload.update({ collection: 'team-members', id: existing.docs[0].id, data })
      updated += 1
    } else {
      await payload.create({ collection: 'team-members', data })
      created += 1
    }
  }

  payload.logger.info(`Team members seeded: ${created} created, ${updated} updated`)
}

const seedProductGroups = async (payload: Payload) => {
  let created = 0
  let updated = 0

  for (const group of PRODUCT_GROUPS_CONTENT) {
    const data = {
      title: group.title,
      eyebrow: group.eyebrow,
      description: group.description,
      items: group.items.map(({ name }) => ({ name })),
      order: group.order,
      _status: 'published' as const,
    }

    const existing = await payload.find({
      collection: 'product-groups',
      where: { title: { equals: group.title } },
      limit: 1,
      depth: 0,
      draft: true,
    })

    if (existing.docs[0]) {
      await payload.update({ collection: 'product-groups', id: existing.docs[0].id, data })
      updated += 1
    } else {
      await payload.create({ collection: 'product-groups', data })
      created += 1
    }
  }

  payload.logger.info(`Product groups seeded: ${created} created, ${updated} updated`)
}

const seedOffices = async (payload: Payload) => {
  let created = 0
  let updated = 0

  for (const office of OFFICES_CONTENT) {
    const data = {
      name: office.name,
      countryCode: office.countryCode,
      role: office.role,
      addressLines: office.addressLines,
      phone: office.phone,
      email: office.email,
      hours: office.hours.map(({ label, value }) => ({ label, value })),
      lat: office.lat,
      lng: office.lng,
      directionsUrl: office.directionsUrl,
      order: office.order,
    }

    const existing = await payload.find({
      collection: 'offices',
      where: { name: { equals: office.name } },
      limit: 1,
      depth: 0,
    })

    if (existing.docs[0]) {
      await payload.update({ collection: 'offices', id: existing.docs[0].id, data })
      updated += 1
    } else {
      await payload.create({ collection: 'offices', data })
      created += 1
    }
  }

  payload.logger.info(`Offices seeded: ${created} created, ${updated} updated`)
}

const seedHomePage = async (payload: Payload) => {
  const existing = await payload.findGlobal({ slug: 'home-page', depth: 0 })

  const [heroImage, splitImage] = await Promise.all([
    ensureMedia(payload, HOME_CONTENT.hero.imageFilename, HOME_CONTENT.hero.imageAlt),
    ensureMedia(payload, HOME_CONTENT.officeSplit.imageFilename, HOME_CONTENT.officeSplit.imageAlt),
  ])

  const desired = {
    meta: { ...HOME_CONTENT.meta },
    hero: {
      kicker: HOME_CONTENT.hero.kicker,
      title: HOME_CONTENT.hero.title,
      highlight: HOME_CONTENT.hero.highlight,
      lede: HOME_CONTENT.hero.lede,
      primaryLabel: HOME_CONTENT.hero.primaryLabel,
      primaryHref: HOME_CONTENT.hero.primaryHref,
      secondaryLabel: HOME_CONTENT.hero.secondaryLabel,
      secondaryHref: HOME_CONTENT.hero.secondaryHref,
      image: heroImage.id,
    },
    stats: HOME_CONTENT.stats.map((stat) => ({ ...stat })),
    certificationsLabel: HOME_CONTENT.certificationsLabel,
    certifications: HOME_CONTENT.certifications.map((item) => ({ ...item })),
    officeSplit: {
      eyebrow: HOME_CONTENT.officeSplit.eyebrow,
      title: HOME_CONTENT.officeSplit.title,
      body: HOME_CONTENT.officeSplit.body,
      offices: HOME_CONTENT.officeSplit.offices.map((office) => ({ ...office })),
      image: splitImage.id,
      imageAlt: HOME_CONTENT.officeSplit.imageAlt,
      captionLead: HOME_CONTENT.officeSplit.captionLead,
      caption: HOME_CONTENT.officeSplit.caption,
    },
    exploreIntro: { ...HOME_CONTENT.exploreIntro },
    exploreCards: HOME_CONTENT.exploreCards.map((card) => ({ ...card })),
    featuredSection: { ...HOME_CONTENT.featuredSection },
  }

  if (isUpToDate(existing, desired)) {
    payload.logger.info('Home page global unchanged')
    return
  }

  await payload.updateGlobal({ slug: 'home-page', data: desired })
  payload.logger.info('Updated home page global')
}

const seedCapabilitiesPage = async (payload: Payload) => {
  const existing = await payload.findGlobal({ slug: 'capabilities-page', depth: 0 })

  const capabilities = []

  for (const capability of CAPABILITIES_CONTENT.capabilities) {
    const image =
      capability.imageFilename && capability.imageAlt
        ? await ensureMedia(payload, capability.imageFilename, capability.imageAlt)
        : null

    capabilities.push({
      title: capability.title,
      body: capability.body,
      features: capability.features.map((feature) => ({ ...feature })),
      image: image?.id ?? null,
    })
  }

  const desired = {
    meta: { ...CAPABILITIES_CONTENT.meta },
    hero: { ...CAPABILITIES_CONTENT.hero },
    intro: { ...CAPABILITIES_CONTENT.intro },
    capabilities,
  }

  if (isUpToDate(existing, desired)) {
    payload.logger.info('Capabilities page global unchanged')
    return
  }

  await payload.updateGlobal({ slug: 'capabilities-page', data: desired })
  payload.logger.info('Updated capabilities page global')
}

const seedProcessPage = async (payload: Payload) => {
  const existing = await payload.findGlobal({ slug: 'process-page', depth: 0 })

  const desired = {
    meta: { ...PROCESS_CONTENT.meta },
    hero: { ...PROCESS_CONTENT.hero },
    intro: { ...PROCESS_CONTENT.intro },
    steps: PROCESS_CONTENT.steps.map((step) => ({ ...step })),
    cta: { ...PROCESS_CONTENT.cta },
  }

  if (isUpToDate(existing, desired)) {
    payload.logger.info('Process page global unchanged')
    return
  }

  await payload.updateGlobal({ slug: 'process-page', data: desired })
  payload.logger.info('Updated process page global')
}

const seedQualityPage = async (payload: Payload) => {
  const existing = await payload.findGlobal({ slug: 'quality-page', depth: 0 })

  const image = await ensureMedia(
    payload,
    QUALITY_CONTENT.imageFilename,
    QUALITY_CONTENT.imageAlt,
  )

  const desired = {
    meta: { ...QUALITY_CONTENT.meta },
    hero: { ...QUALITY_CONTENT.hero },
    image: image.id,
    imageCaption: QUALITY_CONTENT.imageCaption,
    intro: { ...QUALITY_CONTENT.intro },
    qaItems: QUALITY_CONTENT.qaItems.map((item) => ({ ...item })),
    managementSystems: { ...QUALITY_CONTENT.managementSystems },
  }

  if (isUpToDate(existing, desired)) {
    payload.logger.info('Quality page global unchanged')
    return
  }

  await payload.updateGlobal({ slug: 'quality-page', data: desired })
  payload.logger.info('Updated quality page global')
}

const seedProjectsPage = async (payload: Payload) => {
  const existing = await payload.findGlobal({ slug: 'projects-page', depth: 0 })

  const desired = {
    meta: { ...PROJECTS_PAGE_CONTENT.meta },
    hero: {
      eyebrow: PROJECTS_PAGE_CONTENT.hero.eyebrow,
      title: PROJECTS_PAGE_CONTENT.hero.title,
      lede: PROJECTS_PAGE_CONTENT.hero.lede,
      primaryLabel: PROJECTS_PAGE_CONTENT.hero.primaryLabel,
      primaryHref: PROJECTS_PAGE_CONTENT.hero.primaryHref,
      secondaryLabel: PROJECTS_PAGE_CONTENT.hero.secondaryLabel,
      secondaryHref: PROJECTS_PAGE_CONTENT.hero.secondaryHref,
      intro: { ...PROJECTS_PAGE_CONTENT.hero.intro },
    },
    note: { ...PROJECTS_PAGE_CONTENT.note },
  }

  if (isUpToDate(existing, desired)) {
    payload.logger.info('Projects page global unchanged')
    return
  }

  await payload.updateGlobal({ slug: 'projects-page', data: desired })
  payload.logger.info('Updated projects page global')
}

const seedProjectDetailSettings = async (payload: Payload) => {
  const existing = await payload.findGlobal({ slug: 'project-detail-settings', depth: 0 })

  const stages = []

  for (const stage of PROJECT_DETAIL_CONTENT.stages) {
    const image = await ensureMedia(payload, stage.imageFilename, stage.imageAlt)
    stages.push({
      title: stage.title,
      text: stage.text,
      image: image.id,
    })
  }

  const desired = {
    stagesIntro: PROJECT_DETAIL_CONTENT.stagesIntro,
    stages,
    qaIntro: PROJECT_DETAIL_CONTENT.qaIntro,
    qaDocs: PROJECT_DETAIL_CONTENT.qaDocs.map((label) => ({ label })),
    facts: PROJECT_DETAIL_CONTENT.facts.map((fact) => ({ ...fact })),
    priceCta: PROJECT_DETAIL_CONTENT.priceCta,
    contactPromptLead: PROJECT_DETAIL_CONTENT.contactPromptLead,
    contactPromptLabel: PROJECT_DETAIL_CONTENT.contactPromptLabel,
  }

  if (isUpToDate(existing, desired)) {
    payload.logger.info('Project detail settings global unchanged')
    return
  }

  await payload.updateGlobal({ slug: 'project-detail-settings', data: desired })
  payload.logger.info('Updated project detail settings global')
}

const seedProductsPage = async (payload: Payload) => {
  const existing = await payload.findGlobal({ slug: 'products-page', depth: 0 })

  const desired = {
    meta: { ...PRODUCTS_PAGE_CONTENT.meta },
    hero: { ...PRODUCTS_PAGE_CONTENT.hero },
    intro: { ...PRODUCTS_PAGE_CONTENT.intro },
    partnerNote: { ...PRODUCTS_PAGE_CONTENT.partnerNote },
  }

  if (isUpToDate(existing, desired)) {
    payload.logger.info('Products page global unchanged')
    return
  }

  await payload.updateGlobal({ slug: 'products-page', data: desired })
  payload.logger.info('Updated products page global')
}

const seedTeamPage = async (payload: Payload) => {
  const existing = await payload.findGlobal({ slug: 'team-page', depth: 0 })

  const quoteImage = await ensureMedia(
    payload,
    TEAM_PAGE_CONTENT.quote.imageFilename,
    TEAM_PAGE_CONTENT.quote.imageAlt,
  )

  const desired = {
    meta: { ...TEAM_PAGE_CONTENT.meta },
    hero: { ...TEAM_PAGE_CONTENT.hero },
    intro: { ...TEAM_PAGE_CONTENT.intro },
    quote: {
      text: TEAM_PAGE_CONTENT.quote.text,
      attribution: TEAM_PAGE_CONTENT.quote.attribution,
      image: quoteImage.id,
      imageAlt: TEAM_PAGE_CONTENT.quote.imageAlt,
    },
  }

  if (isUpToDate(existing, desired)) {
    payload.logger.info('Team page global unchanged')
    return
  }

  await payload.updateGlobal({ slug: 'team-page', data: desired })
  payload.logger.info('Updated team page global')
}

const seedQuotePage = async (payload: Payload) => {
  const existing = await payload.findGlobal({ slug: 'quote-page', depth: 0 })

  const desired = {
    meta: { ...QUOTE_PAGE_CONTENT.meta },
    hero: { ...QUOTE_PAGE_CONTENT.hero },
    stepsIntro: { ...QUOTE_PAGE_CONTENT.stepsIntro },
    steps: QUOTE_PAGE_CONTENT.steps.map((step) => ({ ...step })),
    tool: { ...QUOTE_PAGE_CONTENT.tool },
    fallback: { ...QUOTE_PAGE_CONTENT.fallback },
    form: { ...QUOTE_PAGE_CONTENT.form },
    projectTypes: QUOTE_PAGE_CONTENT.projectTypes.map((label) => ({ label })),
    tonnageOptions: QUOTE_PAGE_CONTENT.tonnageOptions.map((label) => ({ label })),
  }

  if (isUpToDate(existing, desired)) {
    payload.logger.info('Quote page global unchanged')
    return
  }

  await payload.updateGlobal({ slug: 'quote-page', data: desired })
  payload.logger.info('Updated quote page global')
}

const seedContactPage = async (payload: Payload) => {
  const existing = await payload.findGlobal({ slug: 'contact-page', depth: 0 })

  const desired = {
    meta: { ...CONTACT_PAGE_CONTENT.meta },
    hero: { ...CONTACT_PAGE_CONTENT.hero },
    intro: { ...CONTACT_PAGE_CONTENT.intro },
    quickLinks: CONTACT_PAGE_CONTENT.quickLinks.map((card) => ({ ...card })),
    whatsNextIntro: { ...CONTACT_PAGE_CONTENT.whatsNextIntro },
    whatsNext: CONTACT_PAGE_CONTENT.whatsNext.map((step) => ({ ...step })),
    quotePrompt: { ...CONTACT_PAGE_CONTENT.quotePrompt },
    formTitle: CONTACT_PAGE_CONTENT.formTitle,
    formIntro: CONTACT_PAGE_CONTENT.formIntro,
    formNote: CONTACT_PAGE_CONTENT.formNote,
    consentLabel: CONTACT_PAGE_CONTENT.consentLabel,
    consentHref: CONTACT_PAGE_CONTENT.consentHref,
    successHeading: CONTACT_PAGE_CONTENT.successHeading,
    successBody: CONTACT_PAGE_CONTENT.successBody,
    enquiryTypes: CONTACT_PAGE_CONTENT.enquiryTypes.map((label) => ({ label })),
  }

  if (isUpToDate(existing, desired)) {
    payload.logger.info('Contact page global unchanged')
    return
  }

  await payload.updateGlobal({ slug: 'contact-page', data: desired })
  payload.logger.info('Updated contact page global')
}

const seedPrivacyPage = async (payload: Payload) => {
  const existing = await payload.findGlobal({ slug: 'privacy-page', depth: 0 })

  const desired = {
    hero: { eyebrow: 'Privacy', title: 'Privacy Policy' },
    lastUpdated: PRIVACY_PAGE_CONTENT.lastUpdated,
    body: lexicalPrivacyBody(PRIVACY_PAGE_CONTENT.blocks),
    meta: { ...PRIVACY_PAGE_CONTENT.meta },
  }

  if (isUpToDate(existing, desired)) {
    payload.logger.info('Privacy page global unchanged')
    return
  }

  await payload.updateGlobal({ slug: 'privacy-page', data: desired })
  payload.logger.info('Updated privacy page global')
}

const seed = async () => {
  const payload = await getPayload({ config })

  await seedAdminUser(payload)
  await seedGlobals(payload)
  await seedHomePage(payload)
  await seedCapabilitiesPage(payload)
  await seedProcessPage(payload)
  await seedQualityPage(payload)
  await seedProjectsPage(payload)
  await seedProjectDetailSettings(payload)
  await seedProductsPage(payload)
  await seedTeamPage(payload)
  await seedQuotePage(payload)
  await seedContactPage(payload)
  await seedPrivacyPage(payload)
  await seedProjects(payload)
  await seedTeamMembers(payload)
  await seedProductGroups(payload)
  await seedOffices(payload)
}

try {
  await seed()
  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
}
