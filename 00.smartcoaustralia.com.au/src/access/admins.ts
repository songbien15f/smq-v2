import type { Access } from 'payload'

export const admins: Access = ({ req: { user } }) =>
  Boolean(user) && (user as { role?: string }).role === 'admin'
