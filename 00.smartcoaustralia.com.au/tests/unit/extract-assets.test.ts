import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('extraction produced the stylesheet, manifest and 29 image files', () => {
  const manifest = JSON.parse(fs.readFileSync('docs/template-assets.json', 'utf8'))
  assert.equal(manifest.images.length, 29)
  assert.ok(fs.statSync('src/styles/site.css').size > 30_000)
  for (const image of manifest.images) {
    assert.ok(image.width > 0 && image.height > 0, `${image.file} has dimensions`)
    assert.ok(fs.statSync(`public/images/seed/${image.file}`).size > 1_000, `${image.file} exists`)
  }
})

test('content and project extraction cover the template', () => {
  const content = fs.readFileSync('docs/template-content.md', 'utf8')
  assert.match(content, /Steel standing across Australia/)
  assert.match(content, /Five steps\. No unknowns\./)
  const projects = JSON.parse(fs.readFileSync('docs/template-projects.json', 'utf8'))
  assert.equal(Object.keys(projects).length, 6)
  assert.equal(projects['warehouse-newcastle'].title, 'Distribution Warehouse')
})
