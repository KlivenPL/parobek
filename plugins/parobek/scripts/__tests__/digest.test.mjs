// Unit tests for the shared runDigest runner. Exercises the real fetch path against
// the zero-dep mock LLM server (no home redirect needed — runDigest reads endpoint
// /model straight from the passed config, not from disk).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startMockServer } from './helpers/mock-server.mjs'
import { runDigest } from '../lib/digest.mjs'
import { LocalModelError } from '../lib/provider.mjs'

function cfg(url, over = {}) {
  return {
    endpoint: url,
    apiKey: 'test',
    provider: 'openai',
    model: 'test-model',
    temperature: 0.2,
    maxOutputTokens: 256,
    localContextTokens: 4096,
    ...over,
  }
}

const chatCalls = (mock) =>
  mock.requests.filter((r) => r.method === 'POST' && r.path === '/v1/chat/completions')

test('runDigest: single pass for a small input (one chat call)', async () => {
  const mock = await startMockServer({ chat: 'DIGEST' })
  try {
    const out = await runDigest(cfg(mock.url), 'a short input', { finalPrompt: 'Summarize it.' })
    assert.equal(out, 'DIGEST')
    assert.equal(chatCalls(mock).length, 1)
  } finally {
    await mock.close()
  }
})

test('runDigest: map-reduce for an oversize input (multiple chat calls)', async () => {
  const mock = await startMockServer({ chat: 'PART' })
  try {
    const big = Array.from(
      { length: 60 },
      (_, i) => `paragraph number ${i} with some filler text to add token weight`,
    ).join('\n\n')
    // Tiny context so the blob overflows the single-pass budget and forces chunking.
    const out = await runDigest(cfg(mock.url, { localContextTokens: 300, maxOutputTokens: 64 }), big, {
      finalPrompt: 'Fold the parts.',
    })
    assert.equal(out, 'PART')
    assert.ok(chatCalls(mock).length >= 2, `expected map+reduce calls, got ${chatCalls(mock).length}`)
  } finally {
    await mock.close()
  }
})

test('runDigest: retries once on degenerate output, returns the good retry', async () => {
  const degenerate = Array.from({ length: 20 }, () => 'LOOP LOOP LOOP').join('\n')
  const mock = await startMockServer({ chatSequence: [degenerate, 'CLEAN'] })
  try {
    const out = await runDigest(cfg(mock.url), 'input', { finalPrompt: 'Do it.' })
    assert.equal(out, 'CLEAN')
    const calls = chatCalls(mock)
    assert.equal(calls.length, 2)
    // The retry used the stronger anti-repeat tier.
    assert.equal(calls[1].body.frequency_penalty, 0.6)
  } finally {
    await mock.close()
  }
})

test('runDigest: retries once on an empty response, returns the good retry', async () => {
  // Thinking models sporadically return empty content; the first call is empty,
  // the retry is clean. Empty content ('') makes the provider throw empty_response.
  const mock = await startMockServer({ chatSequence: ['', 'CLEAN'] })
  try {
    const out = await runDigest(cfg(mock.url), 'input', { finalPrompt: 'Do it.' })
    assert.equal(out, 'CLEAN')
    const calls = chatCalls(mock)
    assert.equal(calls.length, 2)
    // The retry used the stronger anti-repeat tier, same as the degeneration path.
    assert.equal(calls[1].body.frequency_penalty, 0.6)
  } finally {
    await mock.close()
  }
})

test('runDigest: propagates when the response is empty twice', async () => {
  const mock = await startMockServer({ chatSequence: ['', ''] })
  try {
    await assert.rejects(
      () => runDigest(cfg(mock.url), 'input', { finalPrompt: 'x' }),
      (err) => err instanceof LocalModelError && err.code === 'empty_response',
    )
  } finally {
    await mock.close()
  }
})

test('runDigest: throws when the model loops twice', async () => {
  const degenerate = Array.from({ length: 20 }, () => 'LOOP LOOP LOOP').join('\n')
  const mock = await startMockServer({ chatSequence: [degenerate, degenerate] })
  try {
    await assert.rejects(
      () => runDigest(cfg(mock.url), 'input', { finalPrompt: 'x' }),
      LocalModelError,
    )
  } finally {
    await mock.close()
  }
})
