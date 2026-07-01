// Integration: record-session.mjs hook (SessionStart + UserPromptSubmit).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { redirectHome, cleanupHome } from './helpers/env.mjs'
import { runScript } from './helpers/run.mjs'

const ctx = redirectHome()
after(() => cleanupHome(ctx.home))

const CWD = 'c:/proj/record'
const hash = createHash('sha1').update(CWD).digest('hex').slice(0, 16)
const sessionFile = join(ctx.stateDir, `session-${hash}.json`)
const warnFile = join(ctx.stateDir, `warn-${hash}.json`)

test('writes a session record when transcript_path is present', async () => {
  await runScript('record-session.mjs', {
    home: ctx.home,
    stdin: JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-1',
      transcript_path: '/path/t.jsonl',
      cwd: CWD,
    }),
  })
  assert.ok(existsSync(sessionFile))
})

test('SessionStart clears existing warn flags', async () => {
  mkdirSync(ctx.stateDir, { recursive: true })
  writeFileSync(warnFile, JSON.stringify({ fired: [0.7] }), 'utf8')
  await runScript('record-session.mjs', {
    home: ctx.home,
    stdin: JSON.stringify({
      hook_event_name: 'SessionStart',
      source: 'startup',
      transcript_path: '/path/t.jsonl',
      cwd: CWD,
    }),
  })
  assert.equal(existsSync(warnFile), false)
})

test('no transcript_path -> no session record written', async () => {
  const cwd2 = 'c:/proj/no-transcript'
  const h2 = createHash('sha1').update(cwd2).digest('hex').slice(0, 16)
  await runScript('record-session.mjs', {
    home: ctx.home,
    stdin: JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: cwd2 }),
  })
  assert.equal(existsSync(join(ctx.stateDir, `session-${h2}.json`)), false)
})
