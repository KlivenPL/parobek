// Configuration management for Parobek.
//
// The config lives OUTSIDE the plugin/repo, under ~/.claude/parobek/config.json,
// so it survives plugin reinstalls and is shared by every /local-* script.
// "Configurable via plugin settings" == this JSON file (a real settings UI is a
// later VS Code-phase concern).

import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { say } from './brand.mjs'

/** Root directory for all Parobek runtime state. */
export const STATE_DIR = join(homedir(), '.claude', 'parobek')

/** Absolute path of the config file. */
export const CONFIG_PATH = join(STATE_DIR, 'config.json')

/**
 * Built-in endpoint presets. LM Studio is the default target; Ollama is included
 * because it also exposes an OpenAI-compatible /v1 API.
 */
export const PRESETS = {
  lmstudio: { endpoint: 'http://localhost:1234/v1', apiKey: 'lm-studio', provider: 'lmstudio' },
  ollama: { endpoint: 'http://localhost:11434/v1', apiKey: 'ollama', provider: 'ollama' },
}

/**
 * Built-in savings tiers (the Safe/Balanced/Max model — see roadmap/tiers.md).
 * Each tier raises how aggressively the local model stands in for Anthropic, so
 * `level` orders them. `features` is CUMULATIVE: a tier lists every feature active
 * at its level (its own plus all lower tiers'), so the set reads as a complete
 * picture of what is on. Gating helpers derive a feature's minimum level from
 * these lists, so they honor user overrides merged from the config file (custom
 * tiers or re-tiered feature sets), and there is no separate map to drift.
 *
 * Code-owned exactly like PRESETS: never persisted (writeConfig strips them), the
 * file may add custom tiers or override a built-in's feature set.
 */
export const TIER_PRESETS = {
  safe: {
    level: 1,
    name: 'Safe',
    features: ['mcp-digest', 'mcp-codesearch', 'local-commit', 'local-index'],
  },
  balanced: {
    level: 2,
    name: 'Balanced',
    features: [
      // safe +
      'mcp-digest', 'mcp-codesearch', 'local-commit', 'local-index',
      'file-predigest', 'big-read-nudge', 'tier-guidance', 'local-handoff',
    ],
  },
  max: {
    level: 3,
    name: 'Max',
    features: [
      // balanced +
      'mcp-digest', 'mcp-codesearch', 'local-commit', 'local-index',
      'file-predigest', 'big-read-nudge', 'tier-guidance', 'local-handoff',
      'big-read-substitute', 'auto-precompact', 'local-ask',
    ],
  },
}

/** Default configuration, written on first run. */
export const DEFAULT_CONFIG = {
  endpoint: PRESETS.lmstudio.endpoint,
  apiKey: PRESETS.lmstudio.apiKey,
  // Which provider module handles this endpoint (lmstudio | ollama | openai).
  // Selects native load-state detection and idle auto-unload behavior. Set by
  // /local-model preset <name>; defaults to LM Studio.
  provider: PRESETS.lmstudio.provider,
  // Selected local model id used by every /local-* command. Empty until the
  // user runs /local-model <id>.
  model: '',
  temperature: 0.2,
  // When the selected model is not currently loaded in the local server:
  //   true  → proceed and let the server JIT-load it on the first request;
  //   false → fail loudly instead of triggering a (slow, RAM-heavy) load.
  autoModelLoad: true,
  // Idle minutes after which the local server unloads the model to free RAM.
  // Mapped to LM Studio's `ttl` field (seconds) on the chat request; the server
  // owns the idle timer, so this works even though our scripts are one-shot.
  // 0 disables it (no `ttl` sent — the server keeps its own default).
  autoUnloadMinutes: 15,
  // Upper bound on tokens the local model may emit for a summary. Kept well
  // below localContextTokens so there is room left for the input (the
  // conversation + compact prompt); otherwise the input budget collapses.
  maxOutputTokens: 2048,
  // Usable context window of the selected local model. Drives map-reduce
  // chunking and the proactive context-size warnings.
  localContextTokens: 8192,
  // Warn the user when the live conversation crosses these fractions of the
  // local single-pass budget (tiered, debounced).
  contextWarnFractions: [0.7, 0.9],
  // How long a locally produced summary stays valid for a following /clear.
  pendingTtlMs: 15 * 60 * 1000,
  // Savings tier: how aggressively the local model stands in for Anthropic
  // (safe | balanced | max — see TIER_PRESETS / roadmap/tiers.md). Auto behaviors
  // (hooks, MCP nudges) self-gate on level >= their feature's tier; commands run
  // regardless but warn when their tier exceeds this. Defaults to the no-risk Safe.
  savingTier: 'safe',
  // /local-commit message verbosity: 'short' (subject + tight bullets) or 'full'
  // (subject + prose body explaining why). Overridable per run with --short/--full.
  commitVerbosity: 'short',
  // Whether /local-commit feeds the recorded conversation context (the "why") to
  // the model alongside the staged diff. Overridable per run with --no-context.
  commitContext: true,
}

