import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  inputBudget,
  chunkMessages,
  deriveMaxOutputTokens,
} from '../lib/tokens.mjs'

test('estimateTokens: empty/null -> 0, else ceil(len/4)', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens(null), 0)
  assert.equal(estimateTokens(undefined), 0)
  assert.equal(estimateTokens('a'), 1) // ceil(1/4)
  assert.equal(estimateTokens('abcd'), 1) // ceil(4/4)
  assert.equal(estimateTokens('abcde'), 2) // ceil(5/4)
})

test('estimateMessageTokens: content tokens + 4 overhead', () => {
  assert.equal(estimateMessageTokens({ role: 'user', content: '' }), 4)
  assert.equal(estimateMessageTokens({ role: 'user', content: 'abcd' }), 5)
})

test('estimateMessagesTokens: sums across messages', () => {
  const msgs = [
    { role: 'user', content: 'abcd' }, // 5
    { role: 'assistant', content: '' }, // 4
  ]
  assert.equal(estimateMessagesTokens(msgs), 9)
})

test('inputBudget: default = ctx - out - reserve', () => {
  assert.equal(inputBudget({ localContextTokens: 8192, maxOutputTokens: 2048 }), 8192 - 2048 - 1500)
})

test('inputBudget: floored at 512 for tiny contexts', () => {
  assert.equal(inputBudget({ localContextTokens: 1000, maxOutputTokens: 800 }), 512)
})

test('inputBudget: custom promptReserve honored', () => {
  assert.equal(inputBudget({ localContextTokens: 8192, maxOutputTokens: 2048 }, 0), 8192 - 2048)
})

test('deriveMaxOutputTokens: 25% of window, default-equivalent at 8192', () => {
  assert.equal(deriveMaxOutputTokens(8192), 2048) // matches historical default
  assert.equal(deriveMaxOutputTokens(16384), 4096)
})

test('deriveMaxOutputTokens: capped at 8192 for large windows', () => {
  assert.equal(deriveMaxOutputTokens(32768), 8192)
  assert.equal(deriveMaxOutputTokens(131072), 8192)
})

test('deriveMaxOutputTokens: floored at 1024 for tiny/absent windows', () => {
  assert.equal(deriveMaxOutputTokens(2000), 1024)
  assert.equal(deriveMaxOutputTokens(0), 1024)
  assert.equal(deriveMaxOutputTokens(undefined), 1024)
})

test('chunkMessages: empty -> []', () => {
  assert.deepEqual(chunkMessages([], 100), [])
})

test('chunkMessages: an oversized single message stays whole in its own chunk', () => {
  const big = { role: 'user', content: 'x'.repeat(1000) } // ~254 tokens
  const chunks = chunkMessages([big], 10)
  assert.equal(chunks.length, 1)
  assert.deepEqual(chunks[0], [big])
})

test('chunkMessages: splits into contiguous chunks within budget', () => {
  // Each message ~ ceil(40/4)+4 = 14 tokens. Budget 30 -> 2 per chunk.
  const msgs = Array.from({ length: 5 }, (_, i) => ({
    role: 'user',
    content: 'x'.repeat(40) + i,
  }))
  const chunks = chunkMessages(msgs, 30)
  // 2 + 2 + 1, order preserved, every message present exactly once.
  assert.deepEqual(
    chunks.map((c) => c.length),
    [2, 2, 1],
  )
  assert.deepEqual(chunks.flat(), msgs)
})
