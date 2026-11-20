import type { NavKey } from '../lib/constants'

export const HEADER_CONTENT: {
  labels: Record<NavKey, string>
  ctaLabel: string
  ctaHref: string
  showTopStrip: boolean
  topStripLocations: { label: string }[]
} = {
  labels: {
    home: 'Home',
    capabilities: 'Capabilities',
    process: 'Process',
    quality: 'Quality',
    projects: 'Projects',
    products: 'Products',
    team: 'Team',
    contact: 'Contact',
  },
  ctaLabel: 'Request a Quote',
  ctaHref: '/quote',
  showTopStrip: true,
  topStripLocations: [{ label: 'Sydney, Australia' }, { label: 'Ho Chi Minh City, Vietnam' }],
}

export const FOOTER_CONTENT: {
  description: string
  compliance: { label: string; href?: string }[]
  copyright: string
  modernSlaveryText: string
} = {
  description:
    'Structural steel fabricated in Vietnam to Australian codes and standards — designed, inspected and delivered door to door by one accountable team.',
  compliance: [
    { label: 'ISO 9001 · 14001 · 45001', href: '/quality' },
    { label: 'CC3 Traceability (SCA)', href: '/quality' },
    { label: 'Welding — AS/NZS 1554.1', href: '/quality' },
    { label: 'Galvanising — AS/NZS 4680', href: '/quality' },
    { label: 'Modern Slavery Statement', href: 'mailto:info@smartsolutionsaustralia.com.au' },
  ],
  copyright: '© 2026 Smart Solutions Australia. All rights reserved.',
  modernSlaveryText:
    'Modern slavery concerns: info@smartsolutionsaustralia.com.au · +84 908 275 404 · +61 412 898 866',
}

export const SITE_SETTINGS_CONTENT: {
  brand: {
    siteName: string
    legalName: string
    tagline: string
  }
  contact: {
    email: string
    phoneAU: string
    phoneVN: string
    phoneWA: string
  }
  logoFilename: string
  logoAlt: string
} = {
  brand: {
    siteName: 'Smart Solutions Australia',
    legalName: 'Smart Solutions Australia',
    tagline: 'Australian-standard steel, fabricated in Vietnam, delivered to your site',
  },
  contact: {
    email: 'info@smartsolutionsaustralia.com.au',
    phoneAU: '+61 412 239 259',
    phoneVN: '+84 908 275 404',
    phoneWA: '+61 427 710 479',
  },
  logoFilename: '02-smart-solutions-australia.png',
  logoAlt: 'Smart Solutions Australia',
}

export type ProjectState = 'NSW' | 'QLD' | 'SA' | 'WA' | 'VIC' | 'TAS' | 'NT' | 'ACT' | 'PNG'

export type ProjectSector = 'industrial' | 'agricultural' | 'community'

export type ProjectSeed = {
  title: string
  loc: string
  state: ProjectState
  sector: string
  structure: string
  img: string
  alt: string
  intro: string
  /** Short projects-grid paragraph; the template's own card copy. */
  cardSummary: string
  /** Third projects-grid meta chip, after sector and structure. */
  cardTag: string
  overview: string[]
  scope: string[]
}

/** Template copy, verbatim from docs/template-projects.json. */
export const PROJECTS_CONTENT: Record<string, ProjectSeed> = {
  'warehouse-newcastle': {
    title: 'Distribution Warehouse',
    loc: 'Newcastle, NSW',
    state: 'NSW',
    sector: 'Industrial',
    structure: 'Large-span warehouse frame',
    img: '24-project-warehouse-newcastle.jpg',
    alt: 'Completed large steel warehouse with multiple roller-door loading bays under a clear sky',
    intro: 'A large-span distribution warehouse for Newcastle — the full structural package fabricated, inspected and shipped door to door from Vietnam.',
    cardSummary:
      'Large-span distribution warehouse — full structural package fabricated, inspected and shipped door to door.',
    cardTag: 'Door-to-door delivery',
    overview: [
      'Distribution warehouses live or die on clear spans and erection speed. For this Newcastle project, the complete structural package — primary frame, secondary steel and connections — was modelled in Tekla by our Ho Chi Minh City drafting office, then fabricated in a Vietnamese factory matched to the project tonnage.',
      'Our own QC inspectors followed the work through the workshop, and the steel was packed, containerised and shipped door to door, arriving on site ready to erect with its full QA documentation pack.',
    ],
    scope: [
      'Tekla shop drawings for the full structural package',
      'Primary and secondary steel fabrication',
      'In-process workshop inspection and dimensional checks',
      'Protective packing and optimised container loading',
      'Door-to-door shipping and delivery to the Newcastle site',
    ],
  },
  'feedlot-bega': {
    title: 'Feed Lot',
    loc: 'Bega, NSW',
    state: 'NSW',
    sector: 'Agricultural',
    structure: 'Agricultural feed lot structure',
    img: '25-project-feedlot-bega.jpg',
    alt: 'Crane lifting a roof truss into place over the steel frame of a large agricultural feed lot building',
    intro: 'An agricultural feed lot structure for the Bega Valley — connections trial-assembled in the factory so erection on a working rural site went straight up.',
    cardSummary:
      'Agricultural feed lot structure, erected on site in the Bega Valley with trial-assembled connections.',
    cardTag: 'Trial assembly',
    overview: [
      'Agricultural structures are erected fast, often far from fabrication support — there is no room for connections that do not fit. This feed lot structure for Bega was fabricated in Vietnam with trial assembly of its connections before shipping, proving the fit in the factory rather than on site.',
      'The erected result in the Bega Valley shows the frame standing as modelled: roof trusses lifted straight into place over the completed steelwork.',
    ],
    scope: [
      'Structural steel fabrication for the feed lot frame and roof',
      'Trial assembly of connections at the factory',
      'Welding to AS/NZS 1554.1 with qualified welders',
      'Full QA documentation pack',
      'Door-to-door delivery to the Bega Valley site',
    ],
  },
  'manufacturing-sa': {
    title: 'Manufacturing Facility',
    loc: 'South Australia',
    state: 'SA',
    sector: 'Industrial',
    structure: 'Heavy industrial plant frame',
    img: '26-project-manufacturing-sa.jpg',
    alt: 'Two cranes erecting the white steel frame of a manufacturing facility against a blue sky',
    intro: 'A heavy industrial frame for a South Australian manufacturing plant — fabricated to AS/NZS standards and delivered ready to erect.',
    cardSummary:
      'Heavy industrial frame for a manufacturing plant — fabricated to AS/NZS standards and delivered ready to erect.',
    cardTag: 'AS/NZS 1554.1 welding',
    overview: [
      'Manufacturing plants carry heavier loads, tighter interfaces with equipment and less tolerance for rework than standard sheds. This South Australian frame was fabricated to AS/NZS standards under our inspection regime, with dimensional and weld visual checks against the Tekla model before dispatch.',
      'Delivered ready to erect, the frame went up under two cranes exactly as drawn — the outcome the inspection process is designed to guarantee.',
    ],
    scope: [
      'Heavy industrial frame fabrication',
      'Tekla shop drawings and connection detailing',
      'Dimensional and weld visual inspection reports',
      'Surface treatment inspection before dispatch',
      'Door-to-door delivery, erection-ready',
    ],
  },
  'church-esperance': {
    title: 'Church',
    loc: 'Esperance, WA',
    state: 'WA',
    sector: 'Community',
    structure: 'Exposed architectural steel, long-span trusses',
    img: '27-project-church-esperance.jpg',
    alt: 'A modern A-frame church building with exposed steel trusses and a tall glazed gable',
    intro: 'Architectural steel for a community church in Esperance — long spans and exposed structure, fabricated in Vietnam and shipped across the country to WA.',
    cardSummary:
      'Architectural steel for a community church — long spans and exposed structure, shipped across the country to WA.',
    cardTag: 'Long-span trusses',
    overview: [
      'When the structure is the architecture, every member is on display. This Esperance church uses exposed steel trusses and a tall glazed gable, so finish quality and connection detailing mattered as much as strength.',
      'The steel was fabricated and finish-inspected in Vietnam, then shipped across the country to Western Australia — proof that distance is no barrier when the QA system travels with the steel.',
    ],
    scope: [
      'Architectural exposed-steel fabrication',
      'Long-span truss fabrication and detailing',
      'Surface and finish inspection',
      'Protective packing for long-distance shipping',
      'Delivery to site in Esperance, WA',
    ],
  },
  'warehouse-brisbane': {
    title: 'Warehouse & Super Awning',
    loc: 'Brisbane, QLD',
    state: 'QLD',
    sector: 'Industrial',
    structure: 'Warehouse frame with oversized awning',
    img: '28-project-warehouse-brisbane.jpg',
    alt: 'Completed industrial building with loading docks and a covered canopy area',
    intro: 'A Brisbane warehouse with an oversized super awning — one fabrication package, one shipment, one erection program.',
    cardSummary:
      'Warehouse structure with an oversized super awning — one fabrication package, one shipment, one erection program.',
    cardTag: 'Single shipment',
    overview: [
      'Combining the warehouse frame and its oversized super awning into a single fabrication package kept this Brisbane project simple: one Tekla model, one factory, one shipment and one erection program.',
      'Loading docks and the covered canopy area were delivered as part of the same inspected package, with the complete QA documentation set handed over on delivery.',
    ],
    scope: [
      'Warehouse frame and super awning in one package',
      'Tekla shop drawings across both structures',
      'Workshop inspection and QA documentation',
      'Single-shipment packing and logistics',
      'Door-to-door delivery to Brisbane',
    ],
  },
  'industrial-newcastle': {
    title: 'Industrial Building',
    loc: 'Newcastle, NSW',
    state: 'NSW',
    sector: 'Industrial',
    structure: 'Multi-bay industrial frame',
    img: '29-project-industrial-newcastle.jpg',
    alt: 'Aerial view of a very large multi-bay industrial steel frame under construction',
    intro: 'A multi-bay industrial building in Newcastle at full erection — the repeatable scale our partner factories are set up for, bay after bay.',
    cardSummary:
      'Multi-bay industrial building at full erection — the scale our partner factories are set up to repeat, bay after bay.',
    cardTag: 'Repeatable bays',
    overview: [
      'Large multi-bay industrial buildings reward a fabrication partner set up for repetition: identical bays, modelled once in Tekla and produced consistently across a long run of steel.',
      'This Newcastle building, photographed from the air at full erection, shows that scale — bay after bay standing true, delivered through the same inspected, door-to-door process as every Smart Solutions Australia project.',
    ],
    scope: [
      'Multi-bay industrial frame fabrication',
      'Repeatable bay production from a single Tekla model',
      'Staged inspection across the production run',
      'Programmed packing and shipping in erection sequence',
      'Door-to-door delivery to Newcastle',
    ],
  },
}