/** Ensure the state directory exists. */
export function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true })
}

/** Thrown when the config file exists but is not valid JSON. */
export class ConfigError extends Error {
  constructor(message, { path, cause } = {}) {
    super(message)
    this.name = 'ConfigError'
    this.path = path
    if (cause) this.cause = cause
  }
}

/**
 * Read the config, filling in any missing keys from DEFAULT_CONFIG.
 *
 * A MISSING file is normal → returns defaults. A file that EXISTS but is not
 * valid JSON is NOT silently masked (that would let a hand-edit typo quietly
 * revert every setting to defaults); it throws ConfigError so callers can report
 * which plugin and which file is broken. Use readConfigSafe() where throwing is
 * unacceptable (hooks).
 */
export function readConfig() {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG }
  const raw = readFileSync(CONFIG_PATH, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new ConfigError(
      `${CONFIG_PATH} is not valid JSON (${cause.message})`,
      { path: CONFIG_PATH, cause },
    )
  }
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    // Built-in presets live in code (PRESETS); the file may add custom ones.
    // The built-ins are never written back (see writeConfig), so config.json
    // stays free of a dead copy while custom entries are honored here.
    presets: { ...PRESETS, ...(parsed.presets ?? {}) },
    // Same idiom for savings tiers: code-owned built-ins overlaid by any custom
    // or overridden tiers from the file (also never persisted, see writeConfig).
    tiers: { ...TIER_PRESETS, ...(parsed.tiers ?? {}) },
  }
}

/**
 * Non-throwing variant: returns { config, error }. On a corrupt file it yields
 * the built-in defaults plus the error message, so callers (especially hooks,
 * which must never crash) can warn and still operate on a sane config.
 */
export function readConfigSafe() {
  try {
    return { config: readConfig(), error: null }
  } catch (err) {
    return { config: { ...DEFAULT_CONFIG }, error: err?.message ?? String(err) }
  }
}

/** Merge code-owned built-in tiers with any custom/overridden ones in config. */
export function mergedTiers(config) {
  return { ...TIER_PRESETS, ...(config?.tiers ?? {}) }
}

/**
 * Resolve the active savings tier → { key, level, name }. Reads
 * `config.savingTier`; an unknown or missing value falls back to `safe` so a
 * hand-edit typo degrades to the no-risk tier rather than throwing.
 */
export function resolveTier(config) {
  const tiers = mergedTiers(config)
  const requested = config?.savingTier
  const key = typeof requested === 'string' && requested in tiers ? requested : 'safe'
  const { level, name } = tiers[key]
  return { key, level, name }
}

/**
 * Is `featureId` enabled at the configured tier? Derived from the merged tier
 * feature lists (so user overrides count): find the LOWEST level whose feature
 * set includes the id, then check the resolved level reaches it. An unknown
 * feature (in no tier) is never enabled.
 */
export function featureEnabled(config, featureId) {
  const tiers = mergedTiers(config)
  let min = Infinity
  for (const tier of Object.values(tiers)) {
    if (Array.isArray(tier.features) && tier.features.includes(featureId) && tier.level < min) {
      min = tier.level
    }
  }
  return resolveTier(config).level >= min
}

/**
 * Does a command's associated tier exceed the configured one? Commands are never
 * gated, but they warn when this is true (the configured quality floor is lower
 * than the command's tier).
 */
export function commandTierExceeds(config, cmdLevel) {
  return cmdLevel > resolveTier(config).level
}

/**
 * Associated tier LEVEL of each /local-* command (command id → level). Commands
 * are never gated by the configured tier, but warn when their tier exceeds it
 * (see roadmap/tiers.md). Tier-0 infra commands (local-model, local-config,
 * local-tier) are intentionally ABSENT → they never warn. Commands that ship in
 * later epics are pre-listed so they warn correctly the moment they exist.
 */
export const COMMAND_TIER = {
  'local-compact': 2, // Anthropic reasons off a local summary (Balanced-like)
  'local-commit': 1, // Safe     (F2.1)
  'local-index': 1, // Safe     (F4.3)
  'local-handoff': 2, // Balanced (F2.3)
  'local-ask': 3, // Max      (F2.2)
}

/** Name of a tier at exactly `level` (honors user overrides), else `lvl N`. */
function tierNameForLevel(config, level) {
  for (const tier of Object.values(mergedTiers(config))) {
    if (tier.level === level) return tier.name
  }
  return `lvl ${level}`
}

