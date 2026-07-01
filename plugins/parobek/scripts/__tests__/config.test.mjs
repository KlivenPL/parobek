import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { redirectHome, cleanupHome } from './helpers/env.mjs'

// Redirect HOME before importing config so STATE_DIR lands in the temp dir.
const ctx = redirectHome()
const {
  readConfig,
  readConfigSafe,
  writeConfig,
  resetConfig,
  configSummaryLines,
  ConfigError,
  DEFAULT_CONFIG,
  PRESETS,
  TIER_PRESETS,
  resolveTier,
  featureEnabled,
  commandTierExceeds,
  COMMAND_TIER,
  commandTierWarning,
  warnIfTierExceeds,
  CONFIG_PATH,
} = await import('../lib/config.mjs')

after(() => cleanupHome(ctx.home))

function rmConfig() {
  if (existsSync(CONFIG_PATH)) rmSync(CONFIG_PATH)
}
function writeRaw(text) {
  mkdirSync(ctx.stateDir, { recursive: true })
  writeFileSync(CONFIG_PATH, text, 'utf8')
}

test('CONFIG_PATH resolves under the redirected temp home', () => {
  assert.equal(CONFIG_PATH, ctx.configPath)
})

test('readConfig: missing file -> bare defaults (presets overlay only on a parsed file)', () => {
  rmConfig()
  const cfg = readConfig()
  assert.equal(cfg.endpoint, DEFAULT_CONFIG.endpoint)
  assert.equal(cfg.model, '')
  assert.equal(cfg.presets, undefined)
  // Once a file exists, readConfig overlays the code-owned built-ins.
  writeConfig({ ...DEFAULT_CONFIG })
  assert.deepEqual(Object.keys(readConfig().presets).sort(), Object.keys(PRESETS).sort())
})

test('writeConfig + readConfig: round-trips user values', () => {
  rmConfig()
  writeConfig({ ...DEFAULT_CONFIG, model: 'my-model', temperature: 0.7 })
  const cfg = readConfig()
  assert.equal(cfg.model, 'my-model')
  assert.equal(cfg.temperature, 0.7)
})

test('writeConfig: strips built-in preset names, keeps custom ones', () => {
  rmConfig()
  writeConfig({
    ...DEFAULT_CONFIG,
    presets: {
      lmstudio: { endpoint: 'http://tampered', apiKey: 'x', provider: 'lmstudio' },
      mybox: { endpoint: 'http://192.168.0.5:1234/v1', apiKey: 'k', provider: 'openai' },
    },
  })
  const onDisk = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  // Built-in name not persisted; custom one kept.
  assert.equal(onDisk.presets.lmstudio, undefined)
  assert.ok(onDisk.presets.mybox)
  // readConfig re-overlays code-owned built-ins, so both are visible at runtime.
  const cfg = readConfig()
  assert.equal(cfg.presets.lmstudio.endpoint, PRESETS.lmstudio.endpoint)
  assert.equal(cfg.presets.mybox.endpoint, 'http://192.168.0.5:1234/v1')
})

test('writeConfig: drops the presets key entirely when only built-ins remain', () => {
  rmConfig()
  writeConfig({ ...DEFAULT_CONFIG, presets: { ...PRESETS } })
  const onDisk = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  assert.equal('presets' in onDisk, false)
})

test('readConfig: corrupt JSON throws ConfigError; readConfigSafe falls back', () => {
  writeRaw('{ not valid json ')
  assert.throws(() => readConfig(), (err) => {
    assert.ok(err instanceof ConfigError)
    assert.equal(err.path, CONFIG_PATH)
    return true
  })
  const { config, error } = readConfigSafe()
  assert.equal(config.endpoint, DEFAULT_CONFIG.endpoint)
  assert.match(error, /not valid JSON/)
})

test('resetConfig: no existing file -> backupPath null, defaults written', () => {
  rmConfig()
  const { config, backupPath } = resetConfig()
  assert.equal(backupPath, null)
  assert.equal(config.model, '')
  assert.ok(existsSync(CONFIG_PATH))
})