export type TeamMemberSeed = {
  name: string
  role: string
  bio: string
  initials: string
  photoFilename: string
  photoAlt: string
  order: number
}

export const TEAM_CONTENT: TeamMemberSeed[] = [
  {
    name: 'John Walker',
    role: 'Founding Director',
    bio: "Decades of experience in the steel construction industry, widely respected in both Australia and Vietnam. John first identified Vietnam's steel potential in 2004, relocated his design office to Ho Chi Minh City, and has split his time between the two countries ever since.",
    initials: 'JW',
    photoFilename: '04-smart-solutions-australia-leadership-in.jpg',
    photoAlt:
      'Smart Solutions Australia leadership in hi-vis and hard hats standing in front of a steel frame during a trial assembly in Vietnam',
    order: 0,
  },
  {
    name: 'Quynh Pham',
    role: 'Manager — Vietnam',
    bio: 'A project executive with nearly a decade managing projects across Australia, Japan, Thailand, the Philippines, Singapore and Germany. Quynh works one-on-one with clients from our Ho Chi Minh City office — dedication, responsibility and professionalism on every job.',
    initials: 'QP',
    photoFilename: '17-two-engineers-in-hard-hats-and-hi-vis-re.jpg',
    photoAlt:
      'Two engineers in hard hats and hi-vis reviewing drawings in front of an erected steel frame',
    order: 1,
  },
  {
    name: 'Lionel Trotman',
    role: 'Design & Compliance',
    bio: 'Over 20 years in building design and compliance across residential, commercial and industrial construction, directly involved in more than 2,000 delivered projects. Formally qualified in Project Management and Building & Construction (Management).',
    initials: 'LT',
    photoFilename: '16-portrait-of-lionel-trotman-standing-in-f.jpg',
    photoAlt: 'Portrait of Lionel Trotman standing in front of a port with a cargo ship behind him',
    order: 2,
  },
]

export type ProductGroupSeed = {
  title: string
  eyebrow: string
  description: string
  items: { name: string }[]
  order: number
}

export const PRODUCT_GROUPS_CONTENT: ProductGroupSeed[] = [
  {
    title: 'Structural & Architectural',
    eyebrow: '',
    description:
      'Building products fabricated, finished and packed with the same QA as our primary structures.',
    items: [
      { name: 'Structural Steel' },
      { name: 'Bollards' },
      { name: 'Stair Treads & Staircases' },
      { name: 'Steel Barriers' },
      { name: 'Powder-Coated Louvres' },
      { name: 'Aluminium Louvres' },
      { name: 'Grid Mesh Flooring' },
      { name: 'Weld Mesh' },
      { name: 'Steel Plate Dowels' },
    ],
    order: 0,
  },
  {
    title: 'Telecom & Energy',
    eyebrow: '',
    description:
      "Delivered with Vietnam's largest steel manufacturer as our partner — large-scale telecommunications and energy projects, worldwide.",
    items: [
      { name: 'Substation Steel Poles' },
      { name: 'Telecommunication Poles' },
      { name: 'Monopole Towers' },
      { name: 'Guyed Antenna Towers' },
      { name: 'Transmission Line Poles' },
      { name: 'Renewable Energy Poles' },
      { name: 'Drone-Delivery Pole Systems' },
      { name: 'Scaffolding & Galvanised Steel' },
    ],
    order: 1,
  },
]

export type OfficeSeed = {
  name: string
  countryCode: 'AU' | 'VN'
  role: string
  addressLines: string[]
  phone: string
  email: string
  hours: { label: string; value: string }[]
  lat?: number
  lng?: number
  directionsUrl?: string
  order: number
}

