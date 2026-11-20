import test from 'node:test'
import assert from 'node:assert/strict'
import { hasUsableImage } from '../../src/lib/media'

test('hasUsableImage accepts local and remote paths', () => {
  assert.equal(hasUsableImage('/images/seed/home-hero.jpg'), true)
  assert.equal(hasUsableImage('https://example.com/a.jpg'), true)
})

test('hasUsableImage rejects empty and malformed values', () => {
  assert.equal(hasUsableImage(undefined), false)
  assert.equal(hasUsableImage(''), false)
  assert.equal(hasUsableImage('   '), false)
  assert.equal(hasUsableImage(42), false)
})
