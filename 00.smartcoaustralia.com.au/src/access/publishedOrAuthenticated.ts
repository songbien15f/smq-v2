import type { Access } from 'payload'

/** Published documents are public; authenticated users can read everything. */
export const publishedOrAuthenticated: Access = ({ req }) =>
  req.user ? true : { _status: { equals: 'published' } }