export const OFFICES_CONTENT: OfficeSeed[] = [
  {
    name: 'Sydney',
    countryCode: 'AU',
    role: 'Australian Head Office',
    addressLines: ['Level 29, 66 Goulburn St', 'Sydney NSW 2000, Australia'],
    phone: '+61 412 239 259',
    email: 'info@smartsolutionsaustralia.com.au',
    hours: [
      { label: 'Office Hours (AEST)', value: 'Monday – Friday 8:30 am – 5:30 pm' },
      { label: 'Saturday', value: 'By appointment' },
      { label: 'Sunday', value: 'Closed' },
    ],
    lat: -33.8688,
    lng: 151.2093,
    directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=-33.8688,151.2093',
    order: 0,
  },
  {
    name: 'Western Australia',
    countryCode: 'AU',
    role: 'WA Enquiries',
    addressLines: ['Servicing projects across', 'Western Australia'],
    phone: '+61 427 710 479',
    email: 'info@smartsolutionsaustralia.com.au',
    hours: [
      { label: 'Availability (AWST)', value: 'Monday – Friday 8:30 am – 5:30 pm' },
      { label: 'Site meetings', value: 'By appointment' },
    ],
    order: 1,
  },
  {
    name: 'Ho Chi Minh City',
    countryCode: 'VN',
    role: 'Vietnam Office & Drafting',
    addressLines: [
      'Sinh Uc Building, Floor 3A',
      '135/24–26 Nguyen Huu Canh St, Binh Thanh Dist',
      'Ho Chi Minh City, Vietnam',
    ],
    phone: '+84 908 275 404',
    email: 'info@smartsolutionsaustralia.com.au',
    hours: [
      { label: 'Office Hours (ICT)', value: 'Monday – Friday 8:30 am – 5:30 pm' },
      { label: 'Saturday', value: 'By appointment' },
      { label: 'Sunday', value: 'Closed' },
    ],
    lat: 10.79706,
    lng: 106.71816,
    directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=10.79706,106.71816',
    order: 2,
  },
]

export type CapabilitiesContent = {
  meta: { title: string; description: string }
  hero: {
    eyebrow: string
    title: string
    lede: string
  }
  intro: {
    eyebrow: string
    title: string
    body: string
  }
  capabilities: {
    title: string
    body: string
    features: { text: string }[]
    imageFilename?: string
    imageAlt?: string
  }[]
}

/**
 * Capabilities page copy, verbatim from docs/template-content.md
 * (`## View: capabilities`).
 *
 * The template renders the page's descriptive sentence as the hero lede under an
 * h1 of "Capabilities". The brief's test pins the h1 to "One accountable partner",
 * so the sentence is split at its em dash: the first clause is the hero title and
 * the second clause the lede. Every word is preserved.
 *
 * The template's page hero is a breadcrumb ("Home / Capabilities"); that is a
 * navigation affordance rather than page copy, so the hero eyebrow carries the
 * page label instead.
 */
export const CAPABILITIES_CONTENT: CapabilitiesContent = {
  meta: {
    title: 'Capabilities',
    description:
      'Steel fabrication, structural design, Tekla shop drawings, workshop inspection, trial assembly and door-to-door logistics — one accountable partner from concept to site delivery.',
  },
  hero: {
    eyebrow: 'Capabilities',
    title: 'One accountable partner from concept to site delivery',
    lede: 'Fabrication, design, shop drawings, inspection, trial assembly and logistics under a single contract.',
  },
  intro: {
    eyebrow: 'What We Offer',
    title: 'One partner, from concept to site delivery',
    body: 'Send us finished structural drawings, or just a concept — either way, a single accountable team carries your steel from design through fabrication, inspection and shipping.',
  },
  capabilities: [
    {
      title: 'Steel Fabrication',
      body: 'All steel is fabricated in Vietnam in modern factories compliant with local labour laws, using the latest manufacturing machinery and techniques — beam lines, tube and H-beam laser cutting, and automatic welding.',
      features: [
        { text: 'Full QA / QC through the entire fabrication process' },
        { text: 'Welders qualified to AS/NZS 1554.1, EN ISO 15614-1 and AWS D1.1' },
        { text: 'Projects from 20 tonnes to 10,000 tonnes of structural steel' },
        { text: 'The right fabricator selected for each project from our vetted partner network' },
      ],
      imageFilename: '06-inside-a-large-modern-fabrication-worksh.jpg',
      imageAlt:
        'Inside a large modern fabrication workshop: stacked structural I-beams in the foreground and a welder at work on a steel member',
    },
    {
      title: 'Structural Steel Design',
      body: 'We fabricate to your structural design — or provide a complete structural design from your concept drawings, using certified Australian engineers.',
      features: [],
    },
    {
      title: 'Detailed Shop Drawings',
      body: 'Our highly skilled Vietnamese drafting office produces detailed shop drawings in Tekla — the model the factory builds from, checked before a single cut is made.',
      features: [],
      imageFilename: '07-the-smart-solutions-australia-drafting-o.jpg',
      imageAlt:
        'The Smart Solutions Australia drafting office in Ho Chi Minh City, with detailers modelling a steel structure on screen',
    },
    {
      title: 'Workshop Inspection',
      body: 'Our own QC inspectors are in the workshop protecting structural integrity and specification compliance — preventing the costly rework and delays that happen when nobody is watching.',
      features: [],
    },
    {
      title: 'Trial Assembly',
      body: 'For complex or large-scale structures we propose trial assembly at the factory — proving every connection fits before shipping, and cutting your on-site erection time.',
      features: [],
    },
    {
      title: 'Shipping & Logistics',
      body: 'A true door-to-door service: engineered packing, optimised container loading, freight and all paperwork — from our factory floor in Vietnam to your site in Australia.',
      features: [],
    },
    {
      title: 'Exceptional Customer Service',
      body: 'Progress reports, connection reviews and direct discussion at every stage. Long-term relationships are our business model — you always know where your steel is.',
      features: [],
    },
  ],
}

export type ProcessContent = {
  meta: { title: string; description: string }
  hero: {
    eyebrow: string
    title: string
    lede: string
  }
  intro: {
    eyebrow: string
    title: string
    body: string
  }
  steps: { title: string; body: string }[]
  cta: {
    primaryLabel: string
    primaryHref: string
    secondaryLabel: string
    secondaryHref: string
  }
}

/**
 * Process page copy, verbatim from docs/template-content.md (`## View: process`).
 *
 * The template's page hero is a breadcrumb ("Home / Process"); as on the
 * capabilities page the hero eyebrow carries the page label instead, because a
 * breadcrumb is a navigation affordance rather than page copy.
 */
export const PROCESS_CONTENT: ProcessContent = {
  meta: {
    title: 'Our Process',
    description:
      'Offshore fabrication without the unknowns — five documented, inspected and reported steps carry your steel from first drawings to erection-ready delivery.',
  },
  hero: {
    eyebrow: 'Process',
    title: 'Our Process',
    lede: 'Offshore fabrication without the unknowns. Five documented, inspected and reported steps carry your steel from first drawings to erection-ready delivery.',
  },
  intro: {
    eyebrow: 'How It Works',
    title: 'Five steps. No unknowns.',
    body: 'The risk in offshore fabrication is the unknown. Our process is built to remove it — every step is documented, inspected and reported back to you.',
  },
  steps: [
    {
      title: 'Design & Engineering',
      body: 'Your drawings, or a full structural design from concept by certified Australian engineers.',
    },
    {
      title: 'Tekla Shop Drawings',
      body: 'Detailed shop drawings modelled in Tekla and issued for your review before fabrication starts.',
    },
    {
      title: 'Fabrication',
      body: 'Manufacture in a modern Vietnamese factory matched to your tonnage, with our team on site.',
    },
    {
      title: 'Inspection & QA',
      body: 'In-process QC, trial assembly where needed, and independent third-party inspection on request.',
    },
    {
      title: 'Door-to-Door Delivery',
      body: 'Protective packing, optimised loading, shipping and paperwork — delivered to your site, ready to erect.',
    },
  ],
  cta: {
    primaryLabel: 'Start Step 1 — Request a Quote',
    primaryHref: '/quote',
    secondaryLabel: 'See the QA Documentation',
    secondaryHref: '/quality',
  },
}

