// Integration: local-commit.mjs against a real throwaway git repo + the mock
// local server. Verifies the draft/apply split, the staged-diff guard, the
// context default vs --no-context, the verbosity flag plumbing, and map-reduce.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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
  srv = await startMockServer({ chat: 'feat(core): do the thing\n\n- add a\n- tweak b' })
})

const repos = []
after(async () => {
  await srv.close()
  cleanupHome(ctx.home)
  for (const d of repos) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

/** Create an isolated git repo and return { dir, g } (g runs git in it). */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'parobek-git-'))
  repos.push(dir)
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  g(['init', '-q'])
  g(['config', 'user.email', 'tester@example.com'])
  g(['config', 'user.name', 'Tester'])
  g(['config', 'commit.gpgsign', 'false'])
  return { dir, g }
}

/** Chat-completion request bodies logged by the mock since index `from`. */
function chatBodiesSince(from) {
  return srv.requests
    .slice(from)
    .filter((r) => r.method === 'POST' && r.path === '/v1/chat/completions')
    .map((r) => r.body)
}

async function recordSession(dir, txPath) {
  await runScript('record-session.mjs', {
    home: ctx.home,
    cwd: dir,
    stdin: JSON.stringify({ hook_event_name: 'UserPromptSubmit', transcript_path: txPath }),
  })
}

test('nothing staged -> guard message, no commit', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: 'test-model' }))
  const { dir } = makeRepo()
  const { stdout } = await runScript('local-commit.mjs', { arg: '', home: ctx.home, cwd: dir })
  assert.match(stdout, /Nothing staged/i)
})

test('bare draft -> prints message, creates no commit', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: 'test-model' }))
  const { dir, g } = makeRepo()
  writeFileSync(join(dir, 'a.txt'), 'hello\n', 'utf8')
  g(['add', 'a.txt'])

  const { stdout } = await runScript('local-commit.mjs', { arg: '', home: ctx.home, cwd: dir })
  assert.match(stdout, /feat\(core\): do the thing/)
  assert.match(stdout, /Run \/local-commit apply/)
  assert.equal(g(['rev-list', '--all', '--count']).trim(), '0')
})

test('apply -> creates a commit carrying the drafted message', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: 'test-model' }))
  const { dir, g } = makeRepo()
  writeFileSync(join(dir, 'a.txt'), 'hello\n', 'utf8')
  g(['add', 'a.txt'])

  const { stdout } = await runScript('local-commit.mjs', { arg: 'apply', home: ctx.home, cwd: dir })
  assert.match(stdout, /Committed [0-9a-f]+: feat\(core\): do the thing/)
  assert.equal(g(['rev-list', '--all', '--count']).trim(), '1')
  assert.match(g(['log', '-1', '--pretty=%B']), /feat\(core\): do the thing[\s\S]*- add a/)
})

test('context default vs --no-context controls whether the transcript is sent', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: 'test-model' }))
  const { dir, g } = makeRepo()
  writeFileSync(join(dir, 'a.txt'), 'hello\n', 'utf8')
  g(['add', 'a.txt'])
  const tx = join(dir, 't.jsonl')
  writeFileSync(
    tx,
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'We must FIX_NULLPTR_MARKER first' } }),
    'utf8',
  )
  await recordSession(dir, tx)

  const beforeA = srv.requests.length
  await runScript('local-commit.mjs', { arg: '', home: ctx.home, cwd: dir })
  const withCtx = JSON.stringify(chatBodiesSince(beforeA))
  assert.match(withCtx, /FIX_NULLPTR_MARKER/)

  const beforeB = srv.requests.length
  await runScript('local-commit.mjs', { arg: '--no-context', home: ctx.home, cwd: dir })
  const noCtx = JSON.stringify(chatBodiesSince(beforeB))
  assert.doesNotMatch(noCtx, /FIX_NULLPTR_MARKER/)
})

test('verbosity flag changes the instruction sent to the model', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: 'test-model' }))
  const { dir, g } = makeRepo()
  writeFileSync(join(dir, 'a.txt'), 'hello\n', 'utf8')
  g(['add', 'a.txt'])

  const beforeS = srv.requests.length
  await runScript('local-commit.mjs', { arg: '--no-context', home: ctx.home, cwd: dir })
  assert.match(JSON.stringify(chatBodiesSince(beforeS)), /bullet/i)

  const beforeF = srv.requests.length
  await runScript('local-commit.mjs', { arg: '--full --no-context', home: ctx.home, cwd: dir })
  assert.match(JSON.stringify(chatBodiesSince(beforeF)), /prose/i)
})

test('huge diff -> map-reduce makes multiple local calls', async () => {
  seedConfig(
    ctx.stateDir,
    makeConfig(srv.url, { model: 'test-model', localContextTokens: 600, maxOutputTokens: 256 }),
  )
  const { dir, g } = makeRepo()
  for (const name of ['f1.txt', 'f2.txt', 'f3.txt']) {
    writeFileSync(join(dir, name), 'x'.repeat(1200) + '\n', 'utf8')
  }
  g(['add', '.'])

  const before = srv.requests.length
  await runScript('local-commit.mjs', { arg: '--no-context', home: ctx.home, cwd: dir })
  assert.ok(chatBodiesSince(before).length > 1, 'expected >1 chat calls for map-reduce')
})
