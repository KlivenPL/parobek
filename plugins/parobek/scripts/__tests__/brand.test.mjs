import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BRAND, TAG, tag } from '../lib/brand.mjs'

test('brand constants', () => {
  assert.equal(BRAND, 'Parobek')
  assert.equal(TAG, '[Parobek]')
})

test('tag: prefixes a line with the brand tag', () => {
  assert.equal(tag('hello'), '[Parobek] hello')
  assert.equal(tag(''), '[Parobek] ')
})
