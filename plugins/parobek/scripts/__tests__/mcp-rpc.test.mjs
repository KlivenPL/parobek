import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createMessageReader,
  encodeMessage,
  result,
  errorResponse,
  RPC_ERRORS,
} from '../../mcp/lib/rpc.mjs'

test('encodeMessage: single newline-terminated frame, no embedded newlines', () => {
  const frame = encodeMessage({ jsonrpc: '2.0', id: 1, result: { ok: true } })
  assert.ok(frame.endsWith('\n'))
  assert.equal(frame.indexOf('\n'), frame.length - 1)
  assert.deepEqual(JSON.parse(frame), { jsonrpc: '2.0', id: 1, result: { ok: true } })
})

test('result / errorResponse: well-formed JSON-RPC envelopes', () => {
  assert.deepEqual(result(7, { a: 1 }), { jsonrpc: '2.0', id: 7, result: { a: 1 } })

  assert.deepEqual(errorResponse(7, RPC_ERRORS.METHOD_NOT_FOUND, 'nope'), {
    jsonrpc: '2.0',
    id: 7,
    error: { code: -32601, message: 'nope' },
  })

  // data is included only when provided
  assert.deepEqual(errorResponse(null, RPC_ERRORS.PARSE_ERROR, 'bad', { detail: 'x' }), {
    jsonrpc: '2.0',
    id: null,
    error: { code: -32700, message: 'bad', data: { detail: 'x' } },
  })
})

test('reader: parses one message per line', () => {
  const seen = []
  const r = createMessageReader({ onMessage: (m) => seen.push(m) })
  r.push('{"jsonrpc":"2.0","id":1,"method":"ping"}\n')
  assert.deepEqual(seen, [{ jsonrpc: '2.0', id: 1, method: 'ping' }])
})

test('reader: multiple messages in one chunk', () => {
  const seen = []
  const r = createMessageReader({ onMessage: (m) => seen.push(m) })
  r.push('{"id":1}\n{"id":2}\n{"id":3}\n')
  assert.deepEqual(seen.map((m) => m.id), [1, 2, 3])
})

test('reader: message split across two chunks stays buffered until complete', () => {
  const seen = []
  const r = createMessageReader({ onMessage: (m) => seen.push(m) })
  r.push('{"id":1,"method":"to')
  assert.equal(seen.length, 0, 'no full line yet')
  assert.ok(r.pending.length > 0)
  r.push('ols/list"}\n')
  assert.deepEqual(seen, [{ id: 1, method: 'tools/list' }])
  assert.equal(r.pending, '')
})

test('reader: blank/whitespace lines ignored', () => {
  const seen = []
  const r = createMessageReader({ onMessage: (m) => seen.push(m) })
  r.push('\n   \n{"id":1}\n\n')
  assert.deepEqual(seen, [{ id: 1 }])
})

test('reader: invalid JSON line routed to onParseError, stream continues', () => {
  const seen = []
  const errs = []
  const r = createMessageReader({
    onMessage: (m) => seen.push(m),
    onParseError: (err, line) => errs.push(line),
  })
  r.push('not json\n{"id":2}\n')
  assert.equal(errs.length, 1)
  assert.equal(errs[0], 'not json')
  assert.deepEqual(seen, [{ id: 2 }])
})

test('reader: accepts Buffer chunks', () => {
  const seen = []
  const r = createMessageReader({ onMessage: (m) => seen.push(m) })
  r.push(Buffer.from('{"id":9}\n', 'utf8'))
  assert.deepEqual(seen, [{ id: 9 }])
})