export type QualityContent = {
  meta: { title: string; description: string }
  hero: {
    eyebrow: string
    title: string
    lede: string
  }
  imageFilename: string
  imageAlt: string
  imageCaption: string
  intro: {
    eyebrow: string
    title: string
    body: string
  }
  qaItems: { title: string; description: string }[]
  managementSystems: {
    title: string
    body: string
  }
}

/**
 * Quality page copy, verbatim from docs/template-content.md
 * (`## View: quality`).
 *
 * The template's page hero is a breadcrumb ("Home / Quality"); as on the other
 * inner pages the hero eyebrow carries the page label instead, because a
 * breadcrumb is a navigation affordance rather than page copy. The hero h1 and
 * the section heading eyebrow both read "Compliance & Quality" in the template,
 * and both are kept as written.
 */
export const QUALITY_CONTENT: QualityContent = {
  meta: {
    title: 'Compliance & Quality',
    description:
      'Every shipment is backed by a complete, auditable QA pack — inspection plans, welding records, mill certificates and CC3 traceability.',
  },
  hero: {
    eyebrow: 'Quality',
    title: 'Compliance & Quality',
    lede: 'Every shipment is backed by a complete, auditable QA pack — inspection plans, welding records, mill certificates and CC3 traceability, available for your project records.',
  },
  imageFilename: '08-close-up-of-a-bolted-structural-steel-co.jpg',
  imageAlt:
    'Close-up of a bolted structural steel connection, fabricated and finished to Australian standards',
  imageCaption:
    'Bolted connections finished to specification — the detail your erectors will thank you for.',
  intro: {
    eyebrow: 'Compliance & Quality',
    title: 'Documented proof, not promises',
    body: 'Every Smart Solutions Australia product is fully compliant with Australian standards, with a complete QA pack available for your project. Raw materials are tested in an ILAC-certified laboratory, and welders are certified by SGS to ISO 9606-1.',
  },
  qaItems: [
    {
      title: 'Inspection Test Plan (ITP)',
      description: 'Hold points witnessed through fabrication',
    },
    {
      title: 'WPS, PQR & WPR',
      description: 'Welding procedure and performance records',
    },
    {
      title: 'Mill Certificates & Test Reports',
      description: 'Full material certification for every heat',
    },
    {
      title: 'Material Traceability Report',
      description: 'CC3 traceability, Steelwork Compliance Australia',
    },
    {
      title: 'Dimensional & Weld Visual Reports',
      description: 'Checked against the Tekla model and drawings',
    },
    {
      title: 'Surface & Painting Inspection',
      description: 'Including hot-dip galvanising to AS/NZS 4680',
    },
    {
      title: 'NDT & Production Test Reports',
      description: 'Available where your specification requires them',
    },
    {
      title: 'Independent Third-Party Inspection',
      description: 'SGS, TUV and others arranged on request',
    },
  ],
  managementSystems: {
    title: 'Management systems:',
    body: 'ISO 9001:2015 quality, ISO 14001:2015 environmental and ISO 45001:2018 occupational health & safety — applied across our offices and partner factories, with a published Modern Slavery Policy aligned to the Modern Slavery Act 2018 (Cth).',
  },
}

export type ProjectsPageContent = {
  meta: { title: string; description: string }
  hero: {
    eyebrow: string
    title: string
    lede: string
    primaryLabel: string
    primaryHref: string
    secondaryLabel: string
    secondaryHref: string
    intro: {
      eyebrow: string
      title: string
      body: string
    }
  }
  note: {
    title: string
    body: string
    linkLabel: string
    linkHref: string
  }
}

/**
 * Projects page copy, verbatim from docs/template-content.md
 * (`## View: projects`).
 *
 * The template's page hero is a breadcrumb ("Home / Projects"); as on the other
 * inner pages the hero eyebrow carries the page label instead. The closing note
 * ends in a link, so its final clause is stored as `linkLabel` and the body
 * keeps the sentence up to the em dash.
 */
export const PROJECTS_PAGE_CONTENT: ProjectsPageContent = {
  meta: {
    title: 'Projects',
    description:
      'Selected projects delivered by Smart Solutions Australia — fabricated in Vietnam, inspected under our QA system, and erected on sites across Australia.',
  },
  hero: {
    eyebrow: 'Projects',
    title: 'Projects',
    lede: 'Selected projects delivered by Smart Solutions Australia — fabricated in Vietnam, inspected under our QA system, and erected on sites from Bega to Esperance and as far as Papua New Guinea. Open any project for its full story: scope, delivery stages and documentation.',
    primaryLabel: 'Start Your Project',
    primaryHref: '/quote',
    secondaryLabel: 'Talk to Our Team',
    secondaryHref: '/contact',
    intro: {
      eyebrow: 'Selected Projects',
      title: 'Steel standing across Australia',
      body: 'A selection from the work our team has delivered. Every project below followed the same route: Tekla shop drawings, fabrication in a matched Vietnamese factory, in-process inspection, and door-to-door delivery with a full QA pack.',
    },
  },
  note: {
    title: 'Selected projects, shown in depth.',
    body: 'This page presents a selection of delivered work in detail rather than a long list of names. Project references, tonnage records and QA documentation for comparable work are available on request —',
    linkLabel: 'contact the Sydney office',
    linkHref: '/contact',
  },
}

export type ProjectDetailSettingsContent = {
  stagesIntro: string
  stages: { title: string; text: string; imageFilename: string; imageAlt: string }[]
  qaIntro: string
  qaDocs: string[]
  facts: { label: string; value: string }[]
  priceCta: string
  contactPromptLead: string
  contactPromptLabel: string
}

/**
 * Project detail template copy, verbatim from `renderProject()` in
 * docs/Smart Solutions Australia Website.html. Every project page reuses these
 * three stages, the six-document QA pack and the three delivery facts; only
 * Location, Sector and Structure come from the project document.
 */
