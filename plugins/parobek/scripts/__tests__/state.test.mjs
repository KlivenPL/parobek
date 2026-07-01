import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { redirectHome, cleanupHome } from './helpers/env.mjs'

const ctx = redirectHome()
const state = await import('../lib/state.mjs')

after(() => cleanupHome(ctx.home))

const CWD = 'c:/some/project'

test('cwdHash: deterministic 16-hex, empty cwd hashes to empty string', () => {
  const h = state.cwdHash(CWD)
  assert.match(h, /^[0-9a-f]{16}$/)
  assert.equal(state.cwdHash(CWD), h) // stable
  assert.notEqual(state.cwdHash('c:/other'), h)
  assert.match(state.cwdHash(''), /^[0-9a-f]{16}$/) // empty -> hash of ''
})

test('session record: write -> read round-trip, stamped with cwd + updatedAt', () => {
  state.writeSessionRecord(CWD, { session_id: 's1', transcript_path: '/t.jsonl' })
  const rec = state.readSessionRecord(CWD)
  assert.equal(rec.session_id, 's1')
  assert.equal(rec.transcript_path, '/t.jsonl')
  assert.equal(rec.cwd, CWD)
  assert.equal(typeof rec.updatedAt, 'number')
})

test('readSessionRecord: unknown cwd -> null', () => {
  assert.equal(state.readSessionRecord('c:/never/written'), null)
})

test('pending summary: write/read/clear', () => {
  state.writePendingSummary(CWD, { createdAt: 123, model: 'm', summary: 'S', passes: 2 })
  assert.equal(state.readPendingSummary(CWD).summary, 'S')
  state.clearPendingSummary(CWD)
  assert.equal(state.readPendingSummary(CWD), null)
})

test('warn flags: default {fired:[]}, write/read/clear', () => {
  assert.deepEqual(state.readWarnFlags(CWD), { fired: [] })
  state.writeWarnFlags(CWD, { fired: [0.7] })
  assert.deepEqual(state.readWarnFlags(CWD), { fired: [0.7] })
  state.clearWarnFlags(CWD)
  assert.deepEqual(state.readWarnFlags(CWD), { fired: [] })
})

test('corrupt state file -> readJson returns null (default applied)', () => {
  // warn file for a fresh cwd, hand-corrupted.
  const cwd = 'c:/corrupt/case'
  const path = join(ctx.stateDir, `warn-${state.cwdHash(cwd)}.json`)
  writeFileSync(path, '{bad json', 'utf8')
  assert.deepEqual(state.readWarnFlags(cwd), { fired: [] })
})

test('state files are written under the redirected temp dir', () => {
  state.writeSessionRecord(CWD, { session_id: 'x', transcript_path: '/y' })
  const path = join(ctx.stateDir, `session-${state.cwdHash(CWD)}.json`)
  assert.ok(existsSync(path))
})
