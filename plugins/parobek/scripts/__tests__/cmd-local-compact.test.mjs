// Integration: local-compact.mjs command (status + single-pass + map-reduce).
//
// local-compact keys its session/pending state by process.cwd(), so each run is
// spawned with a fixed `cwd`; the session record is created by spawning
// record-session.mjs with the SAME cwd (no cwd in stdin, so it also uses
// process.cwd()) — guaranteeing identical hash keys.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { redirectHome, cleanupHome, seedConfig } from './helpers/env.mjs'
import { runScript } from './helpers/run.mjs'
import { startMockServer } from './helpers/mock-server.mjs'
import { makeConfig, turn, bulkyTranscriptLines } from './helpers/fixtures.mjs'

const ctx = redirectHome()
let srv
before(async () => {
  srv = await startMockServer({ chat: 'A LOCAL SUMMARY.' })
})
const workDirs = []
after(async () => {
  await srv.close()
  cleanupHome(ctx.home)
  for (const d of workDirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

function newWorkDir() {
  const d = mkdtempSync(join(tmpdir(), 'parobek-work-'))
  workDirs.push(d)
  return d
}

async function recordSession(workDir, txPath) {
  await runScript('record-session.mjs', {
    home: ctx.home,
    cwd: workDir,
    stdin: JSON.stringify({ hook_event_name: 'UserPromptSubmit', transcript_path: txPath }),
  })
}

function pendingFiles() {
  return readdirSync(ctx.stateDir).filter((f) => f.startsWith('pending-summary-'))
}

test('status: no pending summary for a fresh folder', async () => {
  const work = newWorkDir()
  const { stdout } = await runScript('local-compact.mjs', { arg: 'status', home: ctx.home, cwd: work })
  assert.match(stdout, /No pending local summary/)
})

test('single pass: small conversation -> 1 pass, pending summary written', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: 'test-model' }))
  const work = newWorkDir()
  const tx = join(work, 't.jsonl')
  writeFileSync(tx, [turn('user', 'Please help.'), turn('assistant', 'Sure.')].join('\n'), 'utf8')
  await recordSession(work, tx)

  const before = pendingFiles().length
  const { stdout } = await runScript('local-compact.mjs', { arg: '', home: ctx.home, cwd: work })
  assert.match(stdout, /Local summary ready/)
  assert.match(stdout, /1 pass,/)
  assert.match(stdout, /0 Anthropic tokens/)
  assert.equal(pendingFiles().length, before + 1)

  // The written pending file carries the model's summary text.
  const file = pendingFiles().find(Boolean)
  const pending = JSON.parse(readFileSync(join(ctx.stateDir, file), 'utf8'))
  assert.match(pending.summary, /A LOCAL SUMMARY\./)
})

test('map-reduce: bulky conversation + tiny context -> multiple passes', async () => {
  seedConfig(
    ctx.stateDir,
    makeConfig(srv.url, { model: 'test-model', localContextTokens: 2048, maxOutputTokens: 2048 }),
  )
  const work = newWorkDir()
  const tx = join(work, 'big.jsonl')
  writeFileSync(tx, bulkyTranscriptLines(8, 600).join('\n'), 'utf8')
  await recordSession(work, tx)

  const { stdout } = await runScript('local-compact.mjs', { arg: '', home: ctx.home, cwd: work })
  assert.match(stdout, /Local summary ready/)
  const m = stdout.match(/(\d+) passes/)
  assert.ok(m, `expected a "<n> passes" report, got: ${stdout}`)
  assert.ok(Number(m[1]) > 1, `expected >1 passes, got ${m && m[1]}`)
})

test('tier warning: tier-2 compact under safe config warns before its work', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: 'test-model', savingTier: 'safe' }))
  const work = newWorkDir()
  const tx = join(work, 't.jsonl')
  writeFileSync(tx, [turn('user', 'Please help.'), turn('assistant', 'Sure.')].join('\n'), 'utf8')
  await recordSession(work, tx)

  const { stdout } = await runScript('local-compact.mjs', { arg: '', home: ctx.home, cwd: work })
  // Warning precedes the work, it does not replace it.
  assert.match(stdout, /runs at tier 2 \(Balanced\), above your configured tier 1 \(Safe\)/)
  assert.match(stdout, /Local summary ready/)
})

