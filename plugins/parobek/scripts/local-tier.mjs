// /local-tier — inspect / switch the active savings tier used by /local-* features.
//
// Usage (passed as a single "$ARGUMENTS" string by the slash command):
//   /local-tier                show the current tier + active features + selectable tiers
//   /local-tier status         same as above
//   /local-tier safe|balanced|max   switch the tier (writes config.savingTier)
//
// The tier governs how aggressively the local model stands in for Anthropic (see
// roadmap/tiers.md). This command only reads/writes config — it never contacts the
// local server. The parallel of `/local-model preset <name>`.

import {
  readConfigSafe,
  updateConfig,
  resolveTier,
  mergedTiers,
  CONFIG_PATH,
} from './lib/config.mjs'
import { say } from './lib/brand.mjs'

function getArgs() {
  // The slash command passes the whole argument string as one argv entry.
  const raw = (process.argv[2] ?? '').trim()
  return raw.split(/\s+/).filter(Boolean)
}

/**
 * Rich tier report → array of display lines (header first, indented details after).
 * The caller brands the header; detail lines stay plain. Lists the active feature
 * set (cumulative for the resolved tier) and every selectable tier with its level.
 */
function tierReport(config) {
  const tiers = mergedTiers(config)
  const active = resolveTier(config)
  const lines = [`saving tier: ${active.key} (${active.name}, lvl ${active.level})`]

  const features = tiers[active.key]?.features ?? []
  lines.push('  active features:')
  if (features.length === 0) lines.push('    (none)')
  for (const f of features) lines.push(`    - ${f}`)

  const sorted = Object.entries(tiers).sort((a, b) => a[1].level - b[1].level)
  const width = Math.max(...sorted.map(([key]) => key.length))
  lines.push('  available tiers:')
  for (const [key, t] of sorted) {
    const marker = key === active.key ? '  <- current' : ''
    lines.push(`    ${key.padEnd(width)}  (lvl ${t.level})${marker}`)
  }
  return lines
}

function printReport(config) {
  const [header, ...details] = tierReport(config)
  say(header)
  for (const line of details) console.log(line)
}

function switchTier(key) {
  const updated = updateConfig({ savingTier: key })
  const tier = resolveTier(updated)
  say(`✅ saving tier set to: ${tier.key} (${tier.name}, lvl ${tier.level})`)
  // Show what is now active (skip the header — the line above already states it).
  const [, ...details] = tierReport(updated)
  for (const line of details) console.log(line)
}

function main() {
  const { config, error } = readConfigSafe()
  if (error) {
    say(
      `Invalid plugin config: ${error}. Using built-in defaults until fixed — ` +
      `edit with /local-config, or delete ${CONFIG_PATH} to reset.`,
    )
  }
  const args = getArgs()
  const first = args[0]

  if (!first || first.toLowerCase() === 'status') return printReport(config)

  // Tier keys are matched case-sensitively against the merged map (built-ins +
  // custom), consistent with how /local-model preset treats preset names.
  const tiers = mergedTiers(config)
  if (first in tiers) return switchTier(first)

  say(`Unknown tier "${first}". Valid tiers: ${Object.keys(tiers).join(', ')}`)
}

try {
  main()
} catch (err) {
  say(`error: ${err?.message ?? err}`)
  process.exit(0)
}
