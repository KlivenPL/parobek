// Integration tests for the F5.1 file-reference pre-digest UserPromptSubmit hook.
// Spawns the real predigest.mjs with a temp HOME + a seeded config pointing at the
// mock local server, feeds a UserPromptSubmit event on stdin, and asserts the
// gating, size floor, cap/prioritize, and single-pass truncation behavior.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { redirectHome, cleanupHome, seedConfig } from './helpers/env.mjs'
import { runScript } from './helpers/run.mjs'
import { startMockServer } from './helpers/mock-server.mjs'
import { makeConfig } from './helpers/fixtures.mjs'

const ctx = redirectHome()
let srv

before(async () => {
  srv = await startMockServer({ chat: 'PREDIGEST_MARKER local digest.' })
})

const dirs = []
after(async () => {
  await srv.close()
  cleanupHome(ctx.home)
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

/** Fresh temp working dir for one test. */
function makeDir() {
  const dir = mkdtempSync(join(tmpdir(), 'parobek-predigest-'))
  dirs.push(dir)
  return dir
}

/** Write a file of `bytes` bytes into `dir` and return its name. */
function writeFile(dir, name, bytes, marker = 'x') {
  writeFileSync(join(dir, name), marker.repeat(bytes), 'utf8')
  return name
}

/** Chat-completion request bodies logged by the mock since index `from`. */
function chatBodiesSince(from) {
  return srv.requests
    .slice(from)
    .filter((r) => r.method === 'POST' && r.path === '/v1/chat/completions')
    .map((r) => r.body)
}

/** Run predigest with a UserPromptSubmit event for `prompt` in `dir`. */
function run(dir, prompt) {
  const stdin = JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt, cwd: dir })
  return runScript('predigest.mjs', { home: ctx.home, cwd: dir, stdin })
}

test('Safe tier → silent even when a big file is referenced', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: 'test-model', savingTier: 'safe' }))
  const dir = makeDir()
  writeFile(dir, 'big.txt', 5000)
  const before = srv.requests.length
  const { stdout } = await run(dir, 'please read big.txt')
  assert.equal(stdout.trim(), '', 'no output at Safe')
  assert.equal(chatBodiesSince(before).length, 0, 'no local call at Safe')
})

test('Balanced → digests the referenced file and injects a branded block', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: 'test-model', savingTier: 'balanced' }))
  const dir = makeDir()
  writeFile(dir, 'notes.md', 5000, 'UNIQUE_FILE_BODY ')
  const before = srv.requests.length

  const { stdout } = await run(dir, 'what does notes.md say about the plan?')
  const out = JSON.parse(stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit')
  const ctxText = out.hookSpecificOutput.additionalContext
  assert.match(ctxText, /\[Parobek\]/)
  assert.match(ctxText, /notes\.md/)
  assert.match(ctxText, /PREDIGEST_MARKER/) // the local model's digest
  // The file body was actually sent to the local model.
  assert.match(JSON.stringify(chatBodiesSince(before)), /UNIQUE_FILE_BODY/)
})

test('file below the size floor → silent, no local call', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: 'test-model', savingTier: 'balanced' }))
  const dir = makeDir()
  writeFile(dir, 'tiny.txt', 100) // < MIN_BYTES (3072)
  const before = srv.requests.length
  const { stdout } = await run(dir, 'look at tiny.txt')
  assert.equal(stdout.trim(), '')
  assert.equal(chatBodiesSince(before).length, 0)
})

test('no model selected → silent', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: '', savingTier: 'balanced' }))
  const dir = makeDir()
  writeFile(dir, 'big.txt', 5000)
  const { stdout } = await run(dir, 'read big.txt')
  assert.equal(stdout.trim(), '')
})

test('cap + prioritize → at most MAX_REFS, biggest two chosen', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: 'test-model', savingTier: 'balanced' }))
  const dir = makeDir()
  writeFile(dir, 'big.txt', 6000)
  writeFile(dir, 'mid.txt', 5000)
  writeFile(dir, 'least.txt', 4000) // still above floor, but smallest → dropped
  const before = srv.requests.length

  const { stdout } = await run(dir, 'compare big.txt mid.txt least.txt')
  const ctxText = JSON.parse(stdout).hookSpecificOutput.additionalContext
  assert.match(ctxText, /big\.txt/)
  assert.match(ctxText, /mid\.txt/)
  assert.doesNotMatch(ctxText, /least\.txt/)
  assert.equal(chatBodiesSince(before).length, 2, 'one single-pass call per chosen ref')
})

test('oversize file → single pass, marked truncated (no map-reduce fan-out)', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: 'test-model', savingTier: 'balanced' }))
  const dir = makeDir()
  writeFile(dir, 'huge.log', 200 * 1024) // beyond MAX_READ_BYTES and single-pass budget
  const before = srv.requests.length

  const { stdout } = await run(dir, 'triage huge.log')
  const ctxText = JSON.parse(stdout).hookSpecificOutput.additionalContext
  assert.match(ctxText, /huge\.log/)
  assert.match(ctxText, /truncated/)
  assert.equal(chatBodiesSince(before).length, 1, 'exactly one call — truncated, not folded')
})
