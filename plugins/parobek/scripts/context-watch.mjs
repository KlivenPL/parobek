// Hook (UserPromptSubmit): warn — inside Claude Code — as the live conversation
// approaches the local model's single-pass budget, so the user can run
// /local-compact while it is still cheap and high quality.
//
// Tiered + debounced: each configured fraction of the budget fires at most once
// per cycle. Flags reset on SessionStart and after /local-compact (see
// record-session.mjs / local-compact.mjs). Emits a `systemMessage` only when a
// new tier is crossed; otherwise nothing.

import { readHookInput, emit } from './lib/hookio.mjs'
import { readConfigSafe } from './lib/config.mjs'
import { tag } from './lib/brand.mjs'
import { parseTranscript } from './lib/transcript.mjs'
import { readWarnFlags, writeWarnFlags } from './lib/state.mjs'
import { estimateMessagesTokens, inputBudget } from './lib/tokens.mjs'

function buildMessage(fraction, tokens, pct) {
  if (fraction >= 0.9) {
    return tag(
      `⚠️ conversation ~${tokens} tok (~${pct}% of local single-pass budget) — ` +
      `last good moment for a single-pass /local-compact; beyond this it still works but folds in multiple passes.`,
    )
  }
  return tag(
    `ℹ️ conversation ~${tokens} tok (~${pct}% of local single-pass budget). ` +
    `/local-compact now = one fast free pass.`,
  )
}

async function main() {
  const input = await readHookInput()
  const cwd = input.cwd || process.cwd()
  const transcriptPath = input.transcript_path
  if (!transcriptPath) return

  const { config, error } = readConfigSafe()
  if (error) {
    emit({
      systemMessage: tag(
        'config.json is invalid JSON — using defaults. Run /local-config to fix.',
      ),
    })
    return
  }
  if (!config.model) return // nothing to warn about until a local model is set

  let messages
  try {
    messages = parseTranscript(transcriptPath)
  } catch {
    return
  }
  if (messages.length === 0) return

  const budget = inputBudget(config)
  const tokens = estimateMessagesTokens(messages)

  const fractions = (config.contextWarnFractions ?? [0.7, 0.9])
    .slice()
    .sort((a, b) => a - b)

  const flags = readWarnFlags(cwd)
  const fired = new Set(flags.fired ?? [])

  // All thresholds currently crossed but not yet fired.
  const crossed = fractions.filter((f) => tokens >= f * budget && !fired.has(f))
  if (crossed.length === 0) return

  // Mark every crossed tier as fired (so lower tiers don't fire later), but show
  // only the highest one this turn.
  for (const f of crossed) fired.add(f)
  writeWarnFlags(cwd, { fired: [...fired] })

  const top = crossed[crossed.length - 1]
  const pct = Math.round((tokens / budget) * 100)
  emit({ systemMessage: buildMessage(top, tokens, pct) })
}

main().catch(() => process.exit(0))
