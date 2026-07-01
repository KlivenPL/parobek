// Integration: local-model.mjs command (list / status / preset / set model).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { redirectHome, cleanupHome, seedConfig } from './helpers/env.mjs'
import { runScript } from './helpers/run.mjs'
import { startMockServer } from './helpers/mock-server.mjs'
import { makeConfig } from './helpers/fixtures.mjs'

const ctx = redirectHome()
let srv
before(async () => {
  srv = await startMockServer({ models: [{ id: 'loaded-a', context_length: 9000 }] })
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: '' }))
})
after(async () => {
  await srv.close()
  cleanupHome(ctx.home)
})

const readDisk = () => JSON.parse(readFileSync(join(ctx.stateDir, 'config.json'), 'utf8'))

test('status: prints the effective config', async () => {
  const { stdout } = await runScript('local-model.mjs', { arg: 'status', home: ctx.home })
  assert.match(stdout, /\[Parobek\] configuration:/)
  assert.match(stdout, /endpoint:/)
  assert.match(stdout, /provider:\s+lmstudio/)
})

test('list: shows available models from the server', async () => {
  const { stdout } = await runScript('local-model.mjs', { arg: 'list', home: ctx.home })
  assert.match(stdout, /local model server/)
  assert.match(stdout, /loaded-a/)
  assert.match(stdout, /ctx 9000/)
})

test('preset: switches endpoint/provider and persists', async () => {
  const { stdout } = await runScript('local-model.mjs', { arg: 'preset ollama', home: ctx.home })
  assert.match(stdout, /Switched to preset "ollama"/)
  const disk = readDisk()
  assert.equal(disk.provider, 'ollama')
  assert.match(disk.endpoint, /11434/)
  // Restore endpoint for later tests.
  seedConfig(ctx.stateDir, makeConfig(srv.url, { model: '' }))
})

test('preset: unknown name is rejected', async () => {
  const { stdout } = await runScript('local-model.mjs', { arg: 'preset nope', home: ctx.home })
  assert.match(stdout, /Unknown preset "nope"/)
})

test('set model: not-in-list still set anyway, persisted', async () => {
  const { stdout } = await runScript('local-model.mjs', { arg: 'mystery-model', home: ctx.home })
  assert.match(stdout, /not in the server's loaded model list/)
  assert.match(stdout, /Local model set to: mystery-model/)
  assert.equal(readDisk().model, 'mystery-model')
})

test('set model: matching id auto-sizes localContextTokens + maxOutputTokens', async () => {
  const { stdout } = await runScript('local-model.mjs', { arg: 'loaded-a', home: ctx.home })
  assert.match(stdout, /Local model set to: loaded-a/)
  assert.match(stdout, /detected context window: 9000 tokens/)
  const disk = readDisk()
  assert.equal(disk.model, 'loaded-a')
  assert.equal(disk.localContextTokens, 9000)
  assert.equal(disk.maxOutputTokens, 2250) // deriveMaxOutputTokens(9000) = round(2250)
})
