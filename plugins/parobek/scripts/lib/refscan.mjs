// Detect file references inside a free-text prompt, for the F5.1 pre-digest hook.
//
// Kept as its own module (mechanism, no policy) so a unit test can exercise the
// detection directly, without spawning the hook entry (predigest.mjs runs main()
// on import). The hook owns the policy (which caps to pass in); this module just
// answers "which existing files does this prompt point at, biggest first".

import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'

// Tokens are split on whitespace; these wrap a path in prose and are stripped from
// both ends before we test a token. Backticks/quotes/brackets/parens are the common
// ways a path is quoted; a trailing run of sentence punctuation is prose, not path.
const WRAP = `"'\`()<>[]{}`
const TRAIL = '.,;:!?)'

/** Strip wrapping quotes/brackets and trailing prose punctuation from one token. */
function unwrap(token) {
  let s = token
  // Leading wrap chars.
  let start = 0
  while (start < s.length && WRAP.includes(s[start])) start++
  // Trailing wrap OR sentence punctuation (so "see foo.mjs." → "foo.mjs").
  let end = s.length
  while (end > start && (WRAP.includes(s[end - 1]) || TRAIL.includes(s[end - 1]))) end--
  return s.slice(start, end)
}

/** Does a bare token look like a path (has a separator, or a short extension)? */
function looksPathLike(token) {
  if (token.includes('/') || token.includes('\\')) return true
  return /\.[A-Za-z0-9]{1,8}$/.test(token) // e.g. foo.mjs, notes.md
}

/**
 * Extract candidate path-like tokens from a prompt (pure string function). Order is
 * source order; duplicates preserved (the caller dedupes on the resolved path).
 */
export function extractCandidateTokens(prompt) {
  if (!prompt || typeof prompt !== 'string') return []
  const out = []
  for (const raw of prompt.split(/\s+/)) {
    if (raw === '') continue
    const token = unwrap(raw)
    if (token !== '' && looksPathLike(token)) out.push(token)
  }
  return out
}

/**
 * Resolve the prompt's candidate tokens to existing regular files under `cwd`,
 * filtered by `minBytes`, deduped by absolute path, sorted LARGEST FIRST (prioritize
 * the files most worth digesting), and capped at `maxRefs`.
 *
 * Returns [{ path, relPath, bytes }]. Directories, missing paths, and files below
 * the size floor are dropped. A candidate that fails to stat is skipped, never thrown.
 */
export function findFileRefs(prompt, cwd, { minBytes = 0, maxRefs = Infinity } = {}) {
  const base = cwd || process.cwd()
  const seen = new Set()
  const found = []
  for (const token of extractCandidateTokens(prompt)) {
    const abs = isAbsolute(token) ? token : join(base, token)
    if (seen.has(abs)) continue
    seen.add(abs)
    let st
    try {
      if (!existsSync(abs)) continue
      st = statSync(abs)
    } catch {
      continue
    }
    if (!st.isFile() || st.size < minBytes) continue
    const rel = relative(base, abs)
    found.push({ path: abs, relPath: rel && !rel.startsWith('..') ? rel : abs, bytes: st.size })
  }
  found.sort((a, b) => b.bytes - a.bytes)
  return found.slice(0, maxRefs)
}
