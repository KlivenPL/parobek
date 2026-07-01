// /local-compact — compact the conversation using the LOCAL model (0 Anthropic
// tokens), writing a pending summary that the next /clear injects.
//
// Usage (passed as a single "$ARGUMENTS" string by the slash command):
//   /local-compact [instructions]   summarize now (optional focus instructions)
//   /local-compact status           report any pending summary + remaining TTL
//
// How it works:
//   1. Preflight: a local model must be selected and reachable.
//   2. Read the recorded transcript for this cwd, parse it to chat messages.
//   3. Summarize locally — single pass if it fits the local context, else
//      map-reduce (chunk -> digest -> fold -> final 9-section summary).
//   4. Write pending-summary-<cwd-hash>.json. Reset context-warning flags.
//   5. Print completion + tell the user to run /clear.
// The actual context replacement happens when the user runs /clear: the
// SessionStart hook (inject-summary.mjs) injects this summary.

import { readConfigSafe, writeConfig, warnIfTierExceeds, CONFIG_PATH } from './lib/config.mjs'
import { chat, ping, modelContextLength, LocalModelError } from './lib/provider.mjs'
import { say } from './lib/brand.mjs'
import { parseTranscript } from './lib/transcript.mjs'
import { looksDegenerate } from './lib/quality.mjs'
import {
  readSessionRecord,
  writePendingSummary,
  readPendingSummary,
  clearWarnFlags,
} from './lib/state.mjs'
import {
  estimateTokens,
  estimateMessagesTokens,
  inputBudget,
  chunkMessages,
  deriveMaxOutputTokens,
} from './lib/tokens.mjs'
import {
  getCompactPrompt,
  getChunkSummaryPrompt,
  formatCompactSummary,
  getCompactUserSummaryMessage,
} from './lib/compact-prompt.mjs'

const cwd = process.cwd()
let passCount = 0

function getArgs() {
  return (process.argv[2] ?? '').trim()
}

async function callModel(config, messages) {
  passCount++
  const out = await chat(config, messages)
  if (!looksDegenerate(out)) return out

  // The local model fell into a repetition loop. Retry once with stronger
  // anti-repeat penalties and a slightly higher temperature — perturbing the
  // sampling usually escapes the loop. Still degenerate → refuse to persist it.
  passCount++
  const harder = {
    ...config,
    temperature: Math.min(0.7, (config.temperature ?? 0.2) + 0.3),
  }
  const retry = await chat(harder, messages, { antiRepeat: 'strong' })
  if (!looksDegenerate(retry)) return retry

  throw new LocalModelError(
    'local model produced a degenerate (looping) response twice — not saving it. ' +
      'Try /local-compact again, or re-select the model with /local-model <id>.',
  )
}

/** Fold a list of digest messages until they fit, then run the final reduce. */
async function reduceDigests(config, digests, instructions, budget) {
  let current = digests
  const promptTokens = estimateTokens(getCompactPrompt(instructions))

  while (
    current.length > 1 &&
    estimateMessagesTokens(current) + promptTokens > budget
  ) {
    const groups = chunkMessages(current, budget)
    if (groups.length >= current.length) break // cannot fold further
    const folded = []
    for (let i = 0; i < groups.length; i++) {
      const prompt = getChunkSummaryPrompt(i + 1, groups.length)
      const digest = await callModel(config, [
        ...groups[i],
        { role: 'user', content: prompt },
      ])
      folded.push({ role: 'user', content: `=== Folded digest ${i + 1} ===\n${digest}` })
    }
    current = folded
  }

  return callModel(config, [
    ...current,
    { role: 'user', content: getCompactPrompt(instructions) },
  ])
}

/** Summarize the whole conversation, single pass or map-reduce. */
async function summarize(config, messages, instructions) {
  const budget = inputBudget(config)
  const promptTokens = estimateTokens(getCompactPrompt(instructions))
  const total = estimateMessagesTokens(messages) + promptTokens

  if (total <= budget) {
    const raw = await callModel(config, [
      ...messages,
      { role: 'user', content: getCompactPrompt(instructions) },
    ])
    return raw
  }

  // Map: summarize each chunk into a digest.
  const chunks = chunkMessages(messages, budget)
  const digests = []
  for (let i = 0; i < chunks.length; i++) {
    const prompt = getChunkSummaryPrompt(i + 1, chunks.length)
    const digest = await callModel(config, [
      ...chunks[i],
      { role: 'user', content: prompt },
    ])
    digests.push({ role: 'user', content: `=== Part ${i + 1} digest ===\n${digest}` })
  }

  // Reduce: fold digests into the final 9-section summary.
  return reduceDigests(config, digests, instructions, budget)
}

