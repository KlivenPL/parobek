// Hook (SessionStart) — F1.4 tier-guidance injection.
//
// At Balanced+ savings tiers, nudge Anthropic toward the local_* MCP digest tools so
// bulky, mechanical work (large reads, broad searches, big diffs, logs) routes
// through the local model at ~0 Anthropic-token cost instead of a raw Read/Grep.
// This is the tier-SCALED half of "get Claude to actually use the tools"; the
// always-on half is the directive wording in each tool's description (F3.2).
//
// Self-gates on featureEnabled(config, 'tier-guidance'): NO output at Safe (the
// tools still exist and can be called, they just aren't pushed). Emits additive
// `additionalContext` only — never blocks the session, never a silent change (the
// note is branded and states the active tier).

import { readHookInput, emit } from './lib/hookio.mjs'
import { readConfigSafe, featureEnabled, resolveTier } from './lib/config.mjs'
import { TAG } from './lib/brand.mjs'

// The routing advice: which local_* tool to prefer for each kind of bulky work.
const TOOLS_ADVICE =
  'prefer local_read_digest / local_summarize over a raw Read of a large file; ' +
  'local_grep_digest instead of reading many search hits; local_diff_digest for a ' +
  'big diff; local_outline to scope a file before reading it; local_log_triage for ' +
  'logs; and local_extract to pull structured data. They run on the local model at ' +
  '~0 Anthropic-token cost; raw Read/Grep stay available when you need exact bytes.'

async function main() {
  const input = await readHookInput()
  if (input.hook_event_name !== 'SessionStart') return

  // A corrupt config degrades to defaults (Safe) here — a hook emits a single
  // response, so it cannot also warn; the invalid-config warning is surfaced by
  // context-watch and the commands instead.
  const { config } = readConfigSafe()
  if (!featureEnabled(config, 'tier-guidance')) return // Safe → no nudge

  const tier = resolveTier(config)
  let body = `Savings tier: ${tier.name}. To reduce Anthropic token use, ${TOOLS_ADVICE}`
  if (tier.level >= 3) {
    body +=
      ' Tier is Max: lean on these tools by default for any large input, and note ' +
      'that some big reads may already be substituted with a local digest.'
  }

  emit({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `${TAG} ${body}`,
    },
  })
}

main().catch(() => process.exit(0))
