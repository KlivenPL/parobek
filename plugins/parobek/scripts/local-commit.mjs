// /local-commit — draft a Conventional Commit message with the LOCAL model
// (0 Anthropic tokens) from the staged diff, optionally informed by the recorded
// conversation context. The draft is reviewable; nothing is committed unless the
// user passes `apply`.
//
// Usage (passed as a single "$ARGUMENTS" string by the slash command):
//   /local-commit                 draft from the staged diff + conversation context
//   /local-commit <focus>         optional focus hint (scope, "explain why", ...)
//   /local-commit --short|--full  override verbosity for this run
//   /local-commit --no-context    ignore the transcript, draft from the diff only
//   /local-commit apply           draft, then create the commit
// Flags / subcommand / focus combine, e.g. `/local-commit apply --full why we did X`.
//
// Tier 1 (Safe): the diff stays visible and the message is a draft you approve.

import { execFileSync } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfigSafe, warnIfTierExceeds, CONFIG_PATH } from './lib/config.mjs'
import { chat, ping, LocalModelError } from './lib/provider.mjs'
import { say } from './lib/brand.mjs'
import { readSessionRecord } from './lib/state.mjs'
import { parseTranscript } from './lib/transcript.mjs'
import {
  estimateMessageTokens,
  estimateMessagesTokens,
  inputBudget,
  chunkMessages,
} from './lib/tokens.mjs'
import {
  getCommitPrompt,
  getDiffChunkPrompt,
  formatCommitMessage,
} from './lib/commit-prompt.mjs'

const cwd = process.cwd()
let passCount = 0

/** Parse the single argument string into { apply, verbosity, context, focus }. */
function parseArgs() {
  const tokens = (process.argv[2] ?? '').trim().split(/\s+/).filter(Boolean)
  let apply = false
  let verbosity = null // null -> fall back to config
  let context = null // null -> fall back to config
  const rest = []
  for (const t of tokens) {
    const low = t.toLowerCase()
    if (low === 'apply') apply = true
    else if (low === '--full') verbosity = 'full'
    else if (low === '--short') verbosity = 'short'
    else if (low === '--no-context') context = false
    else if (low === '--context') context = true
    else rest.push(t)
  }
  return { apply, verbosity, context, focus: rest.join(' ') }
}

