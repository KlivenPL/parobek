// Integration: local-tier.mjs command (status / switch / unknown).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { redirectHome, cleanupHome, seedConfig } from './helpers/env.mjs'
import { runScript } from './helpers/run.mjs'
import { makeConfig } from './helpers/fixtures.mjs'

const ctx = redirectHome()
before(() => {
  // Fresh config defaults to the Safe tier. No mock server — this command never
  // contacts the local model.
  seedConfig(ctx.stateDir, makeConfig('http://unused', { savingTier: 'safe' }))
})
after(() => cleanupHome(ctx.home))

const readDisk = () => JSON.parse(readFileSync(join(ctx.stateDir, 'config.json'), 'utf8'))

test('status: shows current tier, active features and selectable tiers', async () => {
  const { stdout } = await runScript('local-tier.mjs', { arg: 'status', home: ctx.home })
  assert.match(stdout, /\[Parobek\] saving tier: safe \(Safe, lvl 1\)/)
  assert.match(stdout, /active features:/)
  assert.match(stdout, /- local-commit/)
  assert.match(stdout, /available tiers:/)
  assert.match(stdout, /safe\s+\(lvl 1\)\s+<- current/)
  assert.match(stdout, /balanced\s+\(lvl 2\)/)
  assert.match(stdout, /max\s+\(lvl 3\)/)
})

test('bare invocation aliases status', async () => {
  const { stdout } = await runScript('local-tier.mjs', { arg: '', home: ctx.home })
  assert.match(stdout, /saving tier: safe/)
  assert.match(stdout, /available tiers:/)
})

test('switch: sets the tier and persists without writing built-in tiers', async () => {
  const { stdout } = await runScript('local-tier.mjs', { arg: 'balanced', home: ctx.home })
  assert.match(stdout, /saving tier set to: balanced \(Balanced, lvl 2\)/)
  // Balanced adds the file-predigest feature on top of Safe's set.
  assert.match(stdout, /- file-predigest/)
  const disk = readDisk()
  assert.equal(disk.savingTier, 'balanced')
  // Built-in tiers are code-owned; they must never be persisted to the file.
  assert.equal(disk.tiers, undefined)
})

test('status after switch: marks the new tier as current', async () => {
  const { stdout } = await runScript('local-tier.mjs', { arg: 'status', home: ctx.home })
  assert.match(stdout, /saving tier: balanced \(Balanced, lvl 2\)/)
  assert.match(stdout, /balanced\s+\(lvl 2\)\s+<- current/)
})

test('unknown tier: rejected, config unchanged', async () => {
  const before = readDisk().savingTier
  const { stdout } = await runScript('local-tier.mjs', { arg: 'turbo', home: ctx.home })
  assert.match(stdout, /Unknown tier "turbo"/)
  assert.match(stdout, /Valid tiers: .*safe.*balanced.*max/)
  assert.equal(readDisk().savingTier, before)
})
