// Unit tests for the F5.1 reference scanner. In-process (no spawn, no model): the
// detection is a pure string function plus a filesystem lookup against a temp dir.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractCandidateTokens, findFileRefs } from '../lib/refscan.mjs'

test('extractCandidateTokens: keeps path-like tokens, drops prose', () => {
  const toks = extractCandidateTokens(
    'please look at src/foo.mjs and `lib/bar.js`, plus "notes.md". thanks a lot',
  )
  assert.ok(toks.includes('src/foo.mjs'), 'bare path with separator')
  assert.ok(toks.includes('lib/bar.js'), 'backtick-wrapped path unwrapped')
  assert.ok(toks.includes('notes.md'), 'quoted + trailing-comma stripped')
  assert.ok(!toks.includes('please'), 'plain word ignored')
  assert.ok(!toks.includes('thanks'), 'plain word ignored')
})

test('extractCandidateTokens: strips trailing sentence punctuation', () => {
  assert.deepEqual(extractCandidateTokens('see config.json.'), ['config.json'])
  assert.deepEqual(extractCandidateTokens('open a/b/c.txt!'), ['a/b/c.txt'])
})

test('extractCandidateTokens: empty / non-string input', () => {
  assert.deepEqual(extractCandidateTokens(''), [])
  assert.deepEqual(extractCandidateTokens(undefined), [])
})

test('findFileRefs: only existing files >= floor, biggest first, capped, deduped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parobek-refscan-'))
  try {
    writeFileSync(join(dir, 'big.txt'), 'x'.repeat(5000), 'utf8')
    writeFileSync(join(dir, 'mid.txt'), 'y'.repeat(4000), 'utf8')
    writeFileSync(join(dir, 'small.txt'), 'z'.repeat(100), 'utf8') // below floor
    mkdirSync(join(dir, 'adir.txt')) // a directory that looks path-like

    const prompt =
      'check small.txt and mid.txt then big.txt and big.txt again and adir.txt and missing.txt'
    const refs = findFileRefs(prompt, dir, { minBytes: 3072, maxRefs: 2 })

    assert.equal(refs.length, 2, 'capped at maxRefs')
    assert.deepEqual(
      refs.map((r) => r.relPath),
      ['big.txt', 'mid.txt'],
      'sorted by size desc; small (floor), missing, dir all excluded; dedup held',
    )
    assert.ok(refs[0].bytes > refs[1].bytes)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findFileRefs: resolves absolute paths too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parobek-refscan-'))
  try {
    const abs = join(dir, 'data.log')
    writeFileSync(abs, 'a'.repeat(4000), 'utf8')
    const refs = findFileRefs(`tail ${abs}`, tmpdir(), { minBytes: 3072, maxRefs: 5 })
    assert.equal(refs.length, 1)
    assert.equal(refs[0].path, abs)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