test('resetConfig: existing file -> timestamped backup created', () => {
  writeConfig({ ...DEFAULT_CONFIG, model: 'to-be-backed-up' })
  const { backupPath } = resetConfig()
  assert.ok(backupPath)
  assert.match(backupPath, /\.bak\.json$/)
  assert.ok(existsSync(backupPath))
  const backed = JSON.parse(readFileSync(backupPath, 'utf8'))
  assert.equal(backed.model, 'to-be-backed-up')
  // The live file is back to defaults.
  assert.equal(readConfig().model, '')
})

test('configSummaryLines: empty model shows (none); lists presets', () => {
  const lines = configSummaryLines({ ...DEFAULT_CONFIG, model: '', presets: PRESETS })
  assert.equal(lines[0], 'configuration:')
  assert.ok(lines.some((l) => /model:\s+\(none\)/.test(l)))
  assert.ok(lines.some((l) => /presets:.*lmstudio/.test(l)))
})

test('configSummaryLines: tolerates missing presets key', () => {
  const cfg = { ...DEFAULT_CONFIG }
  delete cfg.presets
  const lines = configSummaryLines(cfg)
  assert.ok(lines.some((l) => /presets:.*lmstudio/.test(l)))
})

// ---- Tier config foundation (F1.1) ----

test('DEFAULT_CONFIG.savingTier defaults to safe', () => {
  assert.equal(DEFAULT_CONFIG.savingTier, 'safe')
})

test('resolveTier: each built-in preset resolves to its level/name', () => {
  for (const [key, { level, name }] of Object.entries(TIER_PRESETS)) {
    assert.deepEqual(resolveTier({ savingTier: key }), { key, level, name })
  }
})

test('resolveTier: unknown or missing savingTier falls back to safe', () => {
  assert.equal(resolveTier({ savingTier: 'bogus' }).key, 'safe')
  assert.equal(resolveTier({}).key, 'safe')
  assert.equal(resolveTier(undefined).key, 'safe')
})

test('featureEnabled: gates by configured level across tiers', () => {
  const safe = { savingTier: 'safe' }
  const balanced = { savingTier: 'balanced' }
  const max = { savingTier: 'max' }
  // tier-1 feature on at every tier
  assert.equal(featureEnabled(safe, 'local-commit'), true)
  // tier-2 feature off at safe, on from balanced up
  assert.equal(featureEnabled(safe, 'tier-guidance'), false)
  assert.equal(featureEnabled(balanced, 'tier-guidance'), true)
  // tier-3 feature only at max
  assert.equal(featureEnabled(safe, 'local-ask'), false)
  assert.equal(featureEnabled(balanced, 'local-ask'), false)
  assert.equal(featureEnabled(max, 'local-ask'), true)
  // unknown feature is never enabled
  assert.equal(featureEnabled(max, 'no-such-feature'), false)
})

test('featureEnabled: honors a user override of a tier feature set', () => {
  // Re-tier a max-only feature down into safe via a config override.
  const cfg = {
    savingTier: 'safe',
    tiers: { ...TIER_PRESETS, safe: { ...TIER_PRESETS.safe, features: [...TIER_PRESETS.safe.features, 'local-ask'] } },
  }
  assert.equal(featureEnabled(cfg, 'local-ask'), true)
})

test('commandTierExceeds: true only when command tier is above configured', () => {
  const safe = { savingTier: 'safe' }
  assert.equal(commandTierExceeds(safe, 3), true)
  assert.equal(commandTierExceeds(safe, 1), false)
  assert.equal(commandTierExceeds({ savingTier: 'max' }, 3), false)
})

test('writeConfig: strips built-in tier names, keeps custom ones', () => {
  rmConfig()
  writeConfig({
    ...DEFAULT_CONFIG,
    tiers: {
      safe: { level: 1, name: 'Tampered', features: [] },
      paranoid: { level: 4, name: 'Paranoid', features: ['local-commit'] },
    },
  })
  const onDisk = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  assert.equal(onDisk.tiers.safe, undefined)
  assert.ok(onDisk.tiers.paranoid)
  // readConfig re-overlays code-owned built-ins; custom tier survives.
  const cfg = readConfig()
  assert.equal(cfg.tiers.safe.name, TIER_PRESETS.safe.name)
  assert.equal(cfg.tiers.paranoid.level, 4)
})

