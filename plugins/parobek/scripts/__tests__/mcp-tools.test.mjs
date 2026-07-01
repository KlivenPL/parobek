// Integration tests for the F3.2 digest tools. Spawns mcp/server.mjs as a real child
// process (HOME redirected, config seeded at the mock LLM server), issues tools/call
// frames, and asserts each tool round-trips: reads its input, hits the mock
// /v1/chat/completions route, and returns a text result (no isError).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { redirectHome, cleanupHome, seedConfig } from './helpers/env.mjs'
import { startMockServer } from './helpers/mock-server.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = join(HERE, '..', '..', 'mcp', 'server.mjs')

const baseConfig = (url) => ({
  endpoint: url,
  apiKey: 'test',
  provider: 'openai',
  model: 'test-model',
  savingTier: 'safe',
})

/** Spawn the server with the temp HOME (and optional cwd), write frames, collect responses. */
function runServer(home, frames, { cwd } = {}) {
  const env = { ...process.env, USERPROFILE: home, HOME: home }
  const child = spawn(process.execPath, [SERVER], { env, cwd })
  let stdout = ''
  child.stdout.on('data', (c) => (stdout += c))
  for (const f of frames) child.stdin.write(JSON.stringify(f) + '\n')
  child.stdin.end()
  return new Promise((resolve) => {
    child.on('close', () => {
      const messages = stdout
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l))
      resolve(messages)
    })
  })
}

const call = (id, name, args) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args },
})

const hitChat = (mock) =>
  mock.requests.some((r) => r.method === 'POST' && r.path === '/v1/chat/completions')

