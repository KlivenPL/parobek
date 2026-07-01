// Hook (UserPromptSubmit) — F5.1 file-reference pre-digest.
//
// When a prompt names an existing local file, digest that file on the LOCAL model
// and inject the digest as additionalContext, so Anthropic can often answer WITHOUT
// a full Read of the raw file (~0 Anthropic tokens for the digest).
//
// Honest limits (see roadmap/epic-5): a UserPromptSubmit hook can only ADD context,
// never strip the user's text — the saving is avoiding the downstream large
// tool-result, not shrinking the prompt. The digest is lossy and is labeled as such.
//
// Self-gates on featureEnabled(config, 'file-predigest') → NO output at Safe (tier 1).
// The hook runs synchronously and blocks the turn, so it stays conservative: only
// files above a size floor, at most MAX_REFS of them (biggest first), and a SINGLE
// local pass per file (oversize is truncated, not map-reduced) to bound the stall.

import { readHookInput, emit } from './lib/hookio.mjs'
import { readConfigSafe, featureEnabled } from './lib/config.mjs'
import { runDigest } from './lib/digest.mjs'
import { getReadDigestPrompt } from './lib/digest-prompt.mjs'
import { inputBudget, estimateTokens } from './lib/tokens.mjs'
import { findFileRefs } from './lib/refscan.mjs'
import { TAG } from './lib/brand.mjs'
import { readFileSync, statSync } from 'node:fs'

// Conservative, hardcoded policy (not config keys — like the openai.mjs ANTI_REPEAT
// penalties and the mcp/lib/inputs.mjs byte caps). Tunable here if it proves off.
const MAX_REFS = 2 // digest at most this many referenced files per prompt
const MIN_BYTES = 3072 // ~3 KB floor: below this a raw Read is cheap, skip
const MAX_READ_BYTES = 128 * 1024 // cap the read so the blocking hook stays bounded
const QUESTION_CHARS = 300 // how much of the prompt to use as the digest focus

/** Read up to MAX_READ_BYTES of a file as utf8. Returns null for binary/unreadable. */
function readCapped(path) {
  try {
    const size = statSync(path).size
    const buf = readFileSync(path)
    const slice = buf.length > MAX_READ_BYTES ? buf.subarray(0, MAX_READ_BYTES) : buf
    if (slice.includes(0)) return null // NUL byte → treat as binary, do not digest
    return { text: slice.toString('utf8'), overCap: size > MAX_READ_BYTES }
  } catch {
    return null
  }
}

/**
 * Digest one file to a single local pass. Pre-truncates the text to the single-pass
 * input budget so runDigest takes its one-call branch (bounded latency) while still
 * reusing its degeneration/empty-response hardening. Returns { relPath, kb, digest,
 * truncated } or null when there is nothing usable.
 */
async function digestRef(config, ref, question) {
  const read = readCapped(ref.path)
  if (!read || read.text.trim() === '') return null

  const finalPrompt = getReadDigestPrompt(question)
  // Truncate to the single-pass input budget MINUS the final instruction (and a
  // small margin for the chars/4 approximation), so runDigest stays on its one-call
  // branch (estimateTokens(text) + promptTokens <= budget) rather than map-reducing.
  const maxChars = Math.max(0, inputBudget(config) - estimateTokens(finalPrompt) - 16) * 4
  const truncated = read.overCap || read.text.length > maxChars
  const text = read.text.length > maxChars ? read.text.slice(0, maxChars) : read.text

  const digest = (await runDigest(config, text, { finalPrompt })).trim()
  if (digest === '') return null
  return { relPath: ref.relPath, kb: Math.round(ref.bytes / 1024), digest, truncated }
}

function renderBlock(results) {
  const head = `${TAG} Local pre-digest (Balanced tier — lossy; prefer over re-reading unless you need exact bytes):`
  const sections = results.map((r) => {
    const meta = `~${r.kb} KB${r.truncated ? ', truncated' : ''}`
    return `── ${r.relPath} (${meta}) ──\n${r.digest}`
  })
  return `${head}\n\n${sections.join('\n\n')}`
}

async function main() {
  const input = await readHookInput()
  const prompt = typeof input.prompt === 'string' ? input.prompt : ''
  if (prompt.trim() === '') return
  const cwd = input.cwd || process.cwd()

  // A corrupt config degrades to defaults (Safe) here; context-watch owns the
  // invalid-config warning (a hook emits a single response, cannot also warn).
  const { config } = readConfigSafe()
  if (!featureEnabled(config, 'file-predigest')) return // Safe → silent
  if (!config.model) return // no local model selected → nothing to digest with

  const refs = findFileRefs(prompt, cwd, { minBytes: MIN_BYTES, maxRefs: MAX_REFS })
  if (refs.length === 0) return

  const question = prompt.slice(0, QUESTION_CHARS)
  const results = []
  for (const ref of refs) {
    try {
      const r = await digestRef(config, ref, question)
      if (r) results.push(r)
    } catch {
      // Best-effort: a failed digest (unreachable server, degeneration, …) must
      // never block or corrupt the user's turn — just skip this reference.
    }
  }
  if (results.length === 0) return

  emit({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: renderBlock(results),
    },
  })
}

main().catch(() => process.exit(0))