test('tier warning: silent when configured tier meets the command tier', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: 'test-model', savingTier: 'balanced' }))
  const work = newWorkDir()
  const tx = join(work, 't.jsonl')
  writeFileSync(tx, [turn('user', 'Please help.'), turn('assistant', 'Sure.')].join('\n'), 'utf8')
  await recordSession(work, tx)

  const { stdout } = await runScript('local-compact.mjs', { arg: '', home: ctx.home, cwd: work })
  assert.doesNotMatch(stdout, /output quality may fall below/)
  assert.match(stdout, /Local summary ready/)
})

test('tier warning: status subcommand stays quiet even above tier', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: 'test-model', savingTier: 'safe' }))
  const work = newWorkDir()
  const { stdout } = await runScript('local-compact.mjs', { arg: 'status', home: ctx.home, cwd: work })
  assert.doesNotMatch(stdout, /output quality may fall below/)
})

test('preflight: no model selected -> actionable error', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: '' }))
  const work = newWorkDir()
  const { stdout } = await runScript('local-compact.mjs', { arg: '', home: ctx.home, cwd: work })
  assert.match(stdout, /No local model selected/)
})

test('preflight clamp: server reports a smaller window -> clamps + persists', async () => {
  seedConfig(
    ctx.stateDir,
    makeConfig(srv.url, { model: 'test-model', localContextTokens: 99999, maxOutputTokens: 8192 }),
  )
  const work = newWorkDir()
  const tx = join(work, 't.jsonl')
  writeFileSync(tx, [turn('user', 'Please help.'), turn('assistant', 'Sure.')].join('\n'), 'utf8')
  await recordSession(work, tx)

  const { stdout } = await runScript('local-compact.mjs', { arg: '', home: ctx.home, cwd: work })
  assert.match(stdout, /4096-token context window/)
  assert.match(stdout, /clamping/)
  assert.match(stdout, /Local summary ready/)
  const disk = JSON.parse(readFileSync(join(ctx.stateDir, 'config.json'), 'utf8'))
  assert.equal(disk.localContextTokens, 4096)
  assert.equal(disk.maxOutputTokens, 1024) // deriveMaxOutputTokens(4096) = round(1024)
})

test('degenerate retry: first response loops, retry succeeds -> saved, 2 passes', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: 'test-model' }))
  const work = newWorkDir()
  const tx = join(work, 't.jsonl')
  writeFileSync(tx, [turn('user', 'Please help.'), turn('assistant', 'Sure.')].join('\n'), 'utf8')
  await recordSession(work, tx)

  const loop = Array.from({ length: 30 }, () => 'looping line over and over').join('\n')
  srv.state.chatSequence = [loop, 'A CLEAN SUMMARY.']

  const beforeSet = new Set(pendingFiles())
  const { stdout } = await runScript('local-compact.mjs', { arg: '', home: ctx.home, cwd: work })
  srv.state.chatSequence = null

  assert.match(stdout, /Local summary ready/)
  assert.match(stdout, /2 passes/)
  const file = pendingFiles().find((f) => !beforeSet.has(f))
  assert.ok(file, 'a new pending summary should have been written')
  const pending = JSON.parse(readFileSync(join(ctx.stateDir, file), 'utf8'))
  assert.match(pending.summary, /A CLEAN SUMMARY\./)
})

test('degenerate twice: refuses to save, reports failure', async () => {
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: 'test-model' }))
  const work = newWorkDir()
  const tx = join(work, 't.jsonl')
  writeFileSync(tx, [turn('user', 'Please help.'), turn('assistant', 'Sure.')].join('\n'), 'utf8')
  await recordSession(work, tx)

  const loop = Array.from({ length: 30 }, () => 'looping line over and over').join('\n')
  srv.state.chat = loop // every chat call loops (no sequence)

  const before = pendingFiles().length
  const { stdout } = await runScript('local-compact.mjs', { arg: '', home: ctx.home, cwd: work })
  srv.state.chat = 'A LOCAL SUMMARY.' // restore for any later tests

  assert.match(stdout, /Local compaction failed/)
  assert.match(stdout, /degenerate/)
  assert.equal(pendingFiles().length, before) // nothing written
})