function hasRipgrep() {
  try {
    execFileSync('rg', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

test('tools/list advertises local_ping + all 7 digest tools', async () => {
  const { home, stateDir } = redirectHome()
  const mock = await startMockServer()
  try {
    seedConfig(stateDir, baseConfig(mock.url))
    const messages = await runServer(home, [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }])
    const names = messages[0].result.tools.map((t) => t.name)
    for (const n of [
      'local_ping',
      'local_summarize',
      'local_read_digest',
      'local_extract',
      'local_grep_digest',
      'local_outline',
      'local_log_triage',
      'local_diff_digest',
    ]) {
      assert.ok(names.includes(n), `advertises ${n}`)
    }
    // Every digest tool nudges toward itself over a raw read.
    const summarize = messages[0].result.tools.find((t) => t.name === 'local_summarize')
    assert.match(summarize.description, /Prefer this over/)
  } finally {
    await mock.close()
    cleanupHome(home)
  }
})

test('local_summarize (path) and local_read_digest round-trip against the mock', async () => {
  const { home, stateDir } = redirectHome()
  const mock = await startMockServer({ chat: 'DIGEST OUTPUT' })
  try {
    seedConfig(stateDir, baseConfig(mock.url))
    const file = join(home, 'sample.txt')
    writeFileSync(file, 'The quick brown fox.\n\nJumped over the lazy dog.', 'utf8')

    const messages = await runServer(home, [
      call(1, 'local_summarize', { path: file, focus: 'animals' }),
      call(2, 'local_read_digest', { path: file, question: 'what animal?' }),
    ])
    const byId = new Map(messages.map((m) => [m.id, m]))

    assert.ok(!byId.get(1).result.isError)
    assert.match(byId.get(1).result.content[0].text, /DIGEST OUTPUT/)
    assert.ok(!byId.get(2).result.isError)
    assert.match(byId.get(2).result.content[0].text, /DIGEST OUTPUT/)
    assert.ok(hitChat(mock), 'reached the local chat route')
  } finally {
    await mock.close()
    cleanupHome(home)
  }
})

test('local_summarize with text input works without a file', async () => {
  const { home, stateDir } = redirectHome()
  const mock = await startMockServer({ chat: 'SUM' })
  try {
    seedConfig(stateDir, baseConfig(mock.url))
    const messages = await runServer(home, [
      call(1, 'local_summarize', { text: 'some inline text to condense' }),
    ])
    assert.match(messages[0].result.content[0].text, /SUM/)
  } finally {
    await mock.close()
    cleanupHome(home)
  }
})

test('local_extract returns parsed JSON', async () => {
  const { home, stateDir } = redirectHome()
  const mock = await startMockServer({ chat: '{"todos":["a","b"]}' })
  try {
    seedConfig(stateDir, baseConfig(mock.url))
    const messages = await runServer(home, [
      call(1, 'local_extract', { text: 'TODO a\nTODO b', schema: { type: 'object' } }),
    ])
    assert.ok(!messages[0].result.isError)
    assert.deepEqual(JSON.parse(messages[0].result.content[0].text), { todos: ['a', 'b'] })
  } finally {
    await mock.close()
    cleanupHome(home)
  }
})

test('local_extract on non-JSON output returns raw text with a note (never fails)', async () => {
  const { home, stateDir } = redirectHome()
  const mock = await startMockServer({ chat: 'sorry, not json' })
  try {
    seedConfig(stateDir, baseConfig(mock.url))
    const messages = await runServer(home, [
      call(1, 'local_extract', { text: 'x', schema: 'a list' }),
    ])
    assert.ok(!messages[0].result.isError)
    assert.match(messages[0].result.content[0].text, /Could not parse the extraction as JSON/)
    assert.match(messages[0].result.content[0].text, /sorry, not json/)
  } finally {
    await mock.close()
    cleanupHome(home)
  }
})

test('local_outline and local_log_triage round-trip against the mock', async () => {
  const { home, stateDir } = redirectHome()
  const mock = await startMockServer({ chat: 'STRUCTURED OUTPUT' })
  try {
    seedConfig(stateDir, baseConfig(mock.url))
    const src = join(home, 'mod.mjs')
    writeFileSync(src, 'export function a() {}\nexport function b() {}\n', 'utf8')
    const log = join(home, 'run.log')
    writeFileSync(log, 'INFO start\nERROR boom\n  at frame\nINFO done\n', 'utf8')

    const messages = await runServer(home, [
      call(1, 'local_outline', { path: src }),
      call(2, 'local_log_triage', { path: log }),
    ])
    const byId = new Map(messages.map((m) => [m.id, m]))
    assert.match(byId.get(1).result.content[0].text, /STRUCTURED OUTPUT/)
    assert.match(byId.get(2).result.content[0].text, /STRUCTURED OUTPUT/)
  } finally {
    await mock.close()
    cleanupHome(home)
  }
})

test('local_read_digest on a missing file → isError (graceful)', async () => {
  const { home, stateDir } = redirectHome()
  const mock = await startMockServer()
  try {
    seedConfig(stateDir, baseConfig(mock.url))
    const messages = await runServer(home, [
      call(1, 'local_read_digest', { path: join(home, 'does-not-exist.txt') }),
    ])
    assert.ok(messages[0].result.isError, 'a missing path is an isError tool result, not a crash')
    assert.match(messages[0].result.content[0].text, /cannot read file/)
  } finally {
    await mock.close()
    cleanupHome(home)
  }
})

test('local_diff_digest digests a git diff', async () => {
  const { home, stateDir } = redirectHome()
  const mock = await startMockServer({ chat: 'PER-FILE SUMMARY' })
  try {
    seedConfig(stateDir, baseConfig(mock.url))
    const repo = join(home, 'repo')
    mkdirSync(repo, { recursive: true })
    const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
    git(['init', '-q'])
    git(['config', 'user.email', 't@example.com'])
    git(['config', 'user.name', 'Test'])
    writeFileSync(join(repo, 'f.txt'), 'line1\nline2\n', 'utf8')
    git(['add', '.'])
    git(['commit', '-q', '-m', 'init'])
    writeFileSync(join(repo, 'f.txt'), 'line1 changed\nline2\nline3\n', 'utf8')

    // Server cwd = repo so `git diff` sees the unstaged change.
    const messages = await runServer(home, [call(1, 'local_diff_digest', {})], { cwd: repo })
    assert.ok(!messages[0].result.isError)
    assert.match(messages[0].result.content[0].text, /PER-FILE SUMMARY/)
  } finally {
    await mock.close()
    cleanupHome(home)
  }
})

test(
  'local_grep_digest digests ripgrep hits',
  { skip: hasRipgrep() ? false : 'ripgrep (rg) not on PATH' },
  async () => {
    const { home, stateDir } = redirectHome()
    const mock = await startMockServer({ chat: 'GREP DIGEST' })
    try {
      seedConfig(stateDir, baseConfig(mock.url))
      const dir = join(home, 'src')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'a.txt'), 'hello world\nfoobar\nhello again\n', 'utf8')

      const messages = await runServer(home, [
        call(1, 'local_grep_digest', { pattern: 'hello', path: dir }),
      ])
      assert.ok(!messages[0].result.isError)
      assert.match(messages[0].result.content[0].text, /GREP DIGEST/)
    } finally {
      await mock.close()
      cleanupHome(home)
    }
  },
)
