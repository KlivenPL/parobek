// Integration: local-config.mjs command (status / reload / reset).
// The default no-arg path spawns an OS editor and is intentionally NOT tested.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { redirectHome, cleanupHome, seedConfig } from './helpers/env.mjs'
import { runScript } from './helpers/run.mjs'
import { makeConfig } from './helpers/fixtures.mjs'

const ctx = redirectHome()
after(() => cleanupHome(ctx.home))
before(() => seedConfig(ctx.stateDir, makeConfig('http://127.0.0.1:1/v1', { model: 'seeded-model' })))

test('status: validates and prints the config', async () => {
  const { stdout } = await runScript('local-config.mjs', { arg: 'status', home: ctx.home })
  assert.match(stdout, /config loaded OK/)
  assert.match(stdout, /model:\s+seeded-model/)
})

test('reload: alias of status', async () => {
  const { stdout } = await runScript('local-config.mjs', { arg: 'reload', home: ctx.home })
  assert.match(stdout, /config loaded OK/)
})

test('reset: backs up the old file and writes defaults', async () => {
  const { stdout } = await runScript('local-config.mjs', { arg: 'reset', home: ctx.home })
  assert.match(stdout, /config reset to built-in defaults/)
  assert.match(stdout, /backed up to/)
  // A timestamped .bak.json now exists alongside a defaults config.
  const backups = readdirSync(ctx.stateDir).filter((f) => f.endsWith('.bak.json'))
  assert.equal(backups.length, 1)
  const live = JSON.parse(readFileSync(join(ctx.stateDir, 'config.json'), 'utf8'))
  assert.equal(live.model, '') // back to default
})
