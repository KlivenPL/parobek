import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getCompactPrompt,
  formatCompactSummary,
  getCompactUserSummaryMessage,
  getChunkSummaryPrompt,
} from '../lib/compact-prompt.mjs'

test('getCompactPrompt: no-tools preamble + 9 sections + trailer', () => {
  const p = getCompactPrompt()
  assert.match(p, /CRITICAL: Respond with TEXT ONLY/)
  assert.match(p, /1\. Goal and intent/)
  assert.match(p, /9\. Next step \(optional\)/)
  assert.match(p, /REMINDER: Do NOT call any tools/)
  assert.doesNotMatch(p, /Additional Instructions:/)
})

test('getCompactPrompt: custom instructions inserted before trailer', () => {
  const p = getCompactPrompt('focus on tests')
  assert.match(p, /Additional Instructions:\nfocus on tests/)
})

test('getCompactPrompt: blank custom instructions treated as none', () => {
  assert.doesNotMatch(getCompactPrompt('   '), /Additional Instructions:/)
})

test('formatCompactSummary: strips <analysis>, rewrites <summary> tags', () => {
  const raw = '<analysis>scratch work</analysis>\n<summary>The real summary.</summary>'
  const out = formatCompactSummary(raw)
  assert.doesNotMatch(out, /scratch work/)
  assert.doesNotMatch(out, /<summary>/)
  assert.match(out, /Summary:\nThe real summary\./)
})

test('formatCompactSummary: no tags -> raw text passthrough (trimmed)', () => {
  assert.equal(formatCompactSummary('  plain text  '), 'plain text')
})

test('getCompactUserSummaryMessage: includes transcript path and suppress note', () => {
  const out = getCompactUserSummaryMessage('<summary>body</summary>', true, '/tmp/t.jsonl')
  assert.match(out, /picks up from an earlier conversation/)
  assert.match(out, /read the full transcript at: \/tmp\/t\.jsonl/)
  assert.match(out, /without asking the user any further questions/)
})

test('getCompactUserSummaryMessage: no path, no suppress', () => {
  const out = getCompactUserSummaryMessage('body', false, null)
  assert.doesNotMatch(out, /read the full transcript at:/)
  assert.doesNotMatch(out, /without asking the user any further questions/)
})

test('getChunkSummaryPrompt: labels part N of M', () => {
  const p = getChunkSummaryPrompt(2, 5)
  assert.match(p, /part 2 of 5/)
  assert.match(p, /CRITICAL: Respond with TEXT ONLY/)
})
