import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getCommitPrompt,
  getDiffChunkPrompt,
  formatCommitMessage,
} from '../lib/commit-prompt.mjs'

test('getCommitPrompt: carries Conventional-Commit + no-tools + diff-source framing', () => {
  const p = getCommitPrompt('short')
  assert.match(p, /type\(scope\): summary/)
  assert.match(p, /Conventional Commit/i)
  assert.match(p, /TEXT ONLY/)
  assert.match(p, /source of truth/i)
  assert.match(p, /WHY/)
})

test('getCommitPrompt: short vs full differ in body guidance', () => {
  const short = getCommitPrompt('short')
  const full = getCommitPrompt('full')
  assert.notEqual(short, full)
  assert.match(short, /bullet/i)
  assert.match(full, /prose/i)
  // An unknown verbosity falls back to short.
  assert.equal(getCommitPrompt('bogus'), short)
})

test('getCommitPrompt: embeds the focus hint only when provided', () => {
  assert.doesNotMatch(getCommitPrompt('short', ''), /Extra focus/)
  assert.match(getCommitPrompt('short', 'explain the security fix'), /Extra focus.*security fix/s)
})

test('getDiffChunkPrompt: names the part index and count', () => {
  assert.match(getDiffChunkPrompt(2, 3), /part 2 of 3/)
})

test('formatCommitMessage: strips a wrapping code fence', () => {
  const raw = '```\nfeat(x): do thing\n\n- a\n- b\n```'
  assert.equal(formatCommitMessage(raw), 'feat(x): do thing\n\n- a\n- b')
})

test('formatCommitMessage: drops a leading label and collapses blank runs', () => {
  assert.equal(formatCommitMessage('Commit message: fix: bug'), 'fix: bug')
  assert.equal(formatCommitMessage('feat: a\n\n\n\nbody'), 'feat: a\n\nbody')
})

test('formatCommitMessage: tolerates empty/nullish input', () => {
  assert.equal(formatCommitMessage(''), '')
  assert.equal(formatCommitMessage(null), '')
  assert.equal(formatCommitMessage(undefined), '')
})