function fmtRemaining(ms) {
  if (ms <= 0) return 'expired'
  const totalSec = Math.round(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`
}

function showStatus(config) {
  const pending = readPendingSummary(cwd)
  if (!pending) {
    say('No pending local summary for this folder. Run /local-compact to create one.')
    return
  }
  const age = Date.now() - pending.createdAt
  const remaining = (config.pendingTtlMs ?? 0) - age
  say('pending local summary:')
  console.log(`  model:     ${pending.model}`)
  console.log(`  passes:    ${pending.passes}`)
  console.log(`  created:   ${new Date(pending.createdAt).toLocaleString()}`)
  console.log(`  valid for: ${fmtRemaining(remaining)}`)
  if (remaining <= 0) {
    console.log('  ⚠️  Expired — it will be discarded on the next /clear. Re-run /local-compact.')
  } else {
    console.log('  ➡️  Run /clear to load it.')
  }
}

async function main() {
  const { config, error } = readConfigSafe()
  if (error) {
    say(
      `Invalid plugin config: ${error}. Using built-in defaults until fixed — ` +
      `edit with /local-config, or delete ${CONFIG_PATH} to reset.`,
    )
  }
  const arg = getArgs()

  if (arg.toLowerCase() === 'status') {
    showStatus(config)
    return
  }

  // Compaction reasons off a local summary (tier 2); warn if that exceeds the
  // configured quality floor. status above does no tiered work, so stays quiet.
  warnIfTierExceeds(config, 'local-compact')

  // --- Preflight ------------------------------------------------------------
  if (!config.model) {
    say('❌ No local model selected. Run: /local-model <model-id>')
    console.log(`   (See available models with: /local-model list)`)
    return
  }
  if (!(await ping(config))) {
    say(`❌ Cannot reach the local model server at ${config.endpoint}.`)
    console.log('   Start LM Studio and its local server, then retry.')
    console.log('   Check/adjust the endpoint with: /local-model status')
    return
  }

  // Best-effort safety clamp: if the server reports a SMALLER context window than
  // the stored one (e.g. the model was reloaded at a shorter context, or the
  // config is stale/too high), shrink the budget for this run so chunking can't
  // overflow the real window — and self-heal the config so the (network-free)
  // context-watch hook stays accurate. Only ever clamps DOWN (a larger real
  // window is harmless — it just means more, smaller passes). Skipped silently
  // when the window can't be determined.
  let effectiveConfig = config
  const detected = await modelContextLength(config).catch(() => null)
  if (detected && detected < config.localContextTokens) {
    effectiveConfig = {
      ...config,
      localContextTokens: detected,
      maxOutputTokens: deriveMaxOutputTokens(detected),
    }
    say(
      `ℹ️  model reports a ${detected}-token context window — clamping ` +
        `localContextTokens (was ${config.localContextTokens}) to avoid overflow.`,
    )
    if (!error) {
      try {
        writeConfig(effectiveConfig)
      } catch {
        /* persisting the re-sync is best-effort; never block compaction */
      }
    }
  }

  const record = readSessionRecord(cwd)
  if (!record?.transcript_path) {
    say('❌ No transcript recorded for this folder yet. Send at least one message first.')
    return
  }

  let messages
  try {
    messages = parseTranscript(record.transcript_path)
  } catch (err) {
    say(`❌ Could not read the transcript: ${err?.message ?? err}`)
    return
  }
  if (messages.length === 0) {
    say('❌ The conversation is empty — nothing to compact.')
    return
  }

  const existing = readPendingSummary(cwd)
  if (existing && Date.now() - existing.createdAt < (config.pendingTtlMs ?? 0)) {
    say('ℹ️  A recent pending summary exists and will be overwritten.')
  }

  // --- Summarize locally ----------------------------------------------------
  const started = Date.now()
  let raw
  try {
    raw = await summarize(effectiveConfig, messages, arg)
  } catch (err) {
    const msg = err instanceof LocalModelError ? err.message : String(err)
    say(`❌ Local compaction failed: ${msg}`)
    return
  }
  const elapsedS = ((Date.now() - started) / 1000).toFixed(1)

  // --- Persist the pending summary ------------------------------------------
  const summaryMessage = getCompactUserSummaryMessage(
    raw,
    true, // suppressFollowUpQuestions: continue seamlessly after /clear
    record.transcript_path,
  )

  writePendingSummary(cwd, {
    createdAt: Date.now(),
    sourceSessionId: record.session_id ?? null,
    model: config.model,
    passes: passCount,
    summary: summaryMessage,
  })
  clearWarnFlags(cwd) // re-arm context warnings for the next cycle

  const ttlMin = Math.round((config.pendingTtlMs ?? 0) / 60000)
  say(
    `✅ Local summary ready — model ${config.model}, ${messages.length} messages, ` +
      `${passCount} pass${passCount === 1 ? '' : 'es'}, ${elapsedS}s, 0 Anthropic tokens.`,
  )
  console.log(
    `➡️  Run /clear now to load the compacted context (valid ${ttlMin} min); ` +
      `the summary injects automatically.`,
  )
}

main().catch((err) => {
  say(`error: ${err?.message ?? err}`)
  process.exit(0)
})
