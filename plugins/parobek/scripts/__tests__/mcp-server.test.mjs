// Integration test for the MCP stdio server. Spawns mcp/server.mjs as a real
// child process (HOME redirected to a temp dir, config seeded to point at the
// mock LLM server), feeds newline-delimited JSON-RPC frames on stdin, then asserts
// the responses and that local_ping round-trips against the mock /v1/models route.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { redirectHome, cleanupHome, seedConfig } from './helpers/env.mjs'
import { startMockServer } from './helpers/mock-server.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = join(HERE, '..', '..', 'mcp', 'server.mjs')

/**
 * Spawn the server with the given temp HOME, write all frames, close stdin, and
 * resolve with the parsed response objects (newline-delimited JSON on stdout).
 */
function runServer(home, frames) {
  const env = { ...process.env, USERPROFILE: home, HOME: home }
  const child = spawn(process.execPath, [SERVER], { env })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (c) => (stdout += c))
  child.stderr.on('data', (c) => (stderr += c))
  for (const f of frames) child.stdin.write(JSON.stringify(f) + '\n')
  child.stdin.end()
  return new Promise((resolve) => {
    child.on('close', (code) => {
      const messages = stdout
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l))
      resolve({ code, messages, stderr })
    })
  })
}

test('MCP server: initialize / tools/list / tools/call round-trip', async () => {
  const { home, stateDir } = redirectHome()
  const mock = await startMockServer()
  try {
    seedConfig(stateDir, {
      endpoint: mock.url,
      apiKey: 'test',
      provider: 'openai',
      model: 'test-model',
      savingTier: 'safe',
    })

    const { messages } = await runServer(home, [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' }, // notification: no reply
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'local_ping', arguments: {} } },
    ])

    const byId = new Map(messages.map((m) => [m.id, m]))

    // initialize
    const init = byId.get(1)
    assert.equal(init.jsonrpc, '2.0')
    assert.equal(init.result.serverInfo.name, 'parobek-local')
    assert.ok(init.result.capabilities.tools, 'advertises tools capability')
    assert.equal(init.result.protocolVersion, '2025-03-26')

    // the notification produced no response
    assert.equal(messages.length, 3, 'exactly 3 responses (notification got none)')

    // tools/list
    const list = byId.get(2)
    const names = list.result.tools.map((t) => t.name)
    assert.ok(names.includes('local_ping'))
    const ping = list.result.tools.find((t) => t.name === 'local_ping')
    assert.equal(ping.inputSchema.type, 'object')

    // tools/call local_ping
    const call = byId.get(3)
    assert.ok(!call.error, 'no protocol error')
    assert.equal(call.result.content[0].type, 'text')
    assert.match(call.result.content[0].text, /reachable: true/)
    assert.match(call.result.content[0].text, /model: test-model/)

    // proof of round-trip: provider.ping hit the mock /v1/models route
    assert.ok(
      mock.requests.some((r) => r.method === 'GET' && r.path === '/v1/models'),
      'local_ping reached the local server',
    )
  } finally {
    await mock.close()
    cleanupHome(home)
  }
})

test('MCP server: unknown method -> METHOD_NOT_FOUND', async () => {
  const { home, stateDir } = redirectHome()
  try {
    seedConfig(stateDir, { endpoint: 'http://127.0.0.1:1/v1', model: 'm', provider: 'openai' })
    const { messages } = await runServer(home, [
      { jsonrpc: '2.0', id: 1, method: 'does/not/exist' },
    ])
    assert.equal(messages.length, 1)
    assert.equal(messages[0].error.code, -32601)
  } finally {
    cleanupHome(home)
  }
})

test('MCP server: unknown tool -> INVALID_PARAMS', async () => {
  const { home, stateDir } = redirectHome()
  try {
    seedConfig(stateDir, { endpoint: 'http://127.0.0.1:1/v1', model: 'm', provider: 'openai' })
    const { messages } = await runServer(home, [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope', arguments: {} } },
    ])
    assert.equal(messages[0].error.code, -32602)
  } finally {
    cleanupHome(home)
  }
})