test('writeConfig: drops the tiers key entirely when only built-ins remain', () => {
  rmConfig()
  writeConfig({ ...DEFAULT_CONFIG, tiers: { ...TIER_PRESETS } })
  const onDisk = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  assert.equal('tiers' in onDisk, false)
})

test('configSummaryLines: shows the savingTier line and tiers list', () => {
  const lines = configSummaryLines({ ...DEFAULT_CONFIG, savingTier: 'balanced', tiers: TIER_PRESETS })
  assert.ok(lines.some((l) => /savingTier:\s+balanced \(Balanced, lvl 2\)/.test(l)))
  assert.ok(lines.some((l) => /tiers:.*safe.*balanced.*max/.test(l)))
})

// ---- Command-tier warnings (F1.3) ----

test('COMMAND_TIER: maps known commands; tier-0 infra commands absent', () => {
  assert.equal(COMMAND_TIER['local-compact'], 2)
  assert.equal(COMMAND_TIER['local-commit'], 1)
  assert.equal(COMMAND_TIER['local-index'], 1)
  assert.equal(COMMAND_TIER['local-handoff'], 2)
  assert.equal(COMMAND_TIER['local-ask'], 3)
  // Infra commands never warn -> never listed.
  assert.equal('local-model' in COMMAND_TIER, false)
  assert.equal('local-config' in COMMAND_TIER, false)
  assert.equal('local-tier' in COMMAND_TIER, false)
})

test('commandTierWarning: warns when the command tier exceeds the configured one', () => {
  const w = commandTierWarning({ savingTier: 'safe' }, 'local-ask')
  assert.match(w, /^\/local-ask runs at tier 3 \(Max\)/)
  assert.match(w, /above your configured tier 1 \(Safe\)/)
  assert.match(w, /output quality may fall below what you set\.$/)
})

test('commandTierWarning: null at or below the configured tier', () => {
  // local-compact is tier 2: warns under safe, silent at balanced and max.
  assert.match(commandTierWarning({ savingTier: 'safe' }, 'local-compact'), /tier 2 \(Balanced\)/)
  assert.equal(commandTierWarning({ savingTier: 'balanced' }, 'local-compact'), null)
  assert.equal(commandTierWarning({ savingTier: 'max' }, 'local-compact'), null)
  // tier-3 command is silent only once configured at max.
  assert.equal(commandTierWarning({ savingTier: 'max' }, 'local-ask'), null)
})

test('commandTierWarning: unknown or tier-0 command never warns', () => {
  assert.equal(commandTierWarning({ savingTier: 'safe' }, 'bogus'), null)
  assert.equal(commandTierWarning({ savingTier: 'safe' }, 'local-model'), null)
})

test('commandTierWarning: tier name honors a user override of a tier set', () => {
  // Rename the level-3 tier via a config override; the warning reflects it.
  const cfg = {
    savingTier: 'safe',
    tiers: { ...TIER_PRESETS, max: { ...TIER_PRESETS.max, name: 'Reckless' } },
  }
  assert.match(commandTierWarning(cfg, 'local-ask'), /tier 3 \(Reckless\)/)
})

test('warnIfTierExceeds: prints the branded line when above tier, silent within', () => {
  const logged = []
  const orig = console.log
  console.log = (m) => logged.push(m)
  try {
    warnIfTierExceeds({ savingTier: 'safe' }, 'local-compact')
    warnIfTierExceeds({ savingTier: 'balanced' }, 'local-compact') // within tier -> no-op
  } finally {
    console.log = orig
  }
  assert.equal(logged.length, 1)
  assert.match(logged[0], /^\[Parobek\] \/local-compact runs at tier 2 \(Balanced\)/)
})