export const PROJECT_DETAIL_CONTENT: ProjectDetailSettingsContent = {
  stagesIntro:
    'The same three stages carry every Smart Solutions Australia project from model to site:',
  stages: [
    {
      title: '1 · Tekla shop drawings',
      text: 'Every member modelled and checked in Tekla before a single cut is made.',
      imageFilename: '21-detailers-modelling-a-steel-structure-in.jpg',
      imageAlt:
        'Detailers modelling a steel structure in Tekla in the Ho Chi Minh City drafting office',
    },
    {
      title: '2 · Fabrication & inspection',
      text: 'Fabricated in a Vietnamese factory matched to the tonnage, with our QC inspectors in the workshop.',
      imageFilename: '22-inside-a-fabrication-workshop-with-stack.jpg',
      imageAlt:
        'Inside a fabrication workshop with stacked structural beams and a welder at work',
    },
    {
      title: '3 · Connections checked',
      text: 'Bolted connections and finishes verified against the model and drawings before packing.',
      imageFilename: '23-close-up-of-a-bolted-structural-steel-co.jpg',
      imageAlt: 'Close-up of a bolted structural steel connection finished to specification',
    },
  ],
  qaIntro:
    'This project was delivered with the standard Smart Solutions Australia QA pack:',
  qaDocs: [
    'Inspection Test Plan (ITP)',
    'WPS / PQR / WPR',
    'Mill certificates & test reports',
    'CC3 material traceability report',
    'Dimensional & weld visual reports',
    'Surface treatment & painting inspection',
  ],
  facts: [
    { label: 'Fabrication', value: 'Vietnam — partner factory matched to project size' },
    { label: 'Standards', value: 'Welding to AS/NZS 1554.1 · CC3 traceability' },
    { label: 'Delivery', value: 'Door to door — factory to site, paperwork included' },
  ],
  priceCta: 'Price a Similar Project',
  contactPromptLead: 'Questions about this project?',
  contactPromptLabel: 'Contact the team',
}

export type ProductsPageContent = {
  meta: { title: string; description: string }
  hero: {
    eyebrow: string
    title: string
    lede: string
  }
  intro: {
    eyebrow: string
    title: string
    body: string
  }
  partnerNote: {
    title: string
    body: string
  }
}

/**
 * Products page copy, verbatim from docs/template-content.md
 * (`## View: products`).
 *
 * The template's page hero is a breadcrumb ("Home / Products"); as on the other
 * inner pages the hero eyebrow carries the page label instead. The template has
 * no closing note below the product groups, so `partnerNote` is empty — the page
 * omits the block until an editor fills it in.
 */
export const PRODUCTS_PAGE_CONTENT: ProductsPageContent = {
  meta: {
    title: 'Products',
    description:
      'Any steel or aluminium product, fabricated and finished to your specification — supplied on its own, or as part of a full structural package.',
  },
  hero: {
    eyebrow: 'Products',
    title: 'Products',
    lede: 'Any steel or aluminium product, fabricated and finished to your specification — supplied on its own, or as part of a full structural package.',
  },
  intro: {
    eyebrow: 'Our Products',
    title: 'Beyond the frame',
    body: 'We can supply any steel and aluminium product to your requirements. These are the lines our clients order most.',
  },
  partnerNote: {
    title: '',
    body: '',
  },
}

export type TeamPageContent = {
  meta: { title: string; description: string }
  hero: {
    eyebrow: string
    title: string
    lede: string
    primaryLabel: string
    primaryHref: string
  }
  intro: {
    eyebrow: string
    title: string
    body: string
  }
  quote: {
    text: string
    attribution: string
    imageFilename: string
    imageAlt: string
  }
}

/**
 * Team page copy, verbatim from docs/template-content.md (`## View: team`).
 *
 * The template's page hero is a breadcrumb ("Home / Team"); as on the other
 * inner pages the hero eyebrow carries the page label instead. The closing band
 * is a captioned wide photo rather than a pull quote, so `quote.text` carries
 * the template's caption and `attribution` (no template equivalent) stays empty.
 */
export const TEAM_PAGE_CONTENT: TeamPageContent = {
  meta: {
    title: 'Our Team',
    description:
      'The people behind your steel — leadership in Sydney, project management and inspection on the ground in Vietnam, and design & compliance backed by 2,000+ delivered projects.',
  },
  hero: {
    eyebrow: 'Team',
    title: 'Our Team',
    lede: 'The people behind your steel — leadership in Sydney, project management and inspection on the ground in Vietnam, and design & compliance backed by 2,000+ delivered projects.',
    primaryLabel: 'Contact the Team',
    primaryHref: '/contact',
  },
  intro: {
    eyebrow: 'Experts in the Industry',
    title: 'The people behind your steel',
    body: 'A small, senior team — you deal with the decision-makers in Sydney and the people standing in the factory in Vietnam.',
  },
  quote: {
    text: 'From our drafting office in Ho Chi Minh City to erection on your site — one team follows your steel the whole way.',
    attribution: '',
    imageFilename: '17-two-engineers-in-hard-hats-and-hi-vis-re.jpg',
    imageAlt:
      'Two engineers in hard hats and hi-vis reviewing drawings in front of an erected steel frame',
  },
}

export type QuotePageContent = {
  meta: { title: string; description: string }
  hero: {
    eyebrow: string
    title: string
    lede: string
  }
  stepsIntro: {
    eyebrow: string
    title: string
  }
  steps: { title: string; body: string }[]
  tool: {
    title: string
    body: string
    label: string
    href: string
  }
  fallback: {
    lead: string
    phoneAU: string
    phoneVN: string
  }
  form: {
    title: string
    intro: string
    formNote: string
    consentLabel: string
    consentHref: string
    successHeading: string
    successBody: string
  }
  projectTypes: string[]
  tonnageOptions: string[]
}

/**
 * Quote page copy, from docs/template-content.md (`## View: quote`).
 *
 * The hero eyebrow carries the page label, as on the other inner pages (the
 * template uses a breadcrumb). The template's form note and its "your email app
 * should now open" message describe the old mailto flow; the site now stores the
 * request and notifies the office itself, so `formNote`, `successHeading` and
 * `successBody` carry equivalent copy for the real behaviour. `successHeading`
 * must start with "Thank you" (pinned by the e2e test).
 */
export const QUOTE_PAGE_CONTENT: QuotePageContent = {
  meta: {
    title: 'Request a Quote',
    description:
      'One detailed, door-to-door price — fabrication, QA documentation, packing, freight and delivery to your site. Send drawings, or just a concept.',
  },
  hero: {
    eyebrow: 'Request a Quote',
    title: 'Request a Quote',
    lede: 'One detailed, door-to-door price — fabrication, QA documentation, packing, freight and delivery to your site. Send drawings, or just a concept.',
  },
  stepsIntro: {
    eyebrow: 'Request a Quote',
    title: 'Price your next project in three steps',
  },
  steps: [
    {
      title: 'Send drawings — or just a concept',
      body: "Structural drawings if you have them; sketches, dimensions and site details if you don't. Our engineers can develop the full design.",
    },
    {
      title: 'We review & engineer',
      body: 'We check the design for fabrication, match your tonnage to the right Vietnamese factory, and confirm compliance with Australian standards.',
    },
    {
      title: 'Receive one door-to-door price',
      body: 'A single detailed quote covering fabrication, QA documentation, packing, freight and delivery to your site — no surprise add-ons.',
    },
  ],
  tool: {
    title: 'Prefer to design & price it online?',
    body: 'Our online design & quote tool lets you configure your building and get a guide price instantly. This button is reserved for that tool.',
    label: 'Launch Online Quote Tool — Link Coming Soon',
    // The template's placeholder target keeps the button visible but disabled
    // (only an http(s) URL in the global activates it).
    href: '#quote-form',
  },
  fallback: {
    lead: 'Talk to a person instead:',
    phoneAU: '+61 412 239 259',
    phoneVN: '+84 908 275 404',
  },
  form: {
    title: 'Request a Quote',
    intro: "Tell us about the project — we'll come back with next steps and a detailed door-to-door price.",
    formNote:
      "Your request goes straight to the team that prices the work — we'll come back with next steps and a detailed door-to-door price. Drawings can follow by email to info@smartsolutionsaustralia.com.au.",
    consentLabel: 'I consent to the Privacy Policy',
    consentHref: '/privacy',
    successHeading: 'Thank you — your request is with us.',
    successBody:
      "We'll come back with next steps and a detailed door-to-door price. If you'd rather speak now, email info@smartsolutionsaustralia.com.au or call +61 412 239 259.",
  },
  projectTypes: [
    'Warehouse / Industrial',
    'Agricultural (shed, feed lot)',
    'Commercial',
    'Community / Church',
    'Telecom / Energy',
    'Steel products only',
    'Other',
  ],
  tonnageOptions: [
    'Not sure yet',
    'Under 20 t',
    '20 – 100 t',
    '100 – 500 t',
    '500 – 2,000 t',
    '2,000 – 10,000 t',
  ],
}