/**
 * Warning line for a command whose tier exceeds the configured one, else null.
 * Pure (returns the message; the caller prints/brands it) so it is unit-testable
 * without capturing stdout. An unknown or tier-0 command (absent from
 * COMMAND_TIER) never warns, and neither does a command within the configured
 * tier. Wording is kept verbatim with roadmap/tiers.md.
 */
export function commandTierWarning(config, commandId) {
  const cmdLevel = COMMAND_TIER[commandId]
  if (!cmdLevel || !commandTierExceeds(config, cmdLevel)) return null
  const active = resolveTier(config)
  const cmdName = tierNameForLevel(config, cmdLevel)
  return (
    `/${commandId} runs at tier ${cmdLevel} (${cmdName}), above your configured ` +
    `tier ${active.level} (${active.name}) — output quality may fall below what you set.`
  )
}

/**
 * Print the command-tier warning (if any) to command stdout via brand.say.
 * No-op when the command is within the configured tier or carries no tier. Every
 * /local-* command calls this once, early, before its work.
 */
export function warnIfTierExceeds(config, commandId) {
  const msg = commandTierWarning(config, commandId)
  if (msg) say(msg)
}

/**
 * Render the effective config as display lines (header + indented details).
 * Shared by /local-model status and /local-config status so the dump stays in
 * one place. The caller is responsible for branding the header line.
 */
export function configSummaryLines(config) {
  const tier = resolveTier(config)
  return [
    'configuration:',
    `  endpoint:           ${config.endpoint}`,
    `  provider:           ${config.provider}`,
    `  model:              ${config.model || '(none)'}`,
    `  savingTier:         ${tier.key} (${tier.name}, lvl ${tier.level})`,
    `  commitVerbosity:    ${config.commitVerbosity}`,
    `  commitContext:      ${config.commitContext}`,
    `  autoModelLoad:      ${config.autoModelLoad}`,
    `  autoUnloadMinutes:  ${config.autoUnloadMinutes}`,
    `  localContextTokens: ${config.localContextTokens}`,
    `  maxOutputTokens:    ${config.maxOutputTokens}`,
    `  temperature:        ${config.temperature}`,
    `  pendingTtlMs:       ${config.pendingTtlMs}`,
    `  presets:            ${Object.keys({ ...PRESETS, ...(config.presets ?? {}) }).join(', ')}`,
    `  tiers:              ${Object.keys(mergedTiers(config)).join(', ')}`,
  ]
}

/**
 * Persist the config (pretty-printed) and return it.
 *
 * Built-in preset NAMES are code-owned (PRESETS): they are never persisted, so
 * the file carries no misleading dead copy and any legacy built-in block from an
 * older version is auto-cleaned on the next write. Only presets the user added
 * under a NEW name are kept, so a hand-added custom preset survives every write;
 * the key is dropped entirely when none remain. Returns the original (in-memory)
 * config, presets intact.
 */
export function writeConfig(config) {
  ensureStateDir()
  const toWrite = { ...config }
  const custom = {}
  for (const [name, value] of Object.entries(config.presets ?? {})) {
    if (!(name in PRESETS)) custom[name] = value
  }
  if (Object.keys(custom).length) toWrite.presets = custom
  else delete toWrite.presets
  // Built-in tiers are code-owned too: strip them so only custom/overridden tiers
  // persist; the key is dropped entirely when nothing custom remains.
  const customTiers = {}
  for (const [name, value] of Object.entries(config.tiers ?? {})) {
    if (!(name in TIER_PRESETS)) customTiers[name] = value
  }
  if (Object.keys(customTiers).length) toWrite.tiers = customTiers
  else delete toWrite.tiers
  writeFileSync(CONFIG_PATH, JSON.stringify(toWrite, null, 2) + '\n', 'utf8')
  return config
}

/**
 * Factory reset: back up any existing config to a timestamped sibling file, then
 * write a fresh default config. Returns { config, backupPath } (backupPath is
 * null when there was no existing file to back up). The timestamp uses only `-`
 * separators so the backup name is a valid Windows filename and never collides.
 */
export function resetConfig() {
  let backupPath = null
  if (existsSync(CONFIG_PATH)) {
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    backupPath = CONFIG_PATH.replace(/\.json$/, '') + `.${ts}.bak.json`
    copyFileSync(CONFIG_PATH, backupPath)
  }
  return { config: writeConfig({ ...DEFAULT_CONFIG }), backupPath }
}

/** Read, apply a patch, write, return the merged config. */
export function updateConfig(patch) {
  const merged = { ...readConfig(), ...patch }
  return writeConfig(merged)
}
