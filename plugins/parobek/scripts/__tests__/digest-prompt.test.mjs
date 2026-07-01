// Unit tests for the digest-tool prompt builders and the extract-result parser.
// Pure functions — no network, no state.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getSummarizePrompt,
  getReadDigestPrompt,
  getExtractPrompt,
  getGrepDigestPrompt,
  getOutlinePrompt,
  getLogTriagePrompt,
  getDiffDigestPrompt,
  getDigestChunkPrompt,
  parseExtractResult,
} from '../lib/digest-prompt.mjs'

test('prompt builders include their key instruction and inputs', () => {
  assert.match(getSummarizePrompt(), /digest/i)
  assert.match(getSummarizePrompt('errors only'), /errors only/)

  assert.match(getReadDigestPrompt(), /structural digest/i)
  assert.match(getReadDigestPrompt('where is X handled'), /where is X handled/)

  assert.match(getExtractPrompt({ type: 'object' }), /JSON/)
  assert.match(getExtractPrompt({ type: 'object' }), /"type": "object"/) // object stringified
  assert.match(getExtractPrompt('a list of TODOs'), /a list of TODOs/) // string passthrough

  assert.match(getGrepDigestPrompt('TODO\\('), /TODO\\\(/)
  assert.match(getOutlinePrompt(), /outline/i)
  assert.match(getLogTriagePrompt(), /VERBATIM/)
  assert.match(getDiffDigestPrompt(), /per-file/i)
  assert.match(getDigestChunkPrompt(2, 5), /part 2 of 5/)
})

test('every builder forbids tool calls (text-only framing)', () => {
  for (const p of [
    getSummarizePrompt(),
    getReadDigestPrompt('q'),
    getExtractPrompt({}),
    getGrepDigestPrompt('x'),
    getOutlinePrompt(),
    getLogTriagePrompt(),
    getDiffDigestPrompt(),
  ]) {
    assert.match(p, /plain text only/i)
  }
})

test('parseExtractResult: clean JSON → value', () => {
  const r = parseExtractResult('{"a":1,"b":["x"]}')
  assert.deepEqual(r.value, { a: 1, b: ['x'] })
  assert.equal(r.error, undefined)
})

test('parseExtractResult: fenced JSON → value', () => {
  const r = parseExtractResult('```json\n{"a":2}\n```')
  assert.deepEqual(r.value, { a: 2 })
})

test('parseExtractResult: invalid → raw + error, no throw', () => {
  const r = parseExtractResult('not json at all')
  assert.equal(r.value, undefined)
  assert.equal(r.raw, 'not json at all')
  assert.ok(r.error)
})
