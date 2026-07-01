// Shared "digest a blob with the local model" runner for the F3.2 MCP tools.
//
// Every digest tool boils down to the same shape: take some text, append a final
// instruction, and get back a compressed/extracted result — falling back to
// map-reduce when the text does not fit the local model's single-pass budget. This
// module factors that out so each tool handler stays a few lines. It mirrors the
// proven single-pass-or-map-reduce + degeneration-retry logic of local-compact.mjs,
// but is text-oriented (a raw blob, not a parsed transcript).

import { chat, LocalModelError } from './provider.mjs'
import { looksDegenerate } from './quality.mjs'
import {
  estimateTokens,
  estimateMessagesTokens,
  inputBudget,
  chunkMessages,
} from './tokens.mjs'
import { getDigestChunkPrompt } from './digest-prompt.mjs'

/**
 * One chat call, hardened against degenerate (looping) output the same way
 * /local-compact is: if the response looks degenerate, retry ONCE with a higher
 * temperature and stronger anti-repeat penalties; if it still loops, throw rather
 * than return garbage. Unlike compaction the result is not persisted, but a looping
 * digest is still useless to hand back, so we refuse it.
 */
async function callModelHardened(config, messages) {
  const out = await chat(config, messages)
  if (!looksDegenerate(out)) return out

  const harder = {
    ...config,
    temperature: Math.min(0.7, (config.temperature ?? 0.2) + 0.3),
  }
  const retry = await chat(harder, messages, { antiRepeat: 'strong' })
  if (!looksDegenerate(retry)) return retry

  throw new LocalModelError(
    'local model produced a degenerate (looping) response twice — refusing to ' +
      'return it. Try a smaller input or re-select the model with /local-model <id>.',
  )
}

/**
 * Split a raw blob into pseudo-messages so tokens.chunkMessages can group it.
 * `split` (a lookahead regex) lets a caller preserve natural boundaries, e.g.
 * `/(?=^diff --git )/m` keeps each file's diff intact; otherwise we split on blank
 * lines, and fall back to per-line when the blob has no paragraph breaks.
 */
function textToMessages(text, split) {
  let parts = split
    ? text.split(split)
    : text.split(/\n{2,}/)
  parts = parts.filter((s) => s.trim() !== '')
  if (parts.length <= 1) {
    parts = text.split('\n').filter((l) => l.trim() !== '')
  }
  return parts.map((s) => ({ role: 'user', content: s }))
}

/**
 * Digest `text` with the local model.
 *
 * @param config      plugin config (endpoint/model/budgets)
 * @param text        the blob to process
 * @param finalPrompt the instruction appended after the content (or after the folded
 *                    digests in the map-reduce path) — this is what shapes the output
 * @param mapPrompt   (index,count)=>string used for each chunk digest when the input
 *                    overflows; defaults to a generic factual-digest prompt
 * @param split       optional lookahead regex to preserve chunk boundaries
 * @returns the model's result text
 */
export async function runDigest(
  config,
  text,
  { finalPrompt, mapPrompt = getDigestChunkPrompt, split } = {},
) {
  const budget = inputBudget(config)
  const promptTokens = estimateTokens(finalPrompt)

  // Single pass when the whole blob fits.
  if (estimateTokens(text) + promptTokens <= budget) {
    return callModelHardened(config, [
      { role: 'user', content: text },
      { role: 'user', content: finalPrompt },
    ])
  }

  // Map: chunk the blob and digest each chunk.
  const chunks = chunkMessages(textToMessages(text, split), budget)
  let digests = []
  for (let i = 0; i < chunks.length; i++) {
    const d = await callModelHardened(config, [
      ...chunks[i],
      { role: 'user', content: mapPrompt(i + 1, chunks.length) },
    ])
    digests.push({ role: 'user', content: `=== Part ${i + 1} digest ===\n${d}` })
  }

  // Reduce: fold the digests until they fit one pass, then apply the final prompt.
  while (
    digests.length > 1 &&
    estimateMessagesTokens(digests) + promptTokens > budget
  ) {
    const groups = chunkMessages(digests, budget)
    if (groups.length >= digests.length) break // cannot fold further; let it truncate
    const folded = []
    for (let i = 0; i < groups.length; i++) {
      const d = await callModelHardened(config, [
        ...groups[i],
        { role: 'user', content: mapPrompt(i + 1, groups.length) },
      ])
      folded.push({ role: 'user', content: `=== Folded digest ${i + 1} ===\n${d}` })
    }
    digests = folded
  }

  return callModelHardened(config, [
    ...digests,
    { role: 'user', content: finalPrompt },
  ])
}
