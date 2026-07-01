import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getProvider, LocalModelError, modelContextLength } from '../lib/provider.mjs'
import * as openai from '../lib/providers/openai.mjs'
import * as lmstudio from '../lib/providers/lmstudio.mjs'
import * as ollama from '../lib/providers/ollama.mjs'

test('getProvider: dispatches on config.provider', () => {
  assert.equal(getProvider({ provider: 'openai' }), openai)
  assert.equal(getProvider({ provider: 'lmstudio' }), lmstudio)
  assert.equal(getProvider({ provider: 'ollama' }), ollama)
})

test('getProvider: unknown/absent -> lmstudio default', () => {
  assert.equal(getProvider({ provider: 'nope' }), lmstudio)
  assert.equal(getProvider({}), lmstudio)
  assert.equal(getProvider(null), lmstudio)
  assert.equal(getProvider(undefined), lmstudio)
})

test('facade: exposes modelContextLength', () => {
  assert.equal(typeof modelContextLength, 'function')
})

test('LocalModelError: single shared class across providers', () => {
  assert.equal(LocalModelError, openai.LocalModelError)
  assert.equal(LocalModelError, lmstudio.LocalModelError)
  assert.equal(LocalModelError, ollama.LocalModelError)
  assert.ok(new LocalModelError('x') instanceof Error)
})
