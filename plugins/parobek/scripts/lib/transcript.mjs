// Parse a Claude Code session transcript (.jsonl) into a flat list of chat
// messages suitable for sending to a local model.
//
// Transcript format: one JSON object per line. Conversation entries look like
//   { "type": "user"|"assistant", "message": { "role", "content" }, "uuid",
//     "isSidechain", "sessionId", "cwd", ... }
// where `content` is either a string or an array of content blocks
// (text / tool_use / tool_result). Non-conversation lines (file-history
// snapshots, queue ops, custom-title, tag, summary, etc.) are ignored.

import { readFileSync } from 'node:fs'

// Per-block truncation: tool results and tool-use inputs can be huge (e.g. a
// full file read). For summarization we keep them short — the substance lives
// in text blocks and the user/assistant intent.
const MAX_BLOCK_CHARS = 1500

function truncate(text, max = MAX_BLOCK_CHARS) {
  if (text.length <= max) return text
  return text.slice(0, max) + ` …[truncated ${text.length - max} chars]`
}

/** Flatten a single content block to readable text. */
function blockToText(block) {
  if (typeof block === 'string') return block
  switch (block?.type) {
    case 'text':
      return block.text ?? ''
    case 'tool_use':
      return `[tool_use: ${block.name}] ${truncate(
        JSON.stringify(block.input ?? {}),
      )}`
    case 'tool_result': {
      const c = block.content
      const text = Array.isArray(c)
        ? c.map(blockToText).join('\n')
        : typeof c === 'string'
          ? c
          : JSON.stringify(c ?? '')
      return `[tool_result] ${truncate(text)}`
    }
    case 'thinking':
      // Thinking blocks are internal reasoning; skip to save budget.
      return ''
    case 'image':
      return '[image]'
    default:
      return block?.text ?? ''
  }
}

/** Flatten a message `content` (string | block[]) to a single text string. */
function contentToText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(blockToText).filter(Boolean).join('\n').trim()
  }
  return ''
}

/**
 * Parse a transcript file into ordered chat messages.
 *
 * @param {string} path - absolute path to the .jsonl transcript
 * @returns {{role:'user'|'assistant', content:string}[]}
 */
export function parseTranscript(path) {
  const raw = readFileSync(path, 'utf8')
  const lines = raw.split('\n')
  const messages = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let entry
    try {
      entry = JSON.parse(trimmed)
    } catch {
      continue // skip malformed lines
    }

    // Only main-thread conversation turns.
    if (entry.type !== 'user' && entry.type !== 'assistant') continue
    if (entry.isSidechain) continue // subagent traffic
    if (entry.isMeta) continue

    const role = entry.message?.role ?? entry.type
    const content = contentToText(entry.message?.content)
    if (!content) continue

    messages.push({ role: role === 'assistant' ? 'assistant' : 'user', content })
  }

  return messages
}
