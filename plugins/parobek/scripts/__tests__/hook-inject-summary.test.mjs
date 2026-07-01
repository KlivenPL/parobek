// Integration: inject-summary.mjs hook — the 5 trigger safety guards.
import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { redirectHome, cleanupHome, seedConfig } from './helpers/env.mjs'
import { runScript } from './helpers/run.mjs'
import { makeConfig } from './helpers/fixtures.mjs'

const ctx = redirectHome()
after(() => cleanupHome(ctx.home))

const CWD = 'c:/proj/inject'
const hash = createHash('sha1').update(CWD).digest('hex').slice(0, 16)
const pendingFile = join(ctx.stateDir, `pending-summary-${hash}.json`)

function writePending(ageMs = 0) {
  mkdirSync(ctx.stateDir, { recursive: true })
  writeFileSync(
    pendingFile,
    JSON.stringify({
      createdAt: Date.now() - ageMs,
      sourceSessionId: 'abcd1234efgh',
      model: 'test-model',
      summary: 'THE LOCAL SUMMARY BODY',
      passes: 1,
    }),
    'utf8',
  )
}

function clearInput(source = 'clear') {
  return JSON.stringify({ hook_event_name: 'SessionStart', source, cwd: CWD })
}

beforeEach(() => {
  // Fresh config (pendingTtlMs default) and no pending file.
  seedConfig(ctx.stateDir, makeConfig('http://127.0.0.1:1/v1'))
  if (existsSync(pendingFile)) rmSync(pendingFile)
})

test('guard 1: non-clear source never injects (no output, pending kept)', async () => {
  writePending()
  const { stdout } = await runScript('inject-summary.mjs', {
    home: ctx.home,
    stdin: clearInput('startup'),
  })
  assert.equal(stdout.trim(), '')
  assert.ok(existsSync(pendingFile)) // not consumed
})

test('guard 2: no pending summary -> silent no-op', async () => {
  const { stdout } = await runScript('inject-summary.mjs', {
    home: ctx.home,
    stdin: clearInput('clear'),
  })
  assert.equal(stdout.trim(), '')
})

test('guards 3+4: expired pending -> discarded with notice, file removed', async () => {
  writePending(30 * 60 * 1000) // 30 min old > 15 min TTL
  const { stdout } = await runScript('inject-summary.mjs', {
    home: ctx.home,
    stdin: clearInput('clear'),
  })
  const out = JSON.parse(stdout)
  assert.match(out.systemMessage, /expired/)
  assert.equal(existsSync(pendingFile), false)
})

test('guards 4+5: fresh pending -> labeled injection, single-consume', async () => {
  writePending(60 * 1000) // 1 min old, fresh
  const { stdout } = await runScript('inject-summary.mjs', {
    home: ctx.home,
    stdin: clearInput('clear'),
  })
  const out = JSON.parse(stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.match(out.hookSpecificOutput.additionalContext, /\[Parobek\] Local summary by test-model/)
  assert.match(out.hookSpecificOutput.additionalContext, /THE LOCAL SUMMARY BODY/)
  assert.match(out.systemMessage, /compacted context loaded/)
  // Single-consume: pending deleted so a second clear injects nothing.
  assert.equal(existsSync(pendingFile), false)
  const second = await runScript('inject-summary.mjs', {
    home: ctx.home,
    stdin: clearInput('clear'),
  })
  assert.equal(second.stdout.trim(), '')
})