export type ContactPageContent = {
  meta: { title: string; description: string }
  hero: {
    eyebrow: string
    title: string
    lede: string
  }
  intro: {
    eyebrow: string
    title: string
    body: string
    linkLabel: string
    linkHref: string
  }
  quickLinks: { label: string; value: string; href: string; body: string }[]
  whatsNextIntro: { eyebrow: string; title: string }
  whatsNext: { title: string; body: string }[]
  quotePrompt: { title: string; body: string; label: string; href: string }
  formTitle: string
  formIntro: string
  formNote: string
  consentLabel: string
  consentHref: string
  successHeading: string
  successBody: string
  enquiryTypes: string[]
}

/**
 * Contact page copy, verbatim from docs/template-content.md
 * (`## View: contact`).
 *
 * Deviations, all forced by the site's real behaviour:
 * - The template's hero is a breadcrumb ("Home / Contact"); the eyebrow carries
 *   the page label instead, as on every other inner page.
 * - The template's third "what happens next" step and its form note describe a
 *   mailto flow ("the form opens your email app"). This site stores the message
 *   and notifies the office itself, so those three strings carry the equivalent
 *   copy. Everything else — hero, intro, quick cards, step headings, office
 *   copy, form fields and options — is verbatim.
 * - `successHeading` starts with "Thank you" (pinned by the e2e test).
 */
export const CONTACT_PAGE_CONTENT: ContactPageContent = {
  meta: {
    title: 'Contact Us',
    description:
      'Two offices, one team — plus a dedicated Western Australia enquiry line. Call, email, visit, or send the form and the right office will come back to you.',
  },
  hero: {
    eyebrow: 'Contact',
    title: 'Contact Us',
    lede: 'Two offices, one team — plus a dedicated Western Australia enquiry line. Call, email, visit, or send the form and the right office will come back to you.',
  },
  intro: {
    eyebrow: 'Get in Touch',
    title: 'Talk to the office closest to your project',
    body: 'For a priced project, the fastest route is the Request a Quote page. For everything else — partnerships, product enquiries, compliance documents — start here.',
    linkLabel: 'Request a Quote page',
    linkHref: '/quote',
  },
  quickLinks: [
    {
      label: 'Call — Australia',
      value: '+61 412 239 259',
      href: 'tel:+61412239259',
      body: 'Sydney head office — quotes, projects & delivery',
    },
    {
      label: 'Call — Vietnam',
      value: '+84 908 275 404',
      href: 'tel:+84908275404',
      body: 'Ho Chi Minh City office — drafting, QA & factory coordination',
    },
    {
      label: 'Email',
      value: 'info@smartsolutionsaustralia.com.au',
      href: 'mailto:info@smartsolutionsaustralia.com.au',
      body: 'Drawings, specifications and general enquiries',
    },
  ],
  whatsNextIntro: {
    eyebrow: 'Send a Message',
    title: 'What happens next',
  },
  whatsNext: [
    {
      title: 'Your message lands with the right office',
      body: 'Choose Sydney, Western Australia or Ho Chi Minh City in the form — your email is addressed and labelled for that team.',
    },
    {
      title: 'A person replies',
      body: 'You deal with the decision-makers — the same senior team named on our Team page, not a call centre.',
    },
    {
      title: 'Drawings? Send them with your message',
      body: 'Attach structural drawings or a concept sketch in your reply, or email them to info@smartsolutionsaustralia.com.au — your message is already labelled with the right office.',
    },
  ],
  quotePrompt: {
    title: 'Pricing a project instead?',
    body: 'Use the dedicated quote form — it captures tonnage, site location and project type so we can price properly.',
    label: 'Go to Request a Quote',
    href: '/quote',
  },
  formTitle: 'Contact Form',
  formIntro: 'Send a general enquiry — quotes are faster via the Request a Quote page.',
  formNote:
    'Your message goes straight to the office you choose. If you would rather write directly, email info@smartsolutionsaustralia.com.au.',
  consentLabel: 'I consent to the Privacy Policy',
  consentHref: '/privacy',
  successHeading: 'Thank you — your message is with us.',
  successBody:
    "The right office will come back to you shortly. If you'd rather speak now, email info@smartsolutionsaustralia.com.au or call +61 412 239 259.",
  enquiryTypes: [
    'General enquiry',
    'Project / partnership',
    'Steel products',
    'Compliance documents',
    'Careers',
    'Other',
  ],
}

export type PrivacyPageContent = {
  lastUpdated: string
  meta: { title: string; description: string }
  blocks: PrivacyBlock[]
}

/** One block of the policy body, in the order Appendix A prints it. */
export type PrivacyBlock =
  | { type: 'h2'; text: string }
  | { type: 'p'; text: string }
  /** Consecutive lines of one address block (rendered with <br> between them). */
  | { type: 'lines'; lines: string[] }
  | { type: 'ul'; items: string[] }

/**
 * Privacy policy copy, verbatim from Appendix A of the design spec
 * (`docs/superpowers/specs/2026-11-18-smart-solutions-website-design.md`).
 *
 * The appendix's leading Vietnamese note is editorial guidance for this project,
 * not policy copy, so the policy itself starts at section 1. Section headings keep
 * their printed numbers; the page derives each section's anchor id from the
 * heading text (see `src/lib/privacy.ts`). The two OAIC contact lines and the
 * section 16 contact block stay as plain text, exactly as written.
 *
 * `lastUpdated` is the date the appendix prints. It is stored at UTC midnight so
 * every reader sees the same day regardless of timezone.
 */
