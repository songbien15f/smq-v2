import test from 'node:test'
import assert from 'node:assert/strict'
import { filterProjects, pickFeatured } from '../../src/lib/filterProjects'
import type { Project } from '../../src/payload-types'

const project = (over: Partial<Project>): Project => ({
  id: 1, title: 'X', slug: 'x', location: 'NSW', state: 'NSW',
  sector: 'industrial', structure: '', intro: '', scope: [], featured: false,
  order: 0, updatedAt: '', createdAt: '', ...over,
} as Project)

const all = [
  project({ id: 1, slug: 'a', state: 'NSW', sector: 'industrial' }),
  project({ id: 2, slug: 'b', state: 'NSW', sector: 'agricultural' }),
  project({ id: 3, slug: 'c', state: 'QLD', sector: 'industrial' }),
  project({ id: 4, slug: 'd', state: 'WA', sector: 'community' }),
]

test('no filters returns every project', () => {
  assert.equal(filterProjects(all, {}).length, 4)
})

test('sector and state combine', () => {
  assert.deepEqual(filterProjects(all, { state: 'NSW', sector: 'industrial' }).map((p) => p.slug), ['a'])
})

test('unknown values return an empty list', () => {
  assert.equal(filterProjects(all, { sector: 'unknown' }).length, 0)
})

test('pickFeatured returns null when nothing is featured', () => {
  assert.equal(pickFeatured(all), null)
})

test('pickFeatured returns the flagged project', () => {
  assert.equal(pickFeatured([...all, project({ id: 9, slug: 'f', featured: true })] )?.slug, 'f')
})
