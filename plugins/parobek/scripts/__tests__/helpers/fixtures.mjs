// Shared fixtures: transcript builders and config factory.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A minimal valid config pointing at a given mock-server URL. */
export function makeConfig(url, overrides = {}) {
  return {
    endpoint: url,
    apiKey: 'test-key',
    provider: 'lmstudio',
    model: 'test-model',
    temperature: 0.2,
    autoModelLoad: true,
    autoUnloadMinutes: 15,
    maxOutputTokens: 2048,
    localContextTokens: 8192,
    contextWarnFractions: [0.7, 0.9],
    pendingTtlMs: 15 * 60 * 1000,
    ...overrides,
  }
}

/** Build one transcript line (Claude Code .jsonl entry). */
export function turn(type, content, extra = {}) {
  return JSON.stringify({
    type,
    message: { role: type, content },
    uuid: Math.random().toString(16).slice(2),
    ...extra,
  })
}

/**
 * A representative transcript exercising every parse branch: a normal
 * user/assistant exchange, content blocks (text/tool_use/tool_result/thinking/
 * image), a sidechain line, a meta line, a non-conversation line, a malformed
 * line, and a blank line. parseTranscript should yield exactly the 4 main-thread
 * turns with content.
 */
export function richTranscriptLines() {
  return [
    turn('user', 'First question.'),
    turn('assistant', [
      { type: 'thinking', thinking: 'internal reasoning' },
      { type: 'text', text: 'Here is the answer.' },
      { type: 'tool_use', name: 'Read', input: { file: 'a.txt' } },
    ]),
    turn('user', [
      { type: 'tool_result', content: [{ type: 'text', text: 'file body' }] },
      { type: 'image' },
    ]),
    turn('assistant', 'Follow-up answer.'),
    turn('user', 'Sidechain noise.', { isSidechain: true }),
    turn('assistant', 'Meta noise.', { isMeta: true }),
    JSON.stringify({ type: 'summary', summary: 'not a turn' }),
    '{ this is not valid json',
    '',
  ]
}

/** Many bulky user/assistant turns, to push past a small input budget. */
export function bulkyTranscriptLines(count = 8, charsPerTurn = 600) {
  const lines = []
  for (let i = 0; i < count; i++) {
    const filler = 'x'.repeat(charsPerTurn)
    lines.push(turn(i % 2 === 0 ? 'user' : 'assistant', `Turn ${i}: ${filler}`))
  }
  return lines
}

/** Write transcript lines to a .jsonl file in `dir` and return its path. */
export function writeTranscript(dir, lines, name = 'transcript.jsonl') {
  const path = join(dir, name)
  writeFileSync(path, lines.join('\n') + '\n', 'utf8')
  return path
}