export const PRIVACY_PAGE_CONTENT: PrivacyPageContent = {
  lastUpdated: '2026-11-18T00:00:00.000Z',
  meta: {
    title: 'Privacy Policy',
    description:
      'How Smart Solutions Australia collects, holds, uses, discloses and protects personal information under the Privacy Act 1988 (Cth) and the Australian Privacy Principles.',
  },
  blocks: [
    { type: 'h2', text: '1. Who we are' },
    {
      type: 'p',
      text: 'Smart Solutions Australia ("we", "us", "our") is a structural steel specialist. Our head office is in Sydney, Australia, and our office and drafting team are in Ho Chi Minh City, Vietnam. We provide structural steel design, fabrication, inspection, logistics and door-to-door delivery to sites across Australia.',
    },
    { type: 'h2', text: '2. Scope of this policy' },
    {
      type: 'p',
      text: 'This policy explains how we collect, hold, use, disclose and protect personal information in accordance with the Privacy Act 1988 (Cth) and the Australian Privacy Principles (APPs). It applies to our website, enquiries, quotations, contracts, project communications and any other dealings with us.',
    },
    { type: 'h2', text: '3. What personal information we collect' },
    { type: 'p', text: 'We may collect:' },
    {
      type: 'ul',
      items: [
        'identity and contact details, such as your name, company, role, email address, phone number and office location;',
        'project information, such as project type, tonnage, site location, drawings, specifications, delivery requirements and correspondence about a project;',
        'communications, such as enquiries, quote requests, messages, complaints and records of our responses;',
        'website usage information, such as IP address, browser type, device type, pages visited, time on site, referring page and cookie identifiers;',
        'recruitment information, if you apply for a role with us, including your application, qualifications and work history.',
      ],
    },
    {
      type: 'p',
      text: 'We do not collect sensitive information (such as health or biometric information) unless it is required for a lawful purpose and you have consented, or the law otherwise permits it.',
    },
    { type: 'h2', text: '4. How we collect personal information' },
    { type: 'p', text: 'We collect personal information:' },
    {
      type: 'ul',
      items: [
        'directly from you, when you submit a form on our website, email or call us, meet with us, or enter into a contract with us;',
        'from your representatives, such as architects, engineers, builders and contractors involved in a project;',
        'from public sources, referees or other people you have authorised, where relevant;',
        'automatically through cookies, server logs and similar technologies when you use our website.',
      ],
    },
    {
      type: 'p',
      text: 'If you provide personal information about another person, you must be authorised to do so and ensure that person is aware of this policy.',
    },
    { type: 'h2', text: '5. Why we use personal information' },
    { type: 'p', text: 'We use personal information to:' },
    {
      type: 'ul',
      items: [
        'respond to enquiries and prepare quotations;',
        'provide structural steel design, fabrication, inspection, logistics and related services;',
        'manage contracts, deliveries, invoicing, warranties and project records;',
        'communicate with you about a project and respond to complaints;',
        'improve our website, services and customer experience;',
        'comply with legal, tax, insurance, work health and safety, and record-keeping obligations;',
        'protect against fraud, misuse and security incidents.',
      ],
    },
    {
      type: 'p',
      text: 'If you do not provide information we reasonably require, we may not be able to respond to your enquiry or provide our services.',
    },
    { type: 'h2', text: '6. Cookies and website usage' },
    {
      type: 'p',
      text: 'We use essential cookies to operate our website. We may also use aggregate analytics to understand how the site is used and to improve it. We do not use cookies for third-party advertising.',
    },
    {
      type: 'p',
      text: 'You can block or delete cookies through your browser settings. If you disable cookies, some parts of the website may not work as intended.',
    },
    { type: 'h2', text: '7. Disclosure of personal information' },
    { type: 'p', text: 'We may disclose personal information to:' },
    {
      type: 'ul',
      items: [
        'our related office and drafting team in Vietnam;',
        'fabrication partners, subcontractors and suppliers involved in your project;',
        'freight, logistics, shipping and customs providers;',
        'IT, hosting, email, document management and professional service providers;',
        'our professional advisers, including lawyers, accountants, insurers and auditors;',
        'government authorities, courts and regulators where required or authorised by law;',
        'a buyer or successor in the event of a business sale or restructure.',
      ],
    },
    { type: 'p', text: 'We do not sell or rent personal information.' },
    { type: 'h2', text: '8. Overseas disclosure' },
    {
      type: 'p',
      text: 'Our office and drafting team are located in Vietnam, and some of our service providers may store or process information outside Australia. Where we disclose personal information overseas, we take reasonable steps to ensure the recipient handles it consistently with the APPs, and we rely on your consent where appropriate.',
    },
    {
      type: 'p',
      text: 'Overseas laws may not provide the same level of protection as Australian law. If you have questions about an overseas disclosure, contact our Privacy Officer.',
    },
    { type: 'h2', text: '9. Security of personal information' },
    {
      type: 'p',
      text: 'We take reasonable technical and organisational steps to protect personal information, including access controls, role-based permissions, staff confidentiality obligations, secure storage and destruction or de-identification when information is no longer needed.',
    },
    {
      type: 'p',
      text: 'No method of transmission over the internet or electronic storage is completely secure, and we cannot guarantee absolute security.',
    },
    { type: 'h2', text: '10. Retention' },
    {
      type: 'p',
      text: 'We retain personal information only for as long as it is needed for the purpose for which it was collected, for our contractual and legal obligations (including tax, insurance, work health and safety and project record requirements), or as required by law. When information is no longer required, we destroy or de-identify it within a reasonable period.',
    },
    { type: 'h2', text: '11. Access and correction' },
    {
      type: 'p',
      text: 'You may request access to the personal information we hold about you, or ask us to correct information that is inaccurate, incomplete or out of date, by contacting our Privacy Officer.',
    },
    {
      type: 'p',
      text: 'We will respond within a reasonable period, usually within 30 days. We may refuse access where the law permits us to do so, and we will explain the reason for any refusal.',
    },
    { type: 'h2', text: '12. Direct marketing' },
    {
      type: 'p',
      text: 'We may send you project updates or information about our services where you have consented or where the law permits. You can opt out at any time using the unsubscribe link in a message or by contacting us. We do not sell or rent contact lists.',
    },
    { type: 'h2', text: '13. Complaints' },
    {
      type: 'p',
      text: 'If you believe we have breached the APPs or handled your personal information incorrectly, please contact our Privacy Officer with details of your concern. We will acknowledge your complaint and investigate it, usually within 30 days.',
    },
    {
      type: 'p',
      text: 'If you are not satisfied with our response, you may contact the Office of the Australian Information Commissioner (OAIC):',
    },
    { type: 'ul', items: ['Website: https://www.oaic.gov.au', 'Phone: 1300 363 992'] },
    { type: 'h2', text: '14. Links to other websites' },
    {
      type: 'p',
      text: 'Our website may link to third-party websites. We are not responsible for the privacy practices, content or security of those websites. We encourage you to read their privacy policies.',
    },
    { type: 'h2', text: '15. Changes to this policy' },
    {
      type: 'p',
      text: 'We may update this policy from time to time. The current version is published on this page and the "Last updated" date is revised. Continued use of our website or services after a change means you accept the updated policy.',
    },
    { type: 'h2', text: '16. Contact us' },
    {
      type: 'lines',
      lines: [
        'Privacy Officer',
        'Smart Solutions Australia',
        'Level 29, 66 Goulburn St',
        'Sydney NSW 2000, Australia',
      ],
    },
    {
      type: 'ul',
      items: [
        'Email: info@smartsolutionsaustralia.com.au',
        'Phone: +61 412 239 259 (Australia)',
        'Phone: +84 908 275 404 (Vietnam)',
      ],
    },
  ],
}

const lexicalText = (text: string) => ({ type: 'text' as const, text, version: 1 })

const lexicalElement = (type: 'heading' | 'list' | 'listitem' | 'paragraph', children: unknown[]) => ({
  type,
  children,
  direction: null,
  format: '' as const,
  indent: 0,
  version: 1,
})

/**
 * The privacy policy body as Lexical, in Appendix A's order.
 *
 * Hand-built rather than converted from HTML: these nodes are the exact shape
 * the editor serialises, so the seeded body and any later admin edit round-trip
 * through the same renderer without a converter step in the seed.
 */
