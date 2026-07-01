import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTranscript } from '../lib/transcript.mjs'
import { richTranscriptLines, writeTranscript } from './helpers/fixtures.mjs'

let dir
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'parobek-tx-'))
})
after(() => rmSync(dir, { recursive: true, force: true }))

test('parseTranscript: keeps only main-thread turns with content', () => {
  const path = writeTranscript(dir, richTranscriptLines())
  const msgs = parseTranscript(path)
  // 4 real turns; sidechain, meta, summary, malformed, blank all dropped.
  assert.equal(msgs.length, 4)
  assert.deepEqual(
    msgs.map((m) => m.role),
    ['user', 'assistant', 'user', 'assistant'],
  )
})

test('parseTranscript: flattens block types (text/tool_use/tool_result/image), drops thinking', () => {
  const path = writeTranscript(dir, richTranscriptLines())
  const msgs = parseTranscript(path)
  const assistantBlocks = msgs[1].content
  assert.match(assistantBlocks, /Here is the answer\./)
  assert.match(assistantBlocks, /\[tool_use: Read\]/)
  assert.doesNotMatch(assistantBlocks, /internal reasoning/) // thinking skipped

  const toolResultTurn = msgs[2].content
  assert.match(toolResultTurn, /\[tool_result\] file body/)
  assert.match(toolResultTurn, /\[image\]/)
})

test('parseTranscript: truncates oversized blocks', () => {
  const huge = 'y'.repeat(5000)
  const path = writeTranscript(
    dir,
    [JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'ok' }] } }),
     JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'X', input: { blob: huge } }] } })],
    'trunc.jsonl',
  )
  const msgs = parseTranscript(path)
  assert.match(msgs[1].content, /…\[truncated \d+ chars\]/)
})

test('parseTranscript: empty file -> []', () => {
  const path = join(dir, 'empty.jsonl')
  writeFileSync(path, '', 'utf8')
  assert.deepEqual(parseTranscript(path), [])
})