/** Run git in the cwd, returning stdout (throws on a non-zero exit). */
function git(args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

async function callModel(config, messages) {
  passCount++
  return chat(config, messages)
}

/** Map-reduce a diff too large for one pass: digest file groups, then compose. */
async function draftViaMapReduce(config, stagedDiff, verbosity, focus, budget) {
  const sections = stagedDiff
    .split(/(?=^diff --git )/m)
    .filter((s) => s.trim() !== '')
  const sectionMsgs = sections.map((s) => ({ role: 'user', content: s }))
  const chunks = chunkMessages(sectionMsgs, budget)

  const digests = []
  for (let i = 0; i < chunks.length; i++) {
    const digest = await callModel(config, [
      ...chunks[i],
      { role: 'user', content: getDiffChunkPrompt(i + 1, chunks.length) },
    ])
    digests.push({ role: 'user', content: `=== Files digest ${i + 1} ===\n${digest}` })
  }

  return callModel(config, [
    ...digests,
    { role: 'user', content: getCommitPrompt(verbosity, focus) },
  ])
}

/**
 * Produce the commit message. The diff is authoritative, so when the input is too
 * large we trim the oldest context first (keeping the full diff); only if the diff
 * alone overflows do we drop context and map-reduce the diff.
 */
async function draft(config, stagedDiff, diffBlock, contextMsgs, verbosity, focus) {
  const budget = inputBudget(config)
  const promptMsg = { role: 'user', content: getCommitPrompt(verbosity, focus) }
  const promptTokens = estimateMessageTokens(promptMsg)
  const fits = (msgs) => estimateMessagesTokens(msgs) + promptTokens <= budget

  if (fits([...contextMsgs, diffBlock])) {
    return callModel(config, [...contextMsgs, diffBlock, promptMsg])
  }

  // Trim oldest context until the full diff + prompt fit.
  const trimmed = [...contextMsgs]
  while (trimmed.length && !fits([...trimmed, diffBlock])) trimmed.shift()
  if (fits([...trimmed, diffBlock])) {
    return callModel(config, [...trimmed, diffBlock, promptMsg])
  }

  // The diff alone overflows: drop context and map-reduce the diff.
  return draftViaMapReduce(config, stagedDiff, verbosity, focus, budget)
}

function gatherContext(enabled) {
  if (!enabled) return []
  const record = readSessionRecord(cwd)
  if (!record?.transcript_path) return []
  try {
    return parseTranscript(record.transcript_path)
  } catch {
    return [] // unreadable transcript degrades to diff-only
  }
}

function commitWithMessage(message) {
  const file = join(tmpdir(), `parobek-commit-${process.pid}-${Date.now()}.txt`)
  try {
    writeFileSync(file, message, 'utf8')
    git(['commit', '-F', file])
  } finally {
    try {
      rmSync(file)
    } catch {
      /* best effort */
    }
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

  const { apply, verbosity: vFlag, context: cFlag, focus } = parseArgs()
  const verbosity = vFlag ?? config.commitVerbosity ?? 'short'
  const useContext = cFlag ?? config.commitContext ?? true

  warnIfTierExceeds(config, 'local-commit') // tier 1 -> no-op within Safe+

  // --- Staged-diff preflight (cheap, local) ---------------------------------
  let stagedDiff
  let status
  try {
    stagedDiff = git(['diff', '--staged'])
    status = git(['status', '--short'])
  } catch (err) {
    say(`❌ Not a git repository (or git failed): ${err?.message ?? err}`)
    return
  }
  if (stagedDiff.trim() === '') {
    say('❌ Nothing staged. Stage changes first: git add <files>')
    return
  }

  // --- Model preflight ------------------------------------------------------
  if (!config.model) {
    say('❌ No local model selected. Run: /local-model <model-id>')
    return
  }
  if (!(await ping(config))) {
    say(`❌ Cannot reach the local model server at ${config.endpoint}.`)
    console.log('   Start the local server, then retry. Check it: /local-model status')
    return
  }

  // --- Draft locally --------------------------------------------------------
  const contextMsgs = gatherContext(useContext)
  const diffBlock = {
    role: 'user',
    content:
      `=== Staged changes (git diff --staged) ===\n${stagedDiff}\n\n` +
      `=== Status (git status --short) ===\n${status}`,
  }

  const started = Date.now()
  let message
  try {
    const raw = await draft(config, stagedDiff, diffBlock, contextMsgs, verbosity, focus)
    message = formatCommitMessage(raw)
  } catch (err) {
    const msg = err instanceof LocalModelError ? err.message : String(err)
    say(`❌ Local commit drafting failed: ${msg}`)
    return
  }
  if (!message) {
    say('❌ The local model returned an empty commit message.')
    return
  }
  const elapsedS = ((Date.now() - started) / 1000).toFixed(1)
  const ctxNote = useContext && contextMsgs.length ? 'with context' : 'diff only'

  // --- Apply or print -------------------------------------------------------
  if (apply) {
    try {
      commitWithMessage(message)
    } catch (err) {
      say(`❌ git commit failed: ${err?.message ?? err}`)
      console.log('   The drafted message was:')
      console.log(message)
      return
    }
    const hash = git(['rev-parse', '--short', 'HEAD']).trim()
    const subject = message.split('\n', 1)[0]
    say(`✅ Committed ${hash}: ${subject}`)
    console.log(
      `   model ${config.model}, ${verbosity}, ${ctxNote}, ` +
        `${passCount} pass${passCount === 1 ? '' : 'es'}, ${elapsedS}s, 0 Anthropic tokens.`,
    )
    return
  }

  say(`📝 Proposed commit message (${verbosity}, ${ctxNote}, 0 Anthropic tokens):`)
  console.log('')
  console.log(message)
  console.log('')
  console.log('➡️  Run /local-commit apply to commit it, or copy the message above.')
}

main().catch((err) => {
  say(`error: ${err?.message ?? err}`)
  process.exit(0)
})
