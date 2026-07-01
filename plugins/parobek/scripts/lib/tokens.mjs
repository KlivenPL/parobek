// Rough token estimation and conversation chunking for map-reduce compaction.
//
// We intentionally avoid a real tokenizer dependency: a chars/4 heuristic is
// accurate enough to decide single-pass vs map-reduce and to drive warnings.
// Estimates are deliberately slightly conservative (round up).

/** Approximate token count of a string. */
export function estimateTokens(text) {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/** Approximate token count of a chat message ({role, content}). */
export function estimateMessageTokens(message) {
  // +4 per message roughly accounts for role/formatting overhead.
  return estimateTokens(message.content) + 4
}

/** Sum of estimated tokens across a list of chat messages. */
export function estimateMessagesTokens(messages) {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0)
}

/**
 * Derive a sane output cap from a model's context window. A compact summary needs
 * room but should not be allowed to run away: take 25% of the window, clamped to
 * [1024, 8192]. (8192-token window → 2048, matching the historical default; large
 * windows cap at 8192 so a runaway loop terminates fast and most of the window
 * stays available for the input.)
 */
export function deriveMaxOutputTokens(contextWindow) {
  const quarter = Math.round((contextWindow ?? 0) * 0.25)
  return Math.max(1024, Math.min(8192, quarter))
}

/**
 * Compute the usable input budget for a single local call.
 *
 * budget = localContextTokens - maxOutputTokens - promptReserve
 *
 * `promptReserve` covers the compact prompt template itself plus a safety
 * margin. Returns at least 512 so a misconfigured tiny context still progresses.
 */
export function inputBudget(config, promptReserve = 1500) {
  const budget =
    (config.localContextTokens ?? 8192) -
    (config.maxOutputTokens ?? 2048) -
    promptReserve
  return Math.max(512, budget)
}

/**
 * Split messages (oldest -> newest, already in order) into contiguous chunks
 * whose estimated token totals each stay within `budget`. A single message that
 * is larger than the budget becomes its own chunk (it is hard-split by the
 * caller only if needed; here we keep it whole and let the local model truncate
 * — folding still makes forward progress).
 */
export function chunkMessages(messages, budget) {
  const chunks = []
  let current = []
  let currentTokens = 0

  for (const message of messages) {
    const t = estimateMessageTokens(message)
    if (current.length > 0 && currentTokens + t > budget) {
      chunks.push(current)
      current = []
      currentTokens = 0
    }
    current.push(message)
    currentTokens += t
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}
