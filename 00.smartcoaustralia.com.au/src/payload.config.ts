import 'dotenv/config'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import sharp from 'sharp'
import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Projects } from './collections/Projects'
import { TeamMembers } from './collections/TeamMembers'
import { ProductGroups } from './collections/ProductGroups'
import { Offices } from './collections/Offices'
import { Inquiries } from './collections/Inquiries'
import { Footer } from './globals/Footer'
import { Header } from './globals/Header'
import { HomePage } from './globals/HomePage'
import { CapabilitiesPage } from './globals/CapabilitiesPage'
import { ProcessPage } from './globals/ProcessPage'
import { QualityPage } from './globals/QualityPage'
import { ProjectsPage } from './globals/ProjectsPage'
import { ProjectDetailSettings } from './globals/ProjectDetailSettings'
import { ProductsPage } from './globals/ProductsPage'
import { TeamPage } from './globals/TeamPage'
import { QuotePage } from './globals/QuotePage'
import { ContactPage } from './globals/ContactPage'
import { PrivacyPage } from './globals/PrivacyPage'
import { SiteSettings } from './globals/SiteSettings'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    components: {
      // Site pages surfaced as one tree, above Payload's own grouped links.
      beforeNavLinks: ['@/components/admin/PageTreeNav#default'],
    },
  },
  collections: [Users, Media, Projects, TeamMembers, ProductGroups, Offices, Inquiries],
  globals: [
    SiteSettings,
    Header,
    Footer,
    HomePage,
    CapabilitiesPage,
    ProcessPage,
    QualityPage,
    ProjectsPage,
    ProjectDetailSettings,
    ProductsPage,
    TeamPage,
    QuotePage,
    ContactPage,
    PrivacyPage,
  ],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || 'dev-only-secret',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URI || 'postgresql://postgres:123456@127.0.0.1:5432/smartcoa', max: 10 },
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
  }),
  sharp,
})
