import { test, expect } from '@playwright/test'

test('seeded collections expose the expected records', async ({ request }) => {
  const projects = await (await request.get('/api/projects?limit=100&depth=0')).json()
  expect(projects.totalDocs).toBe(6)
  const team = await (await request.get('/api/team-members?limit=100&depth=0')).json()
  expect(team.totalDocs).toBe(3)
  const groups = await (await request.get('/api/product-groups?limit=100&depth=0')).json()
  expect(groups.totalDocs).toBe(2)
  const offices = await (await request.get('/api/offices?limit=100&depth=0')).json()
  expect(offices.totalDocs).toBe(3)
})
