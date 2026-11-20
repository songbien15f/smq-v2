import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  // Playwright drives the dev server over 127.0.0.1 while Next binds localhost,
  // and the public tunnel serves the same dev server under a random
  // *.trycloudflare.com hostname, which trips the cross-origin warning on every
  // request without these entries.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '*.trycloudflare.com'],
}

export default withPayload(nextConfig)