export function lexicalPrivacyBody(blocks: PrivacyBlock[]) {
  return {
    root: {
      type: 'root' as const,
      children: blocks.map((block) => {
        switch (block.type) {
          case 'h2':
            return {
              ...lexicalElement('heading', [lexicalText(block.text)]),
              tag: 'h2' as const,
            }
          case 'lines':
            return lexicalElement(
              'paragraph',
              block.lines.flatMap((line, index) => [
                ...(index > 0 ? [{ type: 'linebreak' as const, version: 1 }] : []),
                lexicalText(line),
              ]),
            )
          case 'ul':
            return {
              ...lexicalElement(
                'list',
                block.items.map((item) => lexicalElement('listitem', [lexicalText(item)])),
              ),
              listType: 'bullet' as const,
              tag: 'ul' as const,
              start: 1,
            }
          default:
            return lexicalElement('paragraph', [lexicalText(block.text)])
        }
      }),
      direction: null,
      format: '' as const,
      indent: 0,
      version: 1,
    },
  }
}

/** Canonical Lexical root node for a run of plain paragraphs. */
export function lexicalParagraphs(paragraphs: string[]) {  return {
    root: {
      type: 'root' as const,
      children: paragraphs.map((text) => ({
        type: 'paragraph' as const,
        children: [{ type: 'text' as const, text, version: 1 }],
        direction: null,
        format: '' as const,
        indent: 0,
        version: 1,
      })),
      direction: null,
      format: '' as const,
      indent: 0,
      version: 1,
    },
  }
}

export type HomeContent = {
  meta: { title: string; description: string }
  hero: {
    kicker: string
    title: string
    highlight: string
    lede: string
    primaryLabel: string
    primaryHref: string
    secondaryLabel: string
    secondaryHref: string
    imageFilename: string
    imageAlt: string
  }
  stats: { value: string; suffix?: string; label: string }[]
  certificationsLabel: string
  certifications: { label: string }[]
  officeSplit: {
    eyebrow: string
    title: string
    body: string
    offices: { code: string; title: string; body: string }[]
    imageFilename: string
    imageAlt: string
    captionLead: string
    caption: string
  }
  exploreIntro: {
    eyebrow: string
    title: string
    body: string
  }
  exploreCards: { title: string; body: string; ctaLabel: string; href: string }[]
  featuredSection: {
    eyebrow: string
    ctaLabel: string
  }
}

/**
 * Home page copy, verbatim from docs/template-content.md (`## View: home`).
 *
 * The hero image is a drone photograph of a steel-framed industrial building;
 * the template marks it aria-hidden with an empty alt, so this seed supplies a
 * real description for the meaningful image the design now renders.
 */
export const HOME_CONTENT: HomeContent = {
  meta: {
    title: 'Structural Steel Fabricated in Vietnam',
    description:
      'Smart Solutions Australia pairs two decades on the ground in Vietnam with Australian engineering, inspection and project management — offshore fabrication economics without the offshore risk.',
  },
  hero: {
    kicker: 'Structural Steel Specialists — Est. Vietnam 2004',
    title: 'Australian-standard steel, fabricated in Vietnam, delivered to your site',
    highlight: 'fabricated in Vietnam',
    lede: 'Smart Solutions Australia pairs two decades on the ground in Vietnam with Australian engineering, inspection and project management — so you get offshore fabrication economics without the offshore risk. From 20 tonnes to 10,000 tonnes, door to door.',
    primaryLabel: 'Request a Quote',
    primaryHref: '/quote',
    secondaryLabel: 'See Delivered Projects',
    secondaryHref: '/projects',
    imageFilename: '03-image-03.jpg',
    imageAlt:
      'Aerial view of a large steel-framed industrial building on a cleared site under a blue sky',
  },
  stats: [
    { value: '20', suffix: '+', label: 'Years operating in Vietnam, since 2004' },
    { value: '2,000', suffix: '+', label: 'Projects delivered by our design & compliance lead' },
    { value: '20–10,000 t', label: 'Project size range, matched to the right fabricator' },
    {
      value: 'Door → Door',
      label: 'Factory in Vietnam to your Australian site, paperwork included',
    },
  ],
  certificationsLabel: 'Certified & compliant',
  certifications: [
    { label: 'ISO 9001:2015' },
    { label: 'ISO 14001:2015' },
    { label: 'ISO 45001:2018' },
    { label: 'CC3 Traceability — Steelwork Compliance Australia' },
    { label: 'Welding to AS/NZS 1554.1' },
    { label: 'Galvanising to AS/NZS 4680' },
  ],
  officeSplit: {
    eyebrow: 'The Best of Both Worlds',
    title: 'Australian accountability. Vietnamese manufacturing strength.',
    body: 'Fabricating steel in Vietnam only works when someone you trust is standing in the workshop. Our English-speaking team has done exactly that for 20 years — selecting the right fabricator for each project, inspecting work in progress, and standing behind the result in Australia.',
    offices: [
      {
        code: 'AU',
        title: 'Sydney Head Office',
        body: 'Client relationships, engineering oversight and delivery accountability — Level 29, 66 Goulburn St, Sydney NSW 2000.',
      },
      {
        code: 'VN',
        title: 'Ho Chi Minh City Office',
        body: 'Drafting, QA inspection and factory coordination on the ground, minutes from our partner fabrication plants.',
      },
    ],
    imageFilename: '07-the-smart-solutions-australia-drafting-o.jpg',
    imageAlt:
      'The Smart Solutions Australia drafting office in Ho Chi Minh City, with detailers modelling a steel structure on screen',
    captionLead: 'On the ground, every project.',
    caption:
      'Founding Director John Walker and Vietnam Manager Quynh Pham at a trial assembly — the step that catches problems in the factory, not on your site.',
  },
  exploreIntro: {
    eyebrow: 'Explore Smart Solutions Australia',
    title: 'Everything on its own page',
    body: 'Capabilities, process, quality documentation, delivered projects and the people behind them — each covered in full on its own page.',
  },
  exploreCards: [
    {
      title: 'Capabilities',
      body: 'Fabrication, structural design, Tekla shop drawings, workshop inspection, trial assembly and door-to-door logistics.',
      ctaLabel: 'Explore capabilities →',
      href: '/capabilities',
    },
    {
      title: 'Our Process',
      body: 'Five documented steps from design and engineering to delivery on your site — no unknowns, reported at every stage.',
      ctaLabel: 'See how it works →',
      href: '/process',
    },
    {
      title: 'Compliance & Quality',
      body: 'ISO 9001 / 14001 / 45001, CC3 traceability and the full QA document pack that backs every shipment.',
      ctaLabel: 'Review the QA pack →',
      href: '/quality',
    },
    {
      title: 'Products',
      body: 'Beyond the frame: stairs, louvres, barriers and mesh — plus telecom and energy poles with our manufacturing partner.',
      ctaLabel: 'Browse products →',
      href: '/products',
    },
    {
      title: 'Our Team',
      body: 'A small, senior team in Sydney and Ho Chi Minh City — you deal with the decision-makers and the people in the factory.',
      ctaLabel: 'Meet the team →',
      href: '/team',
    },
    {
      title: 'Contact',
      body: 'Three offices, direct phone numbers, office hours, maps and a contact form — pick the office closest to your project.',
      ctaLabel: 'Get in touch →',
      href: '/contact',
    },
  ],
  featuredSection: {
    eyebrow: 'Featured Project',
    ctaLabel: 'View Project Details',
  },
}
