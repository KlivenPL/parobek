import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksDegenerate } from '../lib/quality.mjs'

test('looksDegenerate: empty / short text -> false', () => {
  assert.equal(looksDegenerate(''), false)
  assert.equal(looksDegenerate(null), false)
  assert.equal(looksDegenerate('a single short line'), false)
  assert.equal(looksDegenerate('line one\nline two\nline three'), false)
})

test('looksDegenerate: consecutive repeated line (the observed loop) -> true', () => {
  const loop = Array.from(
    { length: 30 },
    () => '- reindex.py had a duplicate "Jira status caveat" heading; removed',
  ).join('\n')
  assert.equal(looksDegenerate(loop), true)
})

test('looksDegenerate: a real-looking 9-section summary -> false', () => {
  const summary = [
    '1. Primary Request and Intent:',
    '   The user asked to harden /local-compact against degeneration.',
    '2. Key Technical Concepts:',
    '   - anti-repetition penalties',
    '   - map-reduce summarization',
    '   - provider abstraction',
    '3. Files and Code Sections:',
    '   - openai.mjs: baseChat builds the request body',
    '   - quality.mjs: looksDegenerate detection',
    '4. Errors and fixes:',
    '   - repetition loop fixed by penalties + retry guard',
    '5. Problem Solving:',
    '   Reduced wasted local passes.',
    '6. All user messages:',
    '   - "fix the loop"',
    '7. Pending Tasks:',
    '   - write tests',
    '8. Current Work:',
    '   Implementing the degeneration guard.',
    '9. Optional Next Step:',
    '   Run the test suite.',
  ].join('\n')
  assert.equal(looksDegenerate(summary), false)
})

test('looksDegenerate: high duplicate fraction (non-consecutive) -> true', () => {
  // Alternate two lines many times: no long consecutive run, but ~50% unique is
  // still far above the duplicate threshold once interleaved with more repeats.
  const lines = []
  for (let i = 0; i < 20; i++) {
    lines.push('same repeated thought')
    lines.push('same repeated thought B')
    lines.push('same repeated thought')
  }
  assert.equal(looksDegenerate(lines.join('\n')), true)
})

test('looksDegenerate: a long list of distinct lines -> false', () => {
  const distinct = Array.from({ length: 40 }, (_, i) => `- distinct point number ${i}`).join('\n')
  assert.equal(looksDegenerate(distinct), false)
})

test('looksDegenerate: minLines threshold respected', () => {
  const elevenRepeats = Array.from({ length: 11 }, () => 'identical line here').join('\n')
  assert.equal(looksDegenerate(elevenRepeats), false) // below minLines (12)
  const twelveRepeats = Array.from({ length: 12 }, () => 'identical line here').join('\n')
  assert.equal(looksDegenerate(twelveRepeats), true) // 12 lines, all identical
})
