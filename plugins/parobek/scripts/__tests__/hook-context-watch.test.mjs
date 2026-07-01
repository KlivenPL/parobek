// Integration: context-watch.mjs hook — tiered, debounced context warnings.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { redirectHome, cleanupHome, seedConfig } from './helpers/env.mjs'
import { runScript } from './helpers/run.mjs'
import { makeConfig, turn, writeTranscript } from './helpers/fixtures.mjs'

const ctx = redirectHome()
after(() => cleanupHome(ctx.home))

// budget = max(512, 2048 - 2048 - 1500) = 512 (floor). 0.7 -> ~358 tok, 0.9 -> ~461 tok.
before(() =>
  seedConfig(
    ctx.stateDir,
    makeConfig('http://127.0.0.1:1/v1', {
      localContextTokens: 2048,
      maxOutputTokens: 2048,
    }),
  ),
)

function input(cwd, transcriptPath) {
  return JSON.stringify({
    hook_event_name: 'UserPromptSubmit',
    cwd,
    transcript_path: transcriptPath,
  })
}

test('below all tiers -> silent', async () => {
  const tx = writeTranscript(ctx.home, [turn('user', 'x'.repeat(300))], 'small.jsonl') // ~79 tok
  const { stdout } = await runScript('context-watch.mjs', {
    home: ctx.home,
    stdin: input('c:/proj/cw-small', tx),
  })
  assert.equal(stdout.trim(), '')
})

test('crossing the top tier fires the 0.9 warning, then debounces', async () => {
  const tx = writeTranscript(ctx.home, [turn('user', 'x'.repeat(2000))], 'big.jsonl') // ~504 tok
  const cwd = 'c:/proj/cw-big'

  const first = await runScript('context-watch.mjs', { home: ctx.home, stdin: input(cwd, tx) })
  const out = JSON.parse(first.stdout)
  assert.match(out.systemMessage, /⚠️/)
  assert.match(out.systemMessage, /single-pass/)

  // Second run, same cwd: both tiers already fired -> no further warning.
  const second = await runScript('context-watch.mjs', { home: ctx.home, stdin: input(cwd, tx) })
  assert.equal(second.stdout.trim(), '')
})

test('no transcript_path -> silent', async () => {
  const { stdout } = await runScript('context-watch.mjs', {
    home: ctx.home,
    stdin: JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: 'c:/x' }),
  })
  assert.equal(stdout.trim(), '')
})
